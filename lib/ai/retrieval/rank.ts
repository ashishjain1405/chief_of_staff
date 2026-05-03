import type {
  RetrievalItem, RankingProfile, AggregatedFinance, EntityContext, TemporalAnchor,
  TransactionRetrievalItem, CommunicationRetrievalItem, MeetingRetrievalItem,
  CommitmentRetrievalItem, InsightRetrievalItem, VectorRetrievalItem,
  AggregatedFinanceRetrievalItem,
} from "./types";
import type { RawResults } from "./execute";

// Profile-aware ranking weights
const PROFILE_WEIGHTS: Record<RankingProfile, {
  exact_keyword: number;
  semantic: number;
  entity_overlap: number;
  recency: number;
  source_importance: number;
  urgency_priority: number;
}> = {
  factual_finance: { exact_keyword: 0.35, semantic: 0.15, entity_overlap: 0.15, recency: 0.25, source_importance: 0.05, urgency_priority: 0.05 },
  semantic_lookup: { exact_keyword: 0.10, semantic: 0.35, entity_overlap: 0.25, recency: 0.15, source_importance: 0.05, urgency_priority: 0.10 },
  relationship:    { exact_keyword: 0.10, semantic: 0.25, entity_overlap: 0.35, recency: 0.15, source_importance: 0.05, urgency_priority: 0.10 },
  operational:     { exact_keyword: 0.05, semantic: 0.10, entity_overlap: 0.10, recency: 0.15, source_importance: 0.10, urgency_priority: 0.50 },
};

export const DEFAULT_DIVERSITY_CAPS: Record<string, number> = {
  sql_communications:   4,
  sql_transactions:     3,
  sql_meetings:         2,
  sql_commitments:      3,
  sql_tasks:            2,
  vector_search:        2,
  operational_insights: 6,
  aggregated_finance:   1,
};

export function getRankingProfile(primary: string): RankingProfile {
  if (["finance", "spending_analysis", "bills_payments", "subscriptions"].includes(primary)) return "factual_finance";
  if (primary === "search_lookup") return "semantic_lookup";
  if (primary === "relationship") return "relationship";
  return "operational";
}

function recencyScore(dateStr: string | null): number {
  if (!dateStr) return 0.3;
  const daysOld = (Date.now() - new Date(dateStr).getTime()) / 864e5;
  return Math.max(0, 1 - daysOld / 90);
}

function keywordScore(text: string, query: string, entities: EntityContext): number {
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/).filter((w) => w.length > 2);
  const allEntities = [
    ...entities.people,
    ...entities.merchants,
    ...entities.topics,
    ...entities.categories,
  ].map((e) => e.toLowerCase());

  const wordHits = words.filter((w) => lower.includes(w)).length / Math.max(words.length, 1);
  const entityHits = allEntities.filter((e) => lower.includes(e)).length / Math.max(allEntities.length, 1);
  return (wordHits * 0.5 + entityHits * 0.5);
}

function entityOverlapScore(text: string, entities: EntityContext): number {
  const lower = text.toLowerCase();
  const allEntities = [
    ...entities.people,
    ...entities.merchants,
    ...entities.topics,
    ...entities.categories,
  ];
  if (allEntities.length === 0) return 0.3;
  const hits = allEntities.filter((e) => lower.includes(e.toLowerCase())).length;
  return hits / allEntities.length;
}

function scoreItem(
  text: string,
  date: string | null,
  sourceConfidence: number,
  urgencyPriority: number,
  query: string,
  entities: EntityContext,
  weights: (typeof PROFILE_WEIGHTS)[RankingProfile]
): number {
  return (
    weights.exact_keyword * keywordScore(text, query, entities) +
    weights.semantic * keywordScore(text, query, entities) +  // v1: keyword proxy for semantic
    weights.entity_overlap * entityOverlapScore(text, entities) +
    weights.recency * recencyScore(date) +
    weights.source_importance * sourceConfidence +
    weights.urgency_priority * urgencyPriority
  );
}

// ─── Normalizers per source ────────────────────────────────────────────────

function normalizeInsights(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): InsightRetrievalItem[] {
  return rows.map((row) => {
    const text = `${row.title} ${row.summary}`;
    const urgencyPriority = row.priority_score ?? 0.5;
    return {
      item_type: "insight" as const,
      source: "operational_insights" as const,
      source_confidence: 0.85,
      retrieval_score: scoreItem(text, row.last_seen_at, 0.85, urgencyPriority, query, entities, weights),
      data: {
        id: row.id, state_key: row.state_key, category: row.category,
        insight_type: row.insight_type, title: row.title, summary: row.summary,
        urgency: row.urgency, priority_score: row.priority_score,
        recommended_action: row.recommended_action ?? null,
        explanation: row.explanation ?? null,
      },
    };
  });
}

function normalizeTransactions(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): TransactionRetrievalItem[] {
  return rows.map((row) => {
    const text = `${row.merchant_normalized ?? ""} ${row.category ?? ""} ${row.transaction_type ?? ""}`;
    return {
      item_type: "transaction" as const,
      source: "sql_transactions" as const,
      source_confidence: 0.95,
      retrieval_score: scoreItem(text, row.transaction_datetime, 0.95, 0.3, query, entities, weights),
      data: {
        id: row.id, merchant_normalized: row.merchant_normalized, amount: row.amount,
        currency: row.currency, category: row.category,
        transaction_datetime: row.transaction_datetime, transaction_type: row.transaction_type,
        bank_name: row.bank_name, payment_method: row.payment_method,
      },
    };
  });
}

