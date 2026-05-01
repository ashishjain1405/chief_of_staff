export type IntentType =
  | "operational_summary"
  | "finance"
  | "spending_analysis"
  | "commitments"
  | "scheduling"
  | "productivity"
  | "relationship"
  | "travel"
  | "search_lookup"
  | "subscriptions"
  | "bills_payments"
  | "reminders";

export interface ProcessorInsight {
  state_key: string;
  category: IntentType;
  insight_type: string;
  priority_score: number;
  urgency: "critical" | "high" | "medium" | "low";
  title: string;
  summary: string;
  recommended_action: string | null;
  entities: string[];
  source_refs: string[];
  confidence: number;
  source_count: number;
  generated_by: string;
  explanation: string;
  expires_at: string | null;
  metadata: Record<string, any>;
}

// Shape of a row returned from the operational_insights table
export interface OperationalInsight extends ProcessorInsight {
  id: string;
  user_id: string;
  status: "active" | "resolved" | "snoozed" | "acknowledged";
  first_detected_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
}

// Raw DB row shapes used by processors
export interface RawTransaction {
  id?: string;
  amount: number;
  currency: string;
  merchant_normalized: string | null;
  category: string | null;
  transaction_type: string | null;
  transaction_datetime: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null;
  status: string | null;
  communication_ids?: string[];
}

export interface RawTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: "high" | "medium" | "low" | null;
  status: string;
  updated_at?: string;
  ai_reasoning?: string | null;
}

export interface RawCommitment {
  id: string;
  description: string;
  due_date: string | null;
  status: string;
  to_contact_id: string | null;
  contacts?: { name: string | null; email: string | null } | null;
}

export interface RawMeeting {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  attendees: Array<{ name?: string; email?: string; response_status?: string }> | null;
}

export interface RawRelationship {
  id: string;
  category: string;
  health_score: number | null;
  follow_up_due: string | null;
  contacts: { id: string; name: string | null; email: string | null } | null;
}

export interface RawContact {
  id: string;
  name: string | null;
  email: string | null;
  organization: string | null;
  importance_score: number | null;
  last_interaction_at: string | null;
  interaction_count: number | null;
}

export interface RawCommunication {
  id: string;
  subject: string | null;
  body_summary: string | null;
  occurred_at: string;
  sentiment: string | null;
  requires_action: boolean;
  action_taken: boolean;
  email_category: string | null;
  contact_id: string | null;
  contacts?: { name: string | null; email: string | null } | null;
}
