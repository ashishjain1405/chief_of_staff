import type { IntentType } from "../processors/types";

export interface EntityContext {
  people: string[];
  merchants: string[];
  categories: string[];
  topics: string[];
  amount: number | null;
}

export interface TemporalAnchor {
  type: "absolute" | "relative" | "event_relative";
  dateRange?: { from: string; to: string };
  relativePeriod?: "today" | "this_week" | "last_week" | "this_month" |
                   "last_month" | "last_quarter" | "this_quarter" | "this_year" | "last_year";
  anchor_event?: "salary_credit" | "travel_booking" | "named_meeting" | "named_contact_interaction";
  anchor_ref?: string;
  relative_window?: string;
  anchor_match_confidence?: number;
}

export interface RetrievalWeights {
  operational_weight: number;
  investigative_weight: number;
}

export type RetrievalSource =
  | "sql_transactions"
  | "sql_communications"
  | "sql_meetings"
  | "sql_commitments"
  | "sql_tasks"
  | "vector_search"
  | "operational_insights"
  | "aggregated_finance";

export interface RetrievalStep {
  source: RetrievalSource;
  purpose: string;
  filters: Record<string, any>;
  estimated_cost_ms: number;
  max_results: number;
  priority: number;
  source_confidence: number;
}

export interface AggregatedFinance {
  total: number;
  by_category: Record<string, number>;
  by_merchant: Record<string, number>;
  weekly_trend: { week: string; total: number }[];
  period: string;
  transaction_count: number;
  category_fallback?: string[]; // set when requested categories had no matches; shows all categories instead
}

// Discriminated union — typed payload per source, no data:any
export interface BaseRetrievalItem {
  retrieval_score: number;
  source_confidence: number;
}

export interface TransactionRetrievalItem extends BaseRetrievalItem {
  item_type: "transaction";
  source: "sql_transactions";
  data: {
    id: string;
    merchant_normalized: string | null;
    amount: number;
    currency: string;
    category: string | null;
    transaction_datetime: string | null;
    transaction_type: string | null;
    bank_name: string | null;
    payment_method: string | null;
  };
}

export interface CommunicationRetrievalItem extends BaseRetrievalItem {
  item_type: "communication";
  source: "sql_communications";
  data: {
    id: string;
    subject: string | null;
    body_summary: string | null;
    occurred_at: string | null;
    sentiment: string | null;
    email_category: string | null;
    requires_action: boolean;
    contact_name: string | null;
  };
}

export interface MeetingRetrievalItem extends BaseRetrievalItem {
  item_type: "meeting";
  source: "sql_meetings";
  data: {
    id: string;
    title: string | null;
    start_time: string | null;
    executive_summary: string | null;
    attendees: string[] | null;
  };
}

export interface CommitmentRetrievalItem extends BaseRetrievalItem {
  item_type: "commitment";
  source: "sql_commitments";
  data: {
    id: string;
    description: string;
    due_date: string | null;
    status: string | null;
    to_contact_name: string | null;
  };
}

export interface AggregatedFinanceRetrievalItem extends BaseRetrievalItem {
  item_type: "aggregated_finance";
  source: "aggregated_finance";
  data: AggregatedFinance;
}

export interface InsightRetrievalItem extends BaseRetrievalItem {
  item_type: "insight";
  source: "operational_insights";
  data: {
    id: string;
    state_key: string;
    category: string;
    insight_type: string;
    title: string;
    summary: string;
    urgency: string;
    priority_score: number;
    recommended_action: string | null;
    explanation: string | null;
  };
}

export interface VectorRetrievalItem extends BaseRetrievalItem {
  item_type: "vector";
  source: "vector_search";
  data: {
    chunk_text: string;
    source_type: string;
    occurred_at: string | null;
  };
}

export type RetrievalItem =
  | TransactionRetrievalItem
  | CommunicationRetrievalItem
  | MeetingRetrievalItem
  | CommitmentRetrievalItem
  | AggregatedFinanceRetrievalItem
  | InsightRetrievalItem
  | VectorRetrievalItem;

export type RankingProfile =
  | "factual_finance"
  | "semantic_lookup"
  | "relationship"
  | "operational";

export interface TrackedEntity {
  value: string;
  introduced_at_turn: number;
  entity_type: "person" | "merchant" | "category" | "topic" | "temporal";
}

export interface ConversationContext {
  tracked_entities: TrackedEntity[];
  active_temporal: TemporalAnchor | null;
  active_topic: IntentType | null;
  turn_count: number;
}

export interface AssistantMetadata {
  context: ConversationContext;
  retrieval_summary: { sources_used: string[]; top_entity?: string };
}

export interface RetrievalTrace {
  query: string;
  intent: string;
  retrieval_weights: RetrievalWeights;
  entities: EntityContext;
  temporal: TemporalAnchor | null;
  retrieval_plan: RetrievalStep[];
  retrieved_sources: { source: string; count: number; success: boolean }[];
  top_ranked_items: { source: string; score: number; title?: string }[];
  total_latency_ms: number;
  budget_exhausted: boolean;
}
