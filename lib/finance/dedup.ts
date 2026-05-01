export type TransactionRaw = {
  id: string;
  user_id: string;
  communication_id: string;
  amount: number | null;
  currency: string | null;
  merchant_normalized: string | null;
  transaction_datetime: string | null;
  masked_account: string | null;
  transaction_id: string | null;
  reference_id: string | null;
  sender_type: string | null;
  transaction_type: string | null;
  category: string | null;
  is_recurring: boolean;
  recurring_frequency: string | null;
  status: string | null;
  merchant_name: string | null;
};

export type NormalizedTransaction = {
  user_id: string;
  primary_source: string;
  merchant_normalized: string | null;
  amount: number;
  currency: string;
  category: string | null;
  transaction_type: string | null;
  transaction_datetime: string;
  is_recurring: boolean;
  recurring_frequency: string | null;
  status: string | null;
  raw_transaction_ids: string[];
  communication_ids: string[];
  merchant_email_present: boolean;
  bank_email_present: boolean;
};

const SENDER_PRIORITY: Record<string, number> = {
  BANK: 5,
  CREDIT_CARD: 4,
  UPI: 3,
  WALLET: 2,
  MERCHANT: 1,
  PAYMENT_GATEWAY: 1,
  INVESTMENT_PLATFORM: 1,
  UNKNOWN: 0,
};

const AMOUNT_TOLERANCE = 0.02;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isSameAmount(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(a, b) <= AMOUNT_TOLERANCE;
}

function merchantSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const al = a.toLowerCase(), bl = b.toLowerCase();
  if (al.includes(bl) || bl.includes(al)) return 0.9;
  return 0;
}

function areDuplicates(a: TransactionRaw, b: TransactionRaw): boolean {
  if (!a.amount || !b.amount) return false;
  if (!isSameAmount(a.amount, b.amount)) return false;

  const ta = a.transaction_datetime ? new Date(a.transaction_datetime).getTime() : 0;
  const tb = b.transaction_datetime ? new Date(b.transaction_datetime).getTime() : 0;
  if (Math.abs(ta - tb) > WINDOW_MS) return false;

  // Refunds never merge with non-refunds
  if (a.transaction_type === "refund" || b.transaction_type === "refund") {
    return a.transaction_type === b.transaction_type;
  }

  // Recurring subscriptions only dedup within 15min (not across billing cycles)
  if (a.is_recurring && b.is_recurring) {
    return Math.abs(ta - tb) <= WINDOW_MS;
  }

  // Match by transaction ID or masked account
  if (a.transaction_id && b.transaction_id && a.transaction_id === b.transaction_id) return true;
  if (a.reference_id && b.reference_id && a.reference_id === b.reference_id) return true;
  if (a.masked_account && b.masked_account && a.masked_account === b.masked_account) return true;

  // Match by merchant similarity
  if (merchantSimilarity(a.merchant_normalized, b.merchant_normalized) >= 0.85) return true;

  return false;
}

function priorityOf(row: TransactionRaw): number {
  return SENDER_PRIORITY[row.sender_type ?? "UNKNOWN"] ?? 0;
}

export function deduplicateRawTransactions(rows: TransactionRaw[]): NormalizedTransaction[] {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.transaction_datetime ? new Date(a.transaction_datetime).getTime() : 0;
    const tb = b.transaction_datetime ? new Date(b.transaction_datetime).getTime() : 0;
    return ta - tb;
  });

  const groups: TransactionRaw[][] = [];

  for (const row of sorted) {
    let placed = false;
    for (const group of groups) {
      if (group.some((g) => areDuplicates(g, row))) {
        group.push(row);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([row]);
  }

  return groups.map((group) => {
    const primary = group.reduce((best, cur) =>
      priorityOf(cur) > priorityOf(best) ? cur : best
    );

    const isBankSource = (r: TransactionRaw) =>
      r.sender_type === "BANK" || r.sender_type === "CREDIT_CARD";
    const isMerchantSource = (r: TransactionRaw) =>
      r.sender_type === "MERCHANT" || r.sender_type === "UNKNOWN";

    return {
      user_id: primary.user_id,
      primary_source: primary.sender_type ?? "UNKNOWN",
      merchant_normalized: primary.merchant_normalized,
      amount: primary.amount ?? 0,
      currency: primary.currency ?? "INR",
      category: primary.category,
      transaction_type: primary.transaction_type,
      transaction_datetime: primary.transaction_datetime ?? new Date().toISOString(),
      is_recurring: primary.is_recurring,
      recurring_frequency: primary.recurring_frequency,
      status: primary.status,
      raw_transaction_ids: group.map((r) => r.id),
      communication_ids: group.map((r) => r.communication_id),
      merchant_email_present: group.some(isMerchantSource),
      bank_email_present: group.some(isBankSource),
    };
  });
}
