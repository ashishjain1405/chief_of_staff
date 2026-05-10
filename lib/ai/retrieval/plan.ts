import type { IntentResult } from "../intent/classify";
import type { RetrievalStep } from "./types";
import type { ResolvedEntities } from "./resolve";

// Source confidence + cost reference table
const SOURCE_META: Record<string, { source_confidence: number; estimated_cost_ms: number; max_results: number }> = {
  sql_transactions:    { source_confidence: 0.95, estimated_cost_ms: 80,  max_results: 20 },
  sql_communications:  { source_confidence: 0.85, estimated_cost_ms: 100, max_results: 10 },
  sql_meetings:        { source_confidence: 0.80, estimated_cost_ms: 80,  max_results: 5  },
  sql_commitments:     { source_confidence: 0.90, estimated_cost_ms: 60,  max_results: 10 },
  sql_tasks:           { source_confidence: 0.90, estimated_cost_ms: 60,  max_results: 10 },
  aggregated_finance:  { source_confidence: 0.95, estimated_cost_ms: 90,  max_results: 1  },
  vector_search:       { source_confidence: 0.55, estimated_cost_ms: 200, max_results: 8  },
  operational_insights:{ source_confidence: 0.85, estimated_cost_ms: 50,  max_results: 15 },
};

function step(
  source: RetrievalStep["source"],
  purpose: string,
  filters: Record<string, unknown>,
  priority: number
): RetrievalStep {
  const meta = SOURCE_META[source];
  return { source, purpose, filters, priority, ...meta };
}

const FINANCE_INTENTS = new Set(["finance", "spending_analysis", "subscriptions", "bills_payments"]);
const VECTOR_INTENTS = new Set(["operational_summary", "search_lookup", "relationship", "commitments", "travel"]);

