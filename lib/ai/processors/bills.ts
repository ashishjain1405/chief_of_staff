import { differenceInDays, isBefore, addDays } from "date-fns";
import { ProcessorInsight, RawCommunication, RawTransaction } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function processBills(
  billEmails: RawCommunication[],
  billTxns: RawTransaction[],
): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();

  // Bills from email (finance_bills category)
  for (const email of billEmails) {
    const ageDays = differenceInDays(now, new Date(email.occurred_at));
    if (ageDays > 45) continue;

    const subject = email.subject ?? "(no subject)";
    const isLikelyOverdue = ageDays > 14;
    const priorityScore = isLikelyOverdue
      ? clamp(0.6 + Math.min(ageDays / 30, 0.3))
      : clamp(0.4 + (14 - Math.min(ageDays, 14)) / 14 * 0.2);

    insights.push({
      state_key: `bill:notice:${email.id}`,
      category: "bills_payments",
      insight_type: isLikelyOverdue ? "overdue_bill" : "bill_due",
      priority_score: priorityScore,
      urgency: isLikelyOverdue ? "high" : "medium",
      title: isLikelyOverdue
        ? `Overdue bill: ${subject.slice(0, 60)}`
        : `Bill notice: ${subject.slice(0, 60)}`,
      summary: isLikelyOverdue
        ? `Bill "${subject}" arrived ${ageDays} days ago and may be overdue.`
        : `Bill notice: "${subject}" received ${ageDays} day${ageDays !== 1 ? "s" : ""} ago.`,
      recommended_action: "Review and pay if not already done.",
      entities: [subject],
      source_refs: [email.id],
      confidence: 0.75,
      source_count: 1,
      generated_by: "bills_processor",
      explanation: `email_category=finance_bills, age=${ageDays}d`,
      expires_at: addDays(now, 30).toISOString(),
      metadata: { ageDays, subject },
    });
  }

  // EMI / bill payment transactions
  for (const txn of billTxns) {
    if (!txn.transaction_datetime) continue;
    const ageDays = differenceInDays(now, new Date(txn.transaction_datetime));
    if (ageDays > 7) continue;

    insights.push({
      state_key: `bill:payment:${txn.id ?? txn.merchant_normalized ?? txn.transaction_datetime}`,
      category: "bills_payments",
      insight_type: "bill_payment_confirmed",
      priority_score: 0.3,
      urgency: "low",
      title: `Bill paid: ${txn.merchant_normalized ?? "Unknown"}`,
      summary: `Payment of ${txn.currency ?? "INR"} ${txn.amount.toLocaleString()} to ${txn.merchant_normalized ?? "Unknown"} processed ${ageDays} day${ageDays !== 1 ? "s" : ""} ago.`,
      recommended_action: null,
      entities: [txn.merchant_normalized ?? "Unknown"],
      source_refs: txn.id ? [txn.id] : [],
      confidence: 0.95,
      source_count: 1,
      generated_by: "bills_processor",
      explanation: `transaction_type=${txn.transaction_type}, amount=${txn.amount}`,
      expires_at: addDays(now, 7).toISOString(),
      metadata: { amount: txn.amount, merchant: txn.merchant_normalized },
    });
  }

  return insights;
}
