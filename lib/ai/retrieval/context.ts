import type { UIMessage } from "ai";
import type { ConversationContext, TrackedEntity, EntityContext, AssistantMetadata } from "./types";
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
      if (!existing.some((e) => e.value === v && e.entity_type === type)) {
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

export function decodeConversationContext(messages: UIMessage[]): ConversationContext | null {
  // Look for the last assistant message that has assistant_metadata in its content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;

    // Check parts for metadata
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if ((part as any).type === "text") {
          const text: string = (part as any).text ?? "";
          const match = text.match(/<!--METADATA:([\s\S]*?)-->/);
          if (match) {
            try {
              const meta: AssistantMetadata = JSON.parse(match[1]);
              return meta.context ?? null;
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    }
  }
  return null;
}

// Merge conversation context with intent's entities (for retrieval)
export function mergeContextWithIntent(
  context: ConversationContext | null,
  intent: IntentResult
): IntentResult {
  if (!context) return intent;

  const active = resolveActiveEntities(context);

  // Merge: intent entities take priority, context fills gaps
  return {
    ...intent,
    entities: {
      people: intent.entities.people.length > 0 ? intent.entities.people : active.people,
      merchants: intent.entities.merchants.length > 0 ? intent.entities.merchants : active.merchants,
      categories: intent.entities.categories.length > 0 ? intent.entities.categories : active.categories,
      topics: intent.entities.topics.length > 0 ? intent.entities.topics : active.topics,
      amount: intent.entities.amount,
    },
    temporal: intent.temporal ?? context.active_temporal,
  };
}
