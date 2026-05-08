import OpenAI from "openai";
import type { IntentType } from "../processors/types";
import type { EntityContext, TemporalAnchor, RetrievalWeights, ConversationContext } from "../retrieval/types";
import { INTENT_RULES } from "./rules";
import { MERCHANT_DATA } from "../../finance/normalize";

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
  { pattern: /\btoday\b/i,                           period: "today" },
  { pattern: /\bthis week\b/i,                       period: "this_week" },
  { pattern: /\b(last|past|previous)\s+week\b/i,     period: "last_week" },
  { pattern: /\bthis month\b/i,                      period: "this_month" },
  { pattern: /\b(last|past|previous)\s+month\b/i,    period: "last_month" },
  { pattern: /\bthis quarter\b/i,                    period: "this_quarter" },
  { pattern: /\b(last|past|previous)\s+quarter\b/i,  period: "last_quarter" },
  { pattern: /\bthis year\b/i,                       period: "this_year" },
  { pattern: /\b(last|past|previous)\s+year\b/i,     period: "last_year" },
];

function inferMerchants(query: string): string[] {
  const lower = query.toLowerCase();
  return Object.keys(MERCHANT_DATA).filter((canonical) => {
    const name = canonical.toLowerCase();
    const idx = lower.indexOf(name);
    if (idx === -1) return false;
    // Require word boundaries so "act" doesn't match inside "transactions"
    const before = idx === 0 || /\W/.test(lower[idx - 1]);
    const after = idx + name.length === lower.length || /\W/.test(lower[idx + name.length]);
    return before && after;
  });
}

