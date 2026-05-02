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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  food_delivery:   ["food", "swiggy", "zomato", "uber eats", "delivery", "meal", "restaurant", "dinner", "lunch"],
  groceries:       ["grocery", "groceries", "bigbasket", "blinkit", "zepto", "supermarket", "vegetables", "fruits"],
  travel:          ["travel", "flight", "hotel", "trip", "booking", "cab", "uber", "ola", "rapido", "train", "bus"],
  entertainment:   ["entertainment", "netflix", "spotify", "prime", "hotstar", "youtube", "movie", "music"],
  subscriptions:   ["subscription", "subscriptions", "membership", "renewal", "saas", "plan"],
  utilities:       ["electricity", "water", "gas", "broadband", "internet", "recharge", "mobile"],
  healthcare:      ["hospital", "doctor", "medicine", "pharmacy", "health", "clinic", "insurance"],
  shopping:        ["amazon", "flipkart", "myntra", "shopping", "clothes", "fashion", "electronics"],
  education:       ["course", "udemy", "coursera", "tuition", "school", "college", "education"],
};

function inferCategories(query: string): string[] {
  const lower = query.toLowerCase();
  const matched: string[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) matched.push(category);
  }
  return matched;
}

const TEMPORAL_PATTERNS: { pattern: RegExp; period: NonNullable<TemporalAnchor["relativePeriod"]> }[] = [
  { pattern: /\btoday\b/i,          period: "today" },
  { pattern: /\bthis week\b/i,      period: "this_week" },
  { pattern: /\blast week\b/i,      period: "last_week" },
  { pattern: /\bthis month\b/i,     period: "this_month" },
  { pattern: /\blast month\b/i,     period: "last_month" },
  { pattern: /\bthis quarter\b/i,   period: "this_quarter" },
  { pattern: /\blast quarter\b/i,   period: "last_quarter" },
  { pattern: /\bthis year\b/i,      period: "this_year" },
  { pattern: /\blast year\b/i,      period: "last_year" },
];

// Rolling-day patterns: "last N days/weeks" → absolute dateRange computed immediately
function inferRollingDays(query: string): TemporalAnchor | null {
  const m = query.match(/\blast\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const days = unit.startsWith("week") ? n * 7 : n;
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  return { type: "absolute", dateRange: { from: from.toISOString(), to: to.toISOString() } };
}

function inferTemporal(query: string): TemporalAnchor | null {
  const rolling = inferRollingDays(query);
  if (rolling) return rolling;
  for (const { pattern, period } of TEMPORAL_PATTERNS) {
    if (pattern.test(query)) return { type: "relative", relativePeriod: period };
  }
  return null;
}

// Extracts likely person names from query when LLM is unavailable.
// Looks for capitalized word sequences (1-3 words) near relational trigger words.
function inferPeople(query: string): string[] {
  const matches: string[] = [];
  // Pattern: trigger word followed by 1-3 capitalized words
  const pattern = /\b(?:did|from|with|told|asked|about|regarding|to|by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(query)) !== null) {
    matches.push(m[1]);
  }
  // Also catch leading patterns: "What did Ashish Jain say" — name at start after "did"
  const leading = /^(?:what|when|why|how|show|find|get)\s+did\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i.exec(query);
  if (leading) matches.push(leading[1]);
  return [...new Set(matches)];
}

function applyDeterministicOverrides(
  primary: IntentType,
  query: string,
  weights: RetrievalWeights
): RetrievalWeights {
  const lower = query.toLowerCase();

  const isSpendingQuery =
    ["finance", "spending_analysis", "subscriptions", "bills_payments"].includes(primary) ||
    /\b(show|how much|breakdown|spent|spending|expenses?|charges?|paid|transactions?)\b/.test(lower);

  if (isSpendingQuery) {
    return { operational_weight: 0.1, investigative_weight: 1.0 };
  }

  if (primary === "search_lookup" || /\b(find|search|look up|show me|did i)\b/.test(lower)) {
    return { operational_weight: 0.0, investigative_weight: 1.0 };
  }

  if (
    primary === "operational_summary" ||
    /\b(catch me up|brief me|what.s urgent|daily brief|status update|what.s important|whats new|what happened|anything new|what do i need to know|what should i focus on)\b/.test(lower)
  ) {
    return { operational_weight: 1.0, investigative_weight: 0.0 };
  }

  return weights;
}

