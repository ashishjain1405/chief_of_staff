import { differenceInDays, isBefore, addDays, format, startOfMonth } from "date-fns";
import { ProcessorInsight, RawCommunication, RawTransaction } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function processSubscriptions(
  recurringTxns: RawTransaction[],
  renewalEmails: RawCommunication[],
): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();
  const in14Days = addDays(now, 14);

  // Renewal reminders from emails
  for (const email of renewalEmails) {
    const ageDays = differenceInDays(now, new Date(email.occurred_at));
    if (ageDays > 30) continue; // only recent renewal notices

    const subject = email.subject ?? "(no subject)";
    insights.push({
      state_key: `subscription:renewal_notice:${email.id}`,
      category: "subscriptions",
      insight_type: "renewal_due",
      priority_score: 0.6,
      urgency: "medium",
      title: `Subscription renewal: ${subject.slice(0, 60)}`,
      summary: `A subscription renewal notice arrived ${ageDays} day${ageDays !== 1 ? "s" : ""} ago: "${subject}".`,
      recommended_action: "Review if you want to keep or cancel this subscription.",
      entities: [subject],
      source_refs: [email.id],
      confidence: 0.8,
      source_count: 1,
      generated_by: "subscription_processor",
      explanation: `email_category=subscriptions_memberships, age=${ageDays}d`,
      expires_at: addDays(now, 14).toISOString(),
      metadata: { subject, ageDays },
    });
  }

  // Recurring spending aggregation
  const byMerchant = new Map<string, RawTransaction[]>();
  for (const txn of recurringTxns) {
    const key = txn.merchant_normalized ?? "Unknown";
    const arr = byMerchant.get(key) ?? [];
    arr.push(txn);
    byMerchant.set(key, arr);
  }

  // Monthly total by grouping (last 6 months)
  const monthlyTotals = new Map<string, number>();
  for (const txn of recurringTxns) {
    if (!txn.transaction_datetime) continue;
    const month = format(startOfMonth(new Date(txn.transaction_datetime)), "yyyy-MM");
    monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + txn.amount);
  }

  const months = [...monthlyTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (months.length >= 2) {
    const latestMonth = months[months.length - 1];
    const prevMonth = months[months.length - 2];
    const increase = latestMonth[1] / Math.max(prevMonth[1], 1) - 1;

    if (increase > 0.2) {
      insights.push({
        state_key: `subscription:cost_spike:${latestMonth[0]}`,
        category: "subscriptions",
        insight_type: "subscription_cost_spike",
        priority_score: clamp(0.5 + increase * 0.4),
        urgency: increase >= 0.5 ? "high" : "medium",
        title: `Recurring subscriptions up ${Math.round(increase * 100)}% this month`,
        summary: `Subscription/recurring spending increased from ${prevMonth[1].toFixed(0)} to ${latestMonth[1].toFixed(0)} month-over-month (+${Math.round(increase * 100)}%).`,
        recommended_action: "Review new or increased recurring charges.",
        entities: [],
        source_refs: [],
        confidence: 0.8,
        source_count: recurringTxns.length,
        generated_by: "subscription_processor",
        explanation: `prev=${prevMonth[1].toFixed(0)}, current=${latestMonth[1].toFixed(0)}, increase=${(increase * 100).toFixed(1)}%`,
        expires_at: addDays(now, 30).toISOString(),
        metadata: { prevMonth: prevMonth[1], latestMonth: latestMonth[1], increasePercent: Math.round(increase * 100) },
      });
    }
  }

  return insights;
}