function normalizeCommunications(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): CommunicationRetrievalItem[] {
  return rows.map((row) => {
    const text = `${row.subject ?? ""} ${row.body_summary ?? ""} ${row.contact_name ?? ""}`;
    return {
      item_type: "communication" as const,
      source: "sql_communications" as const,
      source_confidence: 0.85,
      retrieval_score: scoreItem(text, row.occurred_at, 0.85, row.requires_action ? 0.6 : 0.2, query, entities, weights),
      data: {
        id: row.id, subject: row.subject, body_summary: row.body_summary,
        occurred_at: row.occurred_at, sentiment: row.sentiment,
        email_category: row.email_category, requires_action: row.requires_action,
        contact_name: row.contact_name,
      },
    };
  });
}

function normalizeMeetings(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): MeetingRetrievalItem[] {
  return rows.map((row) => {
    const summary = row.transcript_summary ?? row.executive_summary ?? row.description ?? "";
    const text = `${row.title ?? ""} ${summary}`;
    return {
      item_type: "meeting" as const,
      source: "sql_meetings" as const,
      source_confidence: 0.80,
      retrieval_score: scoreItem(text, row.start_time, 0.80, 0.3, query, entities, weights),
      data: {
        id: row.id, title: row.title, start_time: row.start_time,
        executive_summary: summary, attendees: row.attendees,
      },
    };
  });
}

function normalizeCommitments(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): CommitmentRetrievalItem[] {
  return rows.map((row) => {
    const text = `${row.description ?? ""} ${row.to_contact_name ?? ""}`;
    const isOverdue = row.due_date && new Date(row.due_date) < new Date();
    return {
      item_type: "commitment" as const,
      source: "sql_commitments" as const,
      source_confidence: 0.90,
      retrieval_score: scoreItem(text, row.due_date, 0.90, isOverdue ? 0.8 : 0.4, query, entities, weights),
      data: {
        id: row.id, description: row.description, due_date: row.due_date,
        status: row.status, to_contact_name: row.to_contact_name,
      },
    };
  });
}

function normalizeVector(rows: any[], query: string, entities: EntityContext, weights: (typeof PROFILE_WEIGHTS)[RankingProfile]): VectorRetrievalItem[] {
  return rows.map((row) => {
    const text = row.chunk_text ?? "";
    return {
      item_type: "vector" as const,
      source: "vector_search" as const,
      source_confidence: 0.55,
      retrieval_score: scoreItem(text, row.metadata?.occurred_at ?? null, 0.55, 0.2, query, entities, weights),
      data: {
        chunk_text: row.chunk_text,
        source_type: row.source_type,
        occurred_at: row.metadata?.occurred_at ?? null,
      },
    };
  });
}

function normalizeAggregated(aggregated: AggregatedFinance): AggregatedFinanceRetrievalItem {
  return {
    item_type: "aggregated_finance" as const,
    source: "aggregated_finance" as const,
    source_confidence: 0.95,
    retrieval_score: 0.9, // always surfaces first for finance queries
    data: aggregated,
  };
}

// ─── Main unifiedRank ──────────────────────────────────────────────────────

export function unifiedRank(
  rawResults: RawResults,
  aggregated: AggregatedFinance | null,
  query: string,
  entities: EntityContext,
  _temporal: TemporalAnchor | null,
  profile: RankingProfile,
  diversityCaps: Record<string, number> = DEFAULT_DIVERSITY_CAPS,
  totalLimit = 20
): RetrievalItem[] {
  const weights = PROFILE_WEIGHTS[profile];

  const all: RetrievalItem[] = [];

  if (rawResults.operational_insights?.length)
    all.push(...normalizeInsights(rawResults.operational_insights, query, entities, weights));
  if (rawResults.sql_transactions?.length)
    all.push(...normalizeTransactions(rawResults.sql_transactions, query, entities, weights));
  if (rawResults.sql_communications?.length)
    all.push(...normalizeCommunications(rawResults.sql_communications, query, entities, weights));
  if (rawResults.sql_meetings?.length)
    all.push(...normalizeMeetings(rawResults.sql_meetings, query, entities, weights));
  if (rawResults.sql_commitments?.length)
    all.push(...normalizeCommitments(rawResults.sql_commitments, query, entities, weights));
  if (rawResults.vector_search?.length)
    all.push(...normalizeVector(rawResults.vector_search, query, entities, weights));
  if (aggregated)
    all.push(normalizeAggregated(aggregated));

  if (all.length === 0) {
    return [{
      item_type: "insight",
      source: "operational_insights",
      retrieval_score: 0,
      source_confidence: 1.0,
      data: {
        id: "no-data",
        state_key: "no_data",
        category: "system",
        insight_type: "no_data",
        title: "No data found",
        summary: "No relevant records were found for this query. If you expected data, try rephrasing or specifying a different time period.",
        urgency: "low",
        priority_score: 0,
        recommended_action: null,
        explanation: null,
      },
    } as InsightRetrievalItem];
  }

  // Sort by score descending
  all.sort((a, b) => b.retrieval_score - a.retrieval_score);

  // Apply diversity caps per source
  const counts: Record<string, number> = {};
  const result: RetrievalItem[] = [];

  for (const item of all) {
    const cap = diversityCaps[item.source] ?? 3;
    const count = counts[item.source] ?? 0;
    if (count >= cap) continue;
    counts[item.source] = count + 1;
    result.push(item);
    if (result.length >= totalLimit) break;
  }

  return result;
}
