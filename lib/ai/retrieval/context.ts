import type { UIMessage } from "ai";
import { z } from "zod";
import type { ConversationContext, TrackedEntity, EntityContext, AssistantMetadata } from "./types";
import { MERCHANT_DATA, findKnownMerchant } from "@/lib/finance/normalize";
import type { IntentResult } from "../intent/classify";
import type { IntentType } from "../processors/types";

// Persistence decay table (turns-ago → score)
const PERSISTENCE: Record<TrackedEntity["entity_type"], number[]> = {
  person:   [1.0, 0.7, 0.4, 0.1],
  merchant: [1.0, 0.6, 0.3, 0.0],
  category: [1.0, 0.5, 0.2, 0.0],
  topic:    [1.0, 0.4, 0.1, 0.0],
  temporal: [1.0, 0.2, 0.0, 0.0],
};

export function persistenceScore(entity: TrackedEntity, currentTurn: number): number {
  const turnsAgo = currentTurn - entity.introduced_at_turn;
  const scores = PERSISTENCE[entity.entity_type];
  if (turnsAgo <= 0) return scores[0];
  if (turnsAgo >= scores.length) return scores[scores.length - 1];
  return scores[turnsAgo];
}

// Returns EntityContext with only entities above persistence threshold
export function resolveActiveEntities(ctx: ConversationContext): EntityContext {
  const threshold = 0.3;
  const filter = (type: TrackedEntity["entity_type"]) =>
    ctx.tracked_entities
      .filter((e) => e.entity_type === type && persistenceScore(e, ctx.turn_count) > threshold)
      .map((e) => e.value);

  return {
    people: filter("person"),
    merchants: filter("merchant"),
    categories: filter("category"),
    topics: filter("topic"),
    amount: null,
  };
}

export function updateConversationContext(
  prev: ConversationContext | null,
  intent: IntentResult
): ConversationContext {
  const turn = (prev?.turn_count ?? 0) + 1;
  const existing = prev?.tracked_entities ?? [];

  // Add new entities from this turn (avoid duplicates)
  const newEntities: TrackedEntity[] = [];
  const add = (values: string[], type: TrackedEntity["entity_type"]) => {
    for (const v of values) {
      const key = v.toLowerCase();
      const seen = (e: TrackedEntity) => e.entity_type === type && e.value.toLowerCase() === key;
      if (!existing.some(seen) && !newEntities.some(seen)) {
        newEntities.push({ value: v, introduced_at_turn: turn, entity_type: type });
      }
    }
  };

  add(intent.entities.people, "person");
  add(intent.entities.merchants, "merchant");
  add(intent.entities.categories, "category");
  add(intent.entities.topics, "topic");

  // Prune entities that have fully decayed (score = 0)
  const pruned = [...existing, ...newEntities].filter(
    (e) => persistenceScore(e, turn) > 0
  );

  return {
    tracked_entities: pruned,
    active_temporal: intent.temporal ?? prev?.active_temporal ?? null,
    active_topic: intent.primary as IntentType,
    turn_count: turn,
  };
}

export function encodeAssistantMetadata(
  context: ConversationContext,
  sourcesUsed: string[]
): AssistantMetadata {
  const topEntity = context.tracked_entities
    .filter((e) => e.entity_type === "person")
    .sort((a, b) => b.introduced_at_turn - a.introduced_at_turn)[0]?.value;

  return {
    context,
    retrieval_summary: { sources_used: sourcesUsed, top_entity: topEntity },
  };
}

// Context arrives back from the client, so it is untrusted input: bounded in
// size and shape before it can reach the classifier prompt or any query.
const short = z.string().max(120);
const contextSchema = z.object({
  tracked_entities: z.array(z.object({
    value: short,
    introduced_at_turn: z.number().int().min(0).max(10_000),
    entity_type: z.enum(["person", "merchant", "category", "topic", "temporal"]),
  })).max(30),
  active_temporal: z.object({
    type: z.enum(["absolute", "relative", "event_relative"]),
    dateRange: z.object({ from: short, to: short }).optional(),
    relativePeriod: z.enum(["today", "this_week", "last_week", "this_month", "last_month",
      "last_quarter", "this_quarter", "this_year", "last_year"]).optional(),
    anchor_event: z.enum(["salary_credit", "travel_booking", "named_meeting", "named_contact_interaction"]).optional(),
    anchor_ref: short.optional(),
    relative_window: short.optional(),
    anchor_match_confidence: z.number().optional(),
  }).nullable(),
  active_topic: z.string().max(40).nullable(),
  turn_count: z.number().int().min(0).max(10_000),
});

function parseContext(value: unknown): ConversationContext | null {
  const parsed = contextSchema.safeParse(value);
  return parsed.success ? (parsed.data as ConversationContext) : null;
}

