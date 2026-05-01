import { ProcessorInsight, RawTransaction } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[idx];
}

function spendByMerchant(txns: RawTransaction[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const t of txns) {
    const key = t.merchant_normalized ?? "Unknown";
    const arr = map.get(key) ?? [];
    arr.push(t.amount);
    map.set(key, arr);
  }
  return map;
}

function spendByCategory(txns: RawTransaction[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const t of txns) {
    const cat = t.category ?? "other";
    result[cat] = (result[cat] ?? 0) + t.amount;
  }
  return result;
}

export function processFinance(
  transactions: RawTransaction[],
  priorTransactions: RawTransaction[],
): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date().toISOString();
  const in7Days = new Date(Date.now() + 7 * 864e5).toISOString();

  const allAmounts = [...transactions, ...priorTransactions].map((t) => t.amount);
  const p95Amount = p95(allAmounts);

  const currentMerchantSpend = spendByMerchant(transactions);
  const priorMerchantSpend = spendByMerchant(priorTransactions);
  const currentCategorySpend = spendByCategory(transactions);
  const priorCategorySpend = spendByCategory(priorTransactions);

  // Spending spike detection (per merchant)
  for (const [merchant, amounts] of currentMerchantSpend) {
    const currentTotal = amounts.reduce((a, b) => a + b, 0);
    const priorAmounts = priorMerchantSpend.get(merchant);
    const priorAvg = priorAmounts
      ? priorAmounts.reduce((a, b) => a + b, 0) / priorAmounts.length
      : null;

    const allCurrentAmounts = transactions.map((t) => t.amount);
    const globalMean = allCurrentAmounts.reduce((a, b) => a + b, 0) / Math.max(allCurrentAmounts.length, 1);

    const threshold = priorAvg != null ? priorAvg * 1.5 : globalMean * 2;
    if (currentTotal > threshold && currentTotal > 100) {
      const anomalyStrength = priorAvg != null
        ? clamp((currentTotal / priorAvg - 1) / 2)
        : 0.5;
      const financialImpact = clamp(currentTotal / Math.max(p95Amount, 1));
      const priority = clamp(financialImpact * 0.4 + 0.3 + anomalyStrength * 0.3);

      insights.push({
        state_key: `finance:spending_spike:${merchant.toLowerCase().replace(/\s+/g, "_")}`,
        category: "finance",
        insight_type: "spending_spike",
        priority_score: priority,
        urgency: priority >= 0.8 ? "high" : "medium",
        title: `Spending spike: ${merchant}`,
        summary: priorAvg != null
          ? `${merchant} spending is ${Math.round((currentTotal / priorAvg - 1) * 100)}% above your usual average.`
          : `${merchant} spending (${currentTotal.toFixed(0)}) is unusually high compared to your recent pattern.`,
        recommended_action: "Review recent transactions for this merchant.",
        entities: [merchant],
        source_refs: transactions.filter((t) => t.merchant_normalized === merchant).map((t) => t.id ?? "").filter(Boolean),
        confidence: priorAmounts ? 0.85 : 0.65,
        source_count: amounts.length,
        generated_by: "finance_processor",
        explanation: priorAvg != null
          ? `Current: ${currentTotal.toFixed(0)}, Prior avg: ${priorAvg.toFixed(0)}, Ratio: ${(currentTotal / priorAvg).toFixed(2)}x`
          : `Current: ${currentTotal.toFixed(0)}, Global mean: ${globalMean.toFixed(0)}`,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        metadata: { merchant, currentTotal, priorAvg },
      });
    }
  }

  // Category-level spike
  for (const [cat, currentTotal] of Object.entries(currentCategorySpend)) {
    const priorTotal = priorCategorySpend[cat] ?? 0;
    if (priorTotal > 0 && currentTotal > priorTotal * 1.5 && currentTotal > 500) {
      const ratio = currentTotal / priorTotal;
      const priority = clamp((ratio - 1) / 3 * 0.7 + 0.3);
      insights.push({
        state_key: `finance:category_spike:${cat}`,
        category: "spending_analysis",
        insight_type: "category_spending_spike",
        priority_score: priority,
        urgency: priority >= 0.75 ? "high" : "medium",
        title: `${cat} spending increased ${Math.round((ratio - 1) * 100)}%`,
        summary: `Your ${cat} spending this period is ${Math.round((ratio - 1) * 100)}% higher than the prior period.`,
        recommended_action: "Review your spending in this category.",
        entities: [cat],
        source_refs: [],
        confidence: 0.8,
        source_count: transactions.filter((t) => t.category === cat).length,
        generated_by: "finance_processor",
        explanation: `Current: ${currentTotal.toFixed(0)}, Prior: ${priorTotal.toFixed(0)}, Ratio: ${ratio.toFixed(2)}x`,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        metadata: { category: cat, currentTotal, priorTotal },
      });
    }
  }

  // Large individual transactions
  for (const txn of transactions) {
    if (txn.amount > p95Amount && txn.amount > 1000 && p95Amount > 0) {
      const financialImpact = clamp(txn.amount / p95Amount * 0.6);
      insights.push({
        state_key: `finance:large_txn:${txn.id ?? txn.transaction_datetime ?? txn.amount}`,
        category: "finance",
        insight_type: "large_transaction",
        priority_score: clamp(financialImpact * 0.4 + 0.5 * 0.3 + 0.3 * 0.3),
        urgency: "medium",
        title: `Large transaction: ${txn.merchant_normalized ?? "Unknown"} — ${txn.currency ?? "INR"} ${txn.amount.toLocaleString()}`,
        summary: `A transaction of ${txn.currency ?? "INR"} ${txn.amount.toLocaleString()} at ${txn.merchant_normalized ?? "Unknown"} exceeds your 95th percentile amount.`,
        recommended_action: null,
        entities: [txn.merchant_normalized ?? "Unknown"],
        source_refs: txn.id ? [txn.id] : [],
        confidence: 0.9,
        source_count: 1,
        generated_by: "finance_processor",
        explanation: `Amount ${txn.amount} > P95 (${p95Amount.toFixed(0)})`,
        expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
        metadata: { amount: txn.amount, merchant: txn.merchant_normalized },
      });
    }
  }

  // Pending refunds
  for (const txn of transactions) {
    if (txn.status === "refund_pending") {
      insights.push({
        state_key: `finance:pending_refund:${txn.id ?? txn.merchant_normalized}`,
        category: "finance",
        insight_type: "pending_refund",
        priority_score: 0.6,
        urgency: "medium",
        title: `Pending refund: ${txn.merchant_normalized ?? "Unknown"}`,
        summary: `A refund of ${txn.currency ?? "INR"} ${txn.amount.toLocaleString()} from ${txn.merchant_normalized ?? "Unknown"} is still pending.`,
        recommended_action: "Follow up if the refund has not arrived.",
        entities: [txn.merchant_normalized ?? "Unknown"],
        source_refs: txn.id ? [txn.id] : [],
        confidence: 0.95,
        source_count: 1,
        generated_by: "finance_processor",
        explanation: `status=refund_pending`,
        expires_at: null,
        metadata: { amount: txn.amount, merchant: txn.merchant_normalized },
      });
    }
  }

  // Duplicate charge detection (same merchant + similar amount within 3 days)
  const sorted = [...transactions].sort((a, b) =>
    (a.transaction_datetime ?? "").localeCompare(b.transaction_datetime ?? "")
  );
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.merchant_normalized !== b.merchant_normalized) continue;
      const diff = Math.abs(a.amount - b.amount);
      if (diff / Math.max(a.amount, 1) > 0.02) continue;
      const daysDiff = Math.abs(
        new Date(a.transaction_datetime ?? 0).getTime() -
        new Date(b.transaction_datetime ?? 0).getTime()
      ) / 864e5;
      if (daysDiff <= 3) {
        const merchant = a.merchant_normalized ?? "Unknown";
        insights.push({
          state_key: `finance:duplicate_charge:${merchant.toLowerCase().replace(/\s+/g, "_")}:${a.transaction_datetime?.slice(0, 10)}`,
          category: "finance",
          insight_type: "duplicate_charge",
          priority_score: 0.75,
          urgency: "high",
          title: `Possible duplicate charge: ${merchant}`,
          summary: `Two similar charges of ~${a.currency ?? "INR"} ${a.amount.toLocaleString()} at ${merchant} within ${Math.round(daysDiff)} day(s).`,
          recommended_action: "Verify if this is a legitimate double charge or a duplicate.",
          entities: [merchant],
          source_refs: [a.id, b.id].filter(Boolean) as string[],
          confidence: 0.8,
          source_count: 2,
          generated_by: "finance_processor",
          explanation: `Amount A: ${a.amount}, Amount B: ${b.amount}, Days apart: ${daysDiff.toFixed(1)}`,
          expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
          metadata: { merchant, amountA: a.amount, amountB: b.amount, daysDiff },
        });
        break;
      }
    }
  }

  return insights;
}