// Rolling patterns: "last N days/weeks/months/years" → absolute dateRange
function inferRollingDays(query: string): TemporalAnchor | null {
  const m = query.match(/\blast\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const to = new Date();
  let from: Date;
  if (unit.startsWith("year")) {
    from = new Date(to);
    from.setFullYear(from.getFullYear() - n);
  } else if (unit.startsWith("month")) {
    from = new Date(to);
    from.setMonth(from.getMonth() - n);
  } else if (unit.startsWith("week")) {
    from = new Date(to.getTime() - n * 7 * 864e5);
  } else {
    from = new Date(to.getTime() - n * 864e5);
  }
  return { type: "absolute", dateRange: { from: from.toISOString(), to: to.toISOString() } };
}

function inferTemporal(query: string): TemporalAnchor | null {
  const rolling = inferRollingDays(query);
  if (rolling) return rolling;
  if (/\byesterday\b/i.test(query)) {
    const to = new Date();
    const from = new Date(to.getTime() - 864e5);
    return { type: "absolute", dateRange: { from: from.toISOString(), to: to.toISOString() } };
  }
  if (/\btomorrow\b/i.test(query)) {
    const from = new Date();
    const to = new Date(from.getTime() + 864e5);
    return { type: "absolute", dateRange: { from: from.toISOString(), to: to.toISOString() } };
  }
  const MONTH_NAMES: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const monthMatch = /\b(?:(?:in|for|during|of)\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i.exec(query);
  if (monthMatch) {
    const idx = MONTH_NAMES[monthMatch[1].toLowerCase()];
    const today = new Date();
    let year = today.getFullYear();
    if (idx > today.getMonth()) year -= 1;
    const from = new Date(year, idx, 1);
    const to = new Date(year, idx + 1, 0, 23, 59, 59);
    return { type: "absolute", dateRange: { from: from.toISOString(), to: to.toISOString() } };
  }
  for (const { pattern, period } of TEMPORAL_PATTERNS) {
    if (pattern.test(query)) return { type: "relative", relativePeriod: period };
  }
  return null;
}

// Extracts likely person names from query when LLM is unavailable.
// Looks for capitalized word sequences (1-3 words) near relational trigger words.
function inferPeople(query: string): string[] {
  const matches: string[] = [];
  const FIRST_PERSON = new Set(["i", "me", "my", "we", "our", "us"]);
  // Trigger words before a name — case-insensitive, any casing
  const triggerPattern = /\b(?:did|with|told|asked|about|regarding|to|by|meet|met)\s+([A-Za-z][a-zA-Z\s]{1,40}?)(?=\s+(?:say|tell|send|write|message|call|contact|email|about|on|regarding|in|after|before)|[.!?]?$)/gi;
  let m: RegExpExecArray | null;
  while ((m = triggerPattern.exec(query)) !== null) {
    const name = m[1].trim();
    const firstWord = name.split(/\s+/)[0].toLowerCase();
    if (name.split(/\s+/).length <= 3 && !FIRST_PERSON.has(firstWord)) matches.push(name);
  }
  // "from X" / "emails from X" — case-insensitive, captures until end or preposition
  const fromPattern = /\b(?:emails?\s+from|messages?\s+from|from)\s+([A-Za-z][\w\s.-]{1,40}?)(?:\s*$|\s+(?:about|on|regarding|in|last|this|today|yesterday))/gi;
  while ((m = fromPattern.exec(query)) !== null) {
    const name = m[1].trim();
    if (name.length > 1) matches.push(name);
  }
  // "from X" at end of query
  const fromEnd = /\bfrom\s+([A-Za-z][\w\s.-]{1,40}?)$/i.exec(query);
  if (fromEnd) matches.push(fromEnd[1].trim());
  // Leading: "What did Ashish Jain say"
  const leading = /^(?:what|when|why|how|show|find|get)\s+did\s+([A-Za-z][\w\s]{1,40}?)\s+(?:say|send|write|tell)/i.exec(query);
  if (leading && !FIRST_PERSON.has(leading[1].trim().toLowerCase())) matches.push(leading[1].trim());
  // "Did I meet/see/talk to X" — first-person activity with named person
  const didIMeet = /\bdid\s+(?:i|we)\s+(?:meet|see|talk\s+to|speak\s+with|chat\s+with)\s+([A-Za-z][\w\s]{1,40}?)(?:[.!?]?$|\s+(?:about|on|regarding|in|after|before))/i.exec(query);
  if (didIMeet) {
    const name = didIMeet[1].trim().replace(/[.!?]+$/, "");
    if (name.length > 1 && !FIRST_PERSON.has(name.split(/\s+/)[0].toLowerCase())) matches.push(name);
  }
  // "last/latest thing X asked/said/told" — captures name before communication verb
  const lastThingPattern = /\b(?:last|latest|recent)\s+(?:thing|message|question|email)?\s*([A-Za-z][a-zA-Z]+(?:\s+[A-Za-z]+)?)\s+(?:asked?|said?|wrote?|told?|sent?|mention(?:ed)?)\b/i.exec(query);
  if (lastThingPattern) {
    const name = lastThingPattern[1].trim();
    if (name.length > 1 && !FIRST_PERSON.has(name.split(/\s+/)[0].toLowerCase())) matches.push(name);
  }
  return [...new Set(matches.filter(Boolean))];
}

function applyDeterministicOverrides(
  primary: IntentType,
  query: string,
  weights: RetrievalWeights
): RetrievalWeights {
  const lower = query.toLowerCase();

  // Analytical reasoning queries: "why X", "am I over-X", "is it X", "should I [action]"
  // Exclude "should I know" — that's informational (daily brief scope), not analytical
  const isAnalyticalQuery = /\b(why|am i|is it|are we)\b/.test(lower) ||
    (/\bshould i\b/.test(lower) && !/\bshould i know\b/.test(lower));

  const isSpendingQuery =
    !isAnalyticalQuery && (
      ["finance", "spending_analysis", "subscriptions", "bills_payments"].includes(primary) ||
      /\b(show|how much|breakdown|spent|spending|expenses?|charges?|paid|transactions?|merchant|merchants|compare|savings?)\b/.test(lower)
    );

  if (isSpendingQuery) {
    return { operational_weight: 0.1, investigative_weight: 1.0 };
  }

  if (primary === "search_lookup" || /\b(find|search|look up|show me)\b/.test(lower)) {
    return { operational_weight: 0.0, investigative_weight: 1.0 };
  }

  // Scheduling and relationship queries always need SQL retrieval — ensure investigative path runs
  if (primary === "scheduling" || primary === "relationship" || primary === "commitments" || primary === "productivity") {
    return {
      operational_weight: Math.max(weights.operational_weight, 0.3),
      investigative_weight: Math.max(weights.investigative_weight, 0.5),
    };
  }

  // Specific lookup patterns — not daily briefs even if LLM says operational_summary
  // Exclude only "since yesterday/today" — "since last week/month/quarter" is investigative
  const isDailyBriefScope = /\bsince\s+(yesterday|today)\b/.test(lower);
  const isLookupQuery = !isDailyBriefScope && (
    /\bwhat do i know about\b/.test(lower) ||
    /\bwhat (happened|changed)\s+(before|after|around|since|in|during)\b/.test(lower) ||
    /\bdid (i|anyone|someone|anybody)\s+(get|receive|have|see|mention|say|ask|write|send|meet|pay)\b/.test(lower) ||
    /\bhow many times did (i|we)\s+(meet|see|talk|speak|chat)\b/.test(lower) ||
    /\b(last|latest|most recent)\s+(thing|message|email|question)\s+\w+\s+(ask|said?|wrote?|told?|sent?|mention)/i.test(lower)
  );
  if (isLookupQuery) {
    return { operational_weight: 0.0, investigative_weight: 1.0 };
  }

  // Analytical queries always need some investigative signal — floor before op_summary zeroing
  if (isAnalyticalQuery) {
    return {
      operational_weight: Math.max(weights.operational_weight, 0.3),
      investigative_weight: Math.max(weights.investigative_weight, 0.5),
    };
  }

  if (
    primary === "operational_summary" ||
    /\b(catch me up|brief me|what.s urgent|daily brief|status update|what.s important|whats new|what happened|anything new|what do i need to know|what should i focus on|what changed|what needs attention|what am i missing)\b/.test(lower)
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
  // Always run inferMerchants to canonicalize LLM merchants (e.g. "Amazon Pay" → "Amazon", "Zomato Ltd" → "Zomato")
  const inferred = inferMerchants(query);
  // Start with inferred canonicals; for each LLM merchant not already covered, add it
  const inferredLower = new Set(inferred.map((m) => m.toLowerCase()));
  const merged = [...inferred];
  for (const llmM of result.entities.merchants) {
    const llmLower = llmM.toLowerCase();
    // Skip if already covered by an inferred canonical (exact or the LLM is a longer variant of a canonical)
    const coveredByInferred = inferred.some((c) => llmLower === c.toLowerCase() || llmLower.startsWith(c.toLowerCase() + " "));
    if (!coveredByInferred && !inferredLower.has(llmLower)) {
      merged.push(llmM);
    }
  }
  const merchants = merged.length > 0 ? merged : result.entities.merchants;
  // For search_lookup only: inferred senders go into topics for subject/body ILIKE search
  const topics = result.entities.topics.length === 0 && result.primary === "search_lookup"
    ? people
    : result.entities.topics;
  const entities = { ...result.entities, categories, people, merchants, topics };
  const temporal = result.temporal ?? inferTemporal(query);
  let retrieval_weights = applyDeterministicOverrides(result.primary, query, result.retrieval_weights);
  // Structural catch-up detection: "What X?" with no specific target → daily brief
  // Only applies when LLM also classified as operational/productivity (no specific domain)
  // Excluded when query has finance/spending/task domain keywords (even if LLM misclassifies)
  const queryLower = query.toLowerCase();
  const hasFinanceDomain = /\b(spend|spending|spent|expense|expenses|transaction|transactions|merchant|merchants|charge|charges|overdue|commit|deadline|bill|payment|atm|withdrawal|refund|invest)\b/.test(queryLower);
  const isCatchUpQuery =
    (result.primary === "operational_summary" || result.primary === "productivity") &&
    /^(what|anything)\b/i.test(queryLower) &&
    !hasFinanceDomain &&
    retrieval_weights.investigative_weight < 0.5 &&
    entities.people.length === 0 &&
    entities.merchants.length === 0 &&
    entities.topics.length === 0 &&
    temporal === null;
  if (isCatchUpQuery) {
    retrieval_weights = { operational_weight: 1.0, investigative_weight: 0.0 };
  }
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

  const TOPIC_NOISE = new Set(["emails", "email", "messages", "message", "show", "find", "search", "notifications"]);

  const llmPeople: string[] = Array.isArray(parsed.entities?.people) ? parsed.entities.people : [];
  const llmMerchants: string[] = Array.isArray(parsed.entities?.merchants) ? parsed.entities.merchants : [];
  const llmTopics: string[] = (Array.isArray(parsed.entities?.topics) ? parsed.entities.topics : [])
    .filter((t: string) => !TOPIC_NOISE.has(t.toLowerCase()));

  const people = llmPeople.length > 0 ? llmPeople : inferPeople(query);
  // inferMerchants returns canonical MERCHANT_DATA keys; always use as base, add LLM merchants only when unknown
  const canonicalMerchants = inferMerchants(query);
  const canonicalLower = new Set(canonicalMerchants.map((m) => m.toLowerCase()));
  const extraLlmMerchants = llmMerchants.filter((m) =>
    !canonicalLower.has(m.toLowerCase()) &&
    !canonicalMerchants.some((c) => m.toLowerCase().startsWith(c.toLowerCase() + " "))
  );
  const merchants = canonicalMerchants.length > 0 ? [...canonicalMerchants, ...extraLlmMerchants] : llmMerchants;
  // For search_lookup only: if topics empty, use inferred senders for subject/body ILIKE search
  // Other intents (scheduling, relationship etc.) should not have people bleed into topics
  const topics = llmTopics.length > 0
    ? llmTopics
    : (primary === "search_lookup" ? people : []);

  const entities: EntityContext = {
    people,
    merchants,
    categories: inferredCategories,
    topics,
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
