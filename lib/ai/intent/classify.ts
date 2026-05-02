import OpenAI from "openai";
import type { IntentType } from "../processors/types";
import type { EntityContext, TemporalAnchor, RetrievalWeights, ConversationContext } from "../retrieval/types";
import { INTENT_RULES } from "./rules";

export interface IntentResult {
  primary: IntentType;
  secondary: IntentType[];
  confidence: number;
  entities: EntityContext;
  temporal: TemporalAnchor | null;
  retrieval_weights: RetrievalWeights;
}

const EMPTY_ENTITIES: EntityContext = {
  people: [], merchants: [], categories: [], topics: [], amount: null,
};

const FALLBACK_INTENT: IntentResult = {
  primary: "operational_summary",
  secondary: [],
  confidence: 0.3,
  entities: EMPTY_ENTITIES,
  temporal: null,
  retrieval_weights: { operational_weight: 1.0, investigative_weight: 0.0 },
};

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function regexCandidates(query: string): Map<IntentType, number> {
  const lower = query.toLowerCase();
  const hits = new Map<IntentType, number>();

  for (const rule of INTENT_RULES) {
    const count = rule.patterns.filter((p) => p.test(lower)).length;
    if (count > 0) {
      hits.set(rule.intent, (hits.get(rule.intent) ?? 0) + count);
    }
  }
  return hits;
}

async function classifyWithLLM(
  query: string,
  candidates: IntentType[],
  context: ConversationContext | null
): Promise<IntentResult> {
  const allIntents: IntentType[] = [
    "operational_summary", "finance", "spending_analysis", "commitments",
    "scheduling", "productivity", "relationship", "travel", "search_lookup",
    "subscriptions", "bills_payments", "reminders",
  ];

  const contextHint = context && context.tracked_entities.length > 0
    ? `\nConversation context (active entities from prior turns): ${JSON.stringify({
        entities: context.tracked_entities.slice(0, 5).map(e => ({ value: e.value, type: e.entity_type })),
        topic: context.active_topic,
      })}`
    : "";

  const prompt = `Classify this query and extract retrieval parameters.

Query: "${query}"${contextHint}

Regex-suggested candidates: ${candidates.length > 0 ? candidates.join(", ") : "none"}

Available intents:
- operational_summary: daily brief, catch me up, what's important
- finance: transactions, spending, debit/credit, unusual charges
- spending_analysis: spending trends, category breakdown, budget analysis
- commitments: promises made, overdue commitments, what did I say I'd do
- scheduling: meetings, calendar, what's today/tomorrow
- productivity: tasks, action items, priorities, blockers
- relationship: follow-ups, investor/client/contact status
- travel: flights, hotel, booking, itinerary, PNR
- search_lookup: find a specific email/note/document
- subscriptions: subscriptions, renewals, memberships, recurring charges
- bills_payments: bills due, credit card, EMI, payment reminders
- reminders: remind me, don't forget, upcoming alerts

Return ONLY valid JSON:
{
  "primary": "...",
  "secondary": ["..."],
  "confidence": 0.0-1.0,
  "entities": {
    "people": [],
    "merchants": [],
    "categories": [],
    "topics": [],
    "amount": null
  },
  "temporal": null,
  "retrieval_weights": {
    "operational_weight": 0.0-1.0,
    "investigative_weight": 0.0-1.0
  }
}

temporal can be:
- null (no time reference)
- {"type":"relative","relativePeriod":"last_month"} (this_week/last_week/this_month/last_month/last_quarter/today/this_year)
- {"type":"absolute","dateRange":{"from":"2026-01-01","to":"2026-01-31"}}
- {"type":"event_relative","anchor_event":"salary_credit|travel_booking|named_meeting|named_contact_interaction","anchor_ref":"...","relative_window":"+7d"}

retrieval_weights guidance:
- operational_weight=1.0 for catch-me-up, status, what's urgent, daily brief
- investigative_weight=1.0 for specific factual lookups (did I pay X, find email about Y)
- both high (0.6-0.8) for analytical questions (why am I overspending, what commitments are at risk)
- operational_weight=0.0 for pure search (find email about insurance)`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 300,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  const primary = allIntents.includes(parsed.primary) ? parsed.primary as IntentType : "operational_summary";
  const secondary = (parsed.secondary ?? [])
    .filter((s: string) => allIntents.includes(s as IntentType) && s !== primary)
    .slice(0, 2) as IntentType[];
  const confidence = typeof parsed.confidence === "number"
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.7;

  const entities: EntityContext = {
    people: Array.isArray(parsed.entities?.people) ? parsed.entities.people : [],
    merchants: Array.isArray(parsed.entities?.merchants) ? parsed.entities.merchants : [],
    categories: Array.isArray(parsed.entities?.categories) ? parsed.entities.categories : [],
    topics: Array.isArray(parsed.entities?.topics) ? parsed.entities.topics : [],
    amount: typeof parsed.entities?.amount === "number" ? parsed.entities.amount : null,
  };

  const temporal: TemporalAnchor | null = parsed.temporal ?? null;

  const retrieval_weights: RetrievalWeights = {
    operational_weight: typeof parsed.retrieval_weights?.operational_weight === "number"
      ? Math.min(1, Math.max(0, parsed.retrieval_weights.operational_weight))
      : 0.7,
    investigative_weight: typeof parsed.retrieval_weights?.investigative_weight === "number"
      ? Math.min(1, Math.max(0, parsed.retrieval_weights.investigative_weight))
      : 0.3,
  };

  return { primary, secondary, confidence, entities, temporal, retrieval_weights };
}

export async function classifyIntent(
  query: string,
  context?: ConversationContext | null
): Promise<IntentResult> {
  try {
    const hits = regexCandidates(query);

    if (hits.size === 0) {
      return await Promise.race([
        classifyWithLLM(query, [], context ?? null),
        new Promise<IntentResult>((resolve) =>
          setTimeout(() => resolve(FALLBACK_INTENT), 1500)
        ),
      ]);
    }

    const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]);
    const topCandidates = sorted.slice(0, 2).map(([intent]) => intent);

    const llmResult = await Promise.race([
      classifyWithLLM(query, topCandidates, context ?? null),
      new Promise<IntentResult>((resolve) =>
        setTimeout(() => {
          const primary: IntentType = topCandidates[0] ?? "operational_summary";
          const secondary: IntentType[] = topCandidates.slice(1);
          const maxHits = sorted[0][1];
          const confidence = Math.min(0.95, 0.6 + maxHits * 0.1);
          resolve({
            primary, secondary, confidence,
            entities: EMPTY_ENTITIES,
            temporal: null,
            retrieval_weights: { operational_weight: 0.8, investigative_weight: 0.2 },
          });
        }, 1500)
      ),
    ]);

    return llmResult;
  } catch {
    return FALLBACK_INTENT;
  }
}

export { FALLBACK_INTENT };