export function buildRetrievalPlan(
  intent: IntentResult,
  resolved: ResolvedEntities,
  query: string = "",
): RetrievalStep[] {
  const steps: RetrievalStep[] = [];
  const { operational_weight, investigative_weight } = intent.retrieval_weights;
  const queryLower = query.toLowerCase();
  const queryMentionsMeeting = /\b(meeting|meetings|meet|met|discussed in|discussion in)\b/.test(queryLower);
  const queryMentionsTask = /\b(task|tasks|action items?|follow.?ups?|to.?do|overdue|commit(ted|ments?)?|promises?|pending|ignored|unresolved|slipping|deadline|deadlines|blocked|blocker|escalate)\b/.test(queryLower);
  const queryIsTemporalLookup = /\bwhat (happened|changed)\s+(before|after|around|since|in|during)\b/.test(queryLower);
  const queryMentionsFinance = /\b(refund|refunds|transaction|transactions|debit|credit|payment|payments|charge|charges|spend|spent|spending|expense|expenses|atm|withdrawal|cashback|transfer|money|paid|salary|merchant|merchants|savings?)\b/.test(queryLower);
  const queryIsAggregation = /\b(top\s+merchants?|compare|month.{0,5}vs|spending\s+trend|category\s+breakdown|average\s+daily|monthly\s+trend|weekly\s+trend)\b/.test(queryLower);
  // Intent-signal: inv=1.0 + non-finance primary + no finance domain → comms are the natural source
  const isNonFinanceLookup = investigative_weight >= 1.0 && !FINANCE_INTENTS.has(intent.primary) && !queryMentionsFinance && !queryIsAggregation;
  // Explicit comms noun in query — stable narrow set that names the data source, not topic words
  const queryCommunicationExplicit = /\b(email|emails|communication|communications|conversation|conversations|discussion|discussions|thread|threads|chat|correspondence|said|wrote|message|messages)\b/.test(queryLower);
  const dateRange = resolved.resolvedDateRange;

  const allIntents = [intent.primary, ...intent.secondary];
  const hasOperationalSummaryIntent = allIntents.includes("operational_summary");

  // Operational path — always include for finance intents or when operational_summary is in intents
  if (operational_weight >= 0.3 || FINANCE_INTENTS.has(intent.primary) || hasOperationalSummaryIntent) {
    steps.push(step("operational_insights", "fetch precomputed operational insights", {
      category: intentToCategories(intent),
    }, 1));
  }

  // Investigative path — only if weight above threshold (keyword overrides bypass this gate)
  if (investigative_weight <= 0.3 && !isNonFinanceLookup && !queryMentionsMeeting && !queryMentionsTask && !queryIsTemporalLookup && !queryMentionsFinance && !queryCommunicationExplicit) return steps;

  const primary = intent.primary;

  // Finance / spending
  const hasFinanceSignal = FINANCE_INTENTS.has(primary) || allIntents.some(i => FINANCE_INTENTS.has(i)) ||
    intent.entities.categories.length > 0 || intent.entities.merchants.length > 0 ||
    queryMentionsFinance || queryIsAggregation;

  if (hasFinanceSignal) {
    const hasSpecificLookup = intent.entities.merchants.length > 0 || intent.entities.amount !== null;
    const isSpendingIntent = primary === "spending_analysis" || primary === "finance" ||
      allIntents.includes("spending_analysis") || allIntents.includes("finance");

    // Always add aggregation for spending/trend queries
    if (isSpendingIntent || queryIsAggregation) {
      steps.push(step("aggregated_finance", "compute spending breakdown", {
        categories: intent.entities.categories,
        merchants: resolved.merchantNames,
        dateRange,
      }, 2));
    }

    // Raw transactions — included for finance queries as fallback evidence
    // Skip for bills_payments: that branch adds its own targeted step with transactionTypes filter
    if (primary !== "bills_payments") {
      steps.push(step("sql_transactions", "find transactions", {
        merchants: resolved.merchantNames,
        categories: intent.entities.categories,
        dateRange,
        amount: intent.entities.amount,
      }, hasSpecificLookup ? 2 : 3));
    }
  }

  // Commitment / productivity lookups — also fires when query mentions task/follow-up keywords
  if (primary === "commitments" || primary === "productivity" || queryMentionsTask) {
    steps.push(step("sql_commitments", "find commitments", {
      ...(resolved.contactIds.length > 0 ? { contactIds: resolved.contactIds } : {}),
      dateRange,
    }, 2));
    steps.push(step("sql_tasks", "find tasks", {
      dateRange,
    }, 2));
  }

  // Operational summary — also include tasks for full situational picture
  if (hasOperationalSummaryIntent && !queryMentionsTask) {
    steps.push(step("sql_tasks", "find pending tasks", {
      dateRange,
    }, 3));
  }

  // Scheduling — also fires when query explicitly mentions meeting keywords
  if (primary === "scheduling" || primary === "travel" || queryMentionsMeeting) {
    steps.push(step("sql_meetings", "find meetings", {
      dateRange,
    }, 2));
  }

  // Travel — also fetch booking confirmation emails
  if (primary === "travel") {
    steps.push(step("sql_communications", "find travel booking emails", {
      emailCategory: ["travel"],
      dateRange,
    }, 2));
  }

  // Relationship / communication lookups
  if (primary === "relationship" || resolved.contactIds.length > 0) {
    steps.push(step("sql_communications", "find communications with contacts", {
      contactIds: resolved.contactIds,
      topics: intent.entities.topics,
      dateRange,
    }, 2));
    if (resolved.contactIds.length > 0) {
      steps.push(step("sql_meetings", "find meetings with contacts", {
        contactIds: resolved.contactIds,
        dateRange,
      }, 3));
    }
  }

  // Search lookup — communications + topics
  // Also fires for non-finance inv=1.0 lookups, or temporal-investigative queries ("what happened around/since X")
  if (primary === "search_lookup" || isNonFinanceLookup || queryCommunicationExplicit || queryIsTemporalLookup) {
    steps.push(step("sql_communications", "search email archive", {
      topics: intent.entities.topics,
      merchants: resolved.merchantNames,
      contactIds: resolved.contactIds,
      dateRange,
    }, primary === "search_lookup" ? 1 : 2));
  }

  // Bills
  if (primary === "bills_payments") {
    steps.push(step("sql_communications", "find bill emails", {
      emailCategory: ["finance_bills", "subscriptions_memberships"],
      dateRange,
    }, 2));
    steps.push(step("sql_transactions", "find bill transactions", {
      merchants: resolved.merchantNames,
      dateRange,
    }, 3));
  }

  // Operational summary / productivity — fetch recent communications for full situational context
  if (primary === "operational_summary" || primary === "productivity") {
    steps.push(step("sql_communications", "find recent emails for situational overview", {
      dateRange,
    }, 2));
  }

  // Vector search — for semantic recall intents
  if (VECTOR_INTENTS.has(primary) || investigative_weight > 0.5) {
    steps.push(step("vector_search", "semantic memory search", {
      query: buildVectorQuery(intent),
    }, 4));
  }

  return steps;
}

function intentToCategories(intent: IntentResult): string[] | null {
  if (intent.primary === "operational_summary") return null; // fetch all
  const CATEGORY_MAP: Partial<Record<string, string[]>> = {
    finance: ["finance", "spending_analysis"],
    spending_analysis: ["spending_analysis", "finance"],
    commitments: ["commitments", "productivity"],
    scheduling: ["scheduling"],
    productivity: ["productivity", "commitments"],
    relationship: ["relationship"],
    travel: ["travel", "scheduling"],
    subscriptions: ["subscriptions", "finance"],
    bills_payments: ["bills_payments", "finance"],
    reminders: ["reminders", "scheduling", "commitments"],
    search_lookup: [],
  };
  const cats = new Set<string>();
  for (const i of [intent.primary, ...intent.secondary]) {
    for (const c of CATEGORY_MAP[i] ?? []) cats.add(c);
  }
  return cats.size > 0 ? [...cats] : null;
}

function buildVectorQuery(intent: IntentResult): string {
  const parts: string[] = [];
  if (intent.entities.people.length > 0) parts.push(intent.entities.people.join(" "));
  if (intent.entities.merchants.length > 0) parts.push(intent.entities.merchants.join(" "));
  if (intent.entities.topics.length > 0) parts.push(intent.entities.topics.join(" "));
  if (intent.entities.categories.length > 0) parts.push(intent.entities.categories.join(" "));
  return parts.join(" ").trim() || intent.primary;
}