export function decodeConversationContext(messages: UIMessage[]): ConversationContext | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    // Written by /api/ask through the AI SDK's message metadata; useChat sends
    // it back with every later request.
    const fromMetadata = parseContext((msg.metadata as { context?: unknown } | undefined)?.context);
    if (fromMetadata) return fromMetadata;

    // Legacy carrier, kept because the multi-turn eval fixtures embed context
    // as a comment in the assistant's text.
    for (const part of msg.parts ?? []) {
      if (part.type !== "text") continue;
      const match = part.text.match(/<!--METADATA:([\s\S]*?)-->/);
      if (!match) continue;
      try {
        const legacy = parseContext((JSON.parse(match[1]) as AssistantMetadata).context);
        if (legacy) return legacy;
      } catch {
        // malformed comment: treat as no context
      }
    }
  }
  return null;
}

// Carrying the previous turn's people, merchants and dates into a question that
// does not refer back to them narrows it wrongly: "What did Kamal ask me?" then
// "What meetings do I have today?" would filter meetings to Kamal. So context is
// only used when the question reads as a follow-up.
const PRONOUN = /\b(he|she|him|her|his|they|them|their|it|those|these)\b/i;
const ONE_REFERENCE = /\b(that|this|the)\s+(\w+\s+)?one\b/i;
const FOLLOW_UP_LEAD = /^\s*(and|also|what about|how about|same|compared( to)?|vs\.?|versus|instead|only|just|then)\b/i;
const TIME_ONLY = /^\s*(and\s+|what about\s+|how about\s+)?((in|for|during)\s+)?((last|this|next|previous|the past)\s+(week|month|quarter|year)|today|yesterday|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\s*\??\s*$/i;

export function isFollowUpQuery(query: string): boolean {
  return PRONOUN.test(query) || ONE_REFERENCE.test(query) || FOLLOW_UP_LEAD.test(query) || TIME_ONLY.test(query);
}

// "What about Zomato?" / "and in August?" repeat the previous question with one
// slot swapped, so they keep its intent. Classified alone they read as generic
// lookups. Pronoun follow-ups ("did he follow up?") may change intent and don't.
function swapsOneSlot(query: string): boolean {
  return FOLLOW_UP_LEAD.test(query) || TIME_ONLY.test(query);
}

const SPEND_CATEGORIES = [...new Set(Object.values(MERCHANT_DATA).flatMap((m) => (m.category ? [m.category] : [])))];

// The new value in "what about transport?" replaces the slot it belongs to.
// Left to gap-filling, the previous turn's food category survived and the
// answer repeated food spending.
function swappedSubject(query: string): { category?: string; merchant?: string; text: string } | null {
  const m = query.match(/^\s*(?:and\s+)?(?:what about|how about|same for|compared to|vs\.?|versus|and)\s+(.+?)\s*\??\s*$/i);
  if (!m) return null;
  const text = m[1].replace(/^(my|the)\s+/i, "").trim();
  const lower = text.toLowerCase();
  const category = SPEND_CATEGORIES.find((c) => c === lower || c.startsWith(`${lower}_`) || c.replace(/_/g, " ") === lower);
  if (category) return { category, text };
  const merchant = findKnownMerchant(text);
  return merchant ? { merchant, text } : null;
}

// Merge conversation context with intent's entities (for retrieval)
export function mergeContextWithIntent(
  context: ConversationContext | null,
  intent: IntentResult,
  query = ""
): IntentResult {
  if (!context) return intent;

  const active = resolveActiveEntities(context);
  const swap = swappedSubject(query);
  const swapKey = swap?.text.toLowerCase();
  // Swapping to a category means "all of transport", not "transport at Swiggy".
  const merchants = swap?.category ? []
    : swap?.merchant ? [swap.merchant]
    : intent.entities.merchants.length > 0 ? intent.entities.merchants : active.merchants;
  const categories = swap?.category ? [swap.category]
    : intent.entities.categories.length > 0 ? intent.entities.categories : active.categories;
  // With merchants in the context hint, the classifier tagged "Zomato" as a
  // person too, which matched sender contacts and narrowed a spending question
  // to their emails. A name that is a merchant is not also a person.
  const merchantKeys = new Set(merchants.map((m) => m.toLowerCase()));
  const people = (intent.entities.people.length > 0 ? intent.entities.people : active.people)
    .filter((p) => !merchantKeys.has(p.toLowerCase()) && p.toLowerCase() !== swapKey);

  const inheritTopic = swapsOneSlot(query) && context.active_topic;

  // Merge: intent entities take priority, context fills gaps
  return {
    ...intent,
    primary: inheritTopic ? (context.active_topic as IntentType) : intent.primary,
    entities: {
      people,
      merchants,
      categories,
      topics: intent.entities.topics.length > 0 ? intent.entities.topics : active.topics,
      amount: intent.entities.amount,
    },
    temporal: intent.temporal ?? context.active_temporal,
  };
}
