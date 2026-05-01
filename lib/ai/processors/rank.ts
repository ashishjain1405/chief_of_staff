import { ProcessorInsight } from "./types";

type UrgencyTier = "critical" | "overdue" | "due_today" | "due_this_week" | "informational";

const TIER_WEIGHT: Record<UrgencyTier, number> = {
  critical: 5,
  overdue: 4,
  due_today: 3,
  due_this_week: 2,
  informational: 1,
};

function getTier(insight: ProcessorInsight): UrgencyTier {
  if (insight.urgency === "critical" || insight.priority_score >= 0.85) return "critical";

  const overdueTypes = new Set([
    "overdue_task", "overdue_commitment", "missed_followup", "overdue_bill",
    "unanswered_email", "waiting_for_reply", "execution_risk",
    "relationship_deteriorating",
  ]);
  if (overdueTypes.has(insight.insight_type)) return "overdue";

  const todayTypes = new Set([
    "meeting_starting_soon", "tight_transition", "critical_schedule_risk",
    "duplicate_charge", "pending_refund",
  ]);
  if (todayTypes.has(insight.insight_type)) return "due_today";

  const weekTypes = new Set([
    "commitment_at_risk", "stale_task", "renewal_due", "bill_due",
    "bill_payment_confirmed", "meeting_overload", "burnout_risk",
  ]);
  if (weekTypes.has(insight.insight_type)) return "due_this_week";

  return "informational";
}

function boostScore(insight: ProcessorInsight): number {
  let boost = 0;
  if (insight.insight_type === "spending_spike" || insight.insight_type === "duplicate_charge") boost += 0.5;
  if (insight.metadata?.importanceScore && (insight.metadata.importanceScore as number) >= 0.8) boost += 0.5;
  if (insight.metadata?.daysOverdue && (insight.metadata.daysOverdue as number) >= 7) boost += 0.5;
  if (insight.metadata?.amount && (insight.metadata.amount as number) > 10000) boost += 0.3;
  return boost;
}

export function rankInsights(insights: ProcessorInsight[], limit = 20): ProcessorInsight[] {
  return insights
    .map((insight) => {
      const tier = getTier(insight);
      const score = TIER_WEIGHT[tier] + insight.priority_score + boostScore(insight);
      return { insight, tier, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.insight);
}