function applyOverrides(query: string, result: IntentResult): IntentResult {
  const categories = result.entities.categories.length === 0
    ? inferCategories(query)
    : result.entities.categories;
  const people = result.entities.people.length === 0
    ? inferPeople(query)
    : result.entities.people;
  const entities = { ...result.entities, categories, people };
  const retrieval_weights = applyDeterministicOverrides(result.primary, query, result.retrieval_weights);
  const temporal = result.temporal ?? inferTemporal(query);
  return { ...result, entities, retrieval_weights, temporal };
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

entities guidance:
- categories: spending/domain categories mentioned — e.g. "food" → ["food_delivery","groceries"], "travel" → ["travel"], "subscriptions" → ["subscriptions"], "entertainment" → ["entertainment"]. Always populate for spending queries.
- merchants: specific brand/service names — e.g. "Swiggy", "Netflix", "AWS"
- people: person names mentioned — e.g. "John", "Rahul"
- topics: subject matter — e.g. "insurance", "rent", "salary"
- amount: specific rupee/dollar amount if mentioned, else null

retrieval_weights guidance:
- operational_weight=1.0, investigative_weight=0.0 → catch-me-up, what's urgent, daily brief, status
- operational_weight=0.0, investigative_weight=1.0 → specific factual lookup: "did I pay X", "find email about Y", "show transactions for Z"
- operational_weight=0.1, investigative_weight=1.0 → show/breakdown spending queries: "show food spending", "how much did I spend on X", "food expenses"
- operational_weight=0.6, investigative_weight=0.8 → analytical: "why am I overspending", "what commitments are at risk", "am I spending too much"
- operational_weight=0.0, investigative_weight=1.0 → pure search: "find email about insurance"

IMPORTANT: "show X spending", "how much did I spend on X", "X expenses" → investigative_weight MUST be >= 0.8`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 400,
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

  const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_KEYWORDS));
  const llmCategories: string[] = Array.isArray(parsed.entities?.categories)
    ? parsed.entities.categories.filter((c: string) => VALID_CATEGORIES.has(c))
    : [];
  const inferredCategories = llmCategories.length === 0 ? inferCategories(query) : llmCategories;

  const entities: EntityContext = {
    people: Array.isArray(parsed.entities?.people) ? parsed.entities.people : [],
    merchants: Array.isArray(parsed.entities?.merchants) ? parsed.entities.merchants : [],
    categories: inferredCategories,
    topics: Array.isArray(parsed.entities?.topics) ? parsed.entities.topics : [],
    amount: typeof parsed.entities?.amount === "number" ? parsed.entities.amount : null,
  };

  const temporal: TemporalAnchor | null = parsed.temporal ?? inferTemporal(query);

  const llmWeights: RetrievalWeights = {
    operational_weight: typeof parsed.retrieval_weights?.operational_weight === "number"
      ? Math.min(1, Math.max(0, parsed.retrieval_weights.operational_weight))
      : 0.7,
    investigative_weight: typeof parsed.retrieval_weights?.investigative_weight === "number"
      ? Math.min(1, Math.max(0, parsed.retrieval_weights.investigative_weight))
      : 0.3,
  };

  const retrieval_weights = applyDeterministicOverrides(primary, query, llmWeights);

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
          setTimeout(() => resolve(applyOverrides(query, FALLBACK_INTENT)), 3000)
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
          resolve(applyOverrides(query, {
            primary, secondary, confidence,
            entities: EMPTY_ENTITIES,
            temporal: null,
            retrieval_weights: { operational_weight: 0.8, investigative_weight: 0.2 },
          }));
        }, 3000)
      ),
    ]);

    return llmResult;
  } catch {
    return applyOverrides(query, FALLBACK_INTENT);
  }
}

export { FALLBACK_INTENT };
