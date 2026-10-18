import { merchantKey } from "@/lib/finance/normalize";

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
  const al = merchantKey(a), bl = merchantKey(b);
  if (al === bl) return 1;
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

    // The bank alert wins on priority but usually names no merchant; the
    // receipt in the same group does. Taking only the primary's left the
    // transaction merchant-less even though the group knew it.
    const withMerchant = [primary, ...group].find((r) => r.merchant_normalized);

    return {
      user_id: primary.user_id,
      primary_source: primary.sender_type ?? "UNKNOWN",
      merchant_normalized: withMerchant?.merchant_normalized ?? null,
      amount: primary.amount ?? 0,
      currency: primary.currency ?? "INR",
      category: primary.category ?? withMerchant?.category ?? null,
      transaction_type: primary.transaction_type,
      transaction_datetime: primary.transaction_datetime ?? new Date().toISOString(),
      is_recurring: primary.is_recurring,
      recurring_frequency: primary.recurring_frequency,
      status: primary.status,
      // Sorted and de-duplicated so these arrays are order-stable. The unique
      // index on (user_id, communication_ids) compares uuid[] element by
      // element, so {A,B} and {B,A} would otherwise count as different
      // transactions and the index would miss the duplicate.
      raw_transaction_ids: [...new Set(group.map((r) => r.id))].sort(),
      communication_ids: [...new Set(group.map((r) => r.communication_id))].sort(),
      merchant_email_present: group.some(isMerchantSource),
      bank_email_present: group.some(isBankSource),
    };
  });
}

// Writes each group as one normalized row. A group is matched to existing rows
// that share ANY of its emails, not rows containing all of them: when a second
// email for a purchase arrived, "contains" found nothing and inserted a second
// row beside the first, counting the purchase twice. The oldest overlapping
// row is kept and updated; the rest are deleted.
export async function saveNormalizedGroups(
  db: any,
  userId: string,
  groups: NormalizedTransaction[]
): Promise<{ inserted: number; updated: number; collapsed: number }> {
  const stats = { inserted: 0, updated: 0, collapsed: 0 };
  for (const norm of groups) {
    const now = new Date().toISOString();
    let matches = await overlappingRows(db, userId, norm.communication_ids);

    if (matches.length === 0) {
      const { error } = await db.from("transactions_normalized").insert({ ...norm, created_at: now, updated_at: now });
      if (!error) {
        stats.inserted++;
        continue;
      }
      // 23505: a concurrent run inserted the same set first; merge into it.
      if (error.code !== "23505") {
        console.error(`[dedup] insert failed: ${error.message}`);
        continue;
      }
      matches = await overlappingRows(db, userId, norm.communication_ids);
      if (matches.length === 0) continue;
    }

    const [keep, ...redundant] = matches;
    // Duplicates go first: one may already hold exactly this email set, and
    // updating the kept row to it would then violate the unique index.
    if (redundant.length > 0) {
      const { error: deleteErr } = await db
        .from("transactions_normalized")
        .delete()
        .in("id", redundant.map((r) => r.id));
      if (deleteErr) console.error(`[dedup] failed to delete duplicates: ${deleteErr.message}`);
      else stats.collapsed += redundant.length;
    }

    const { error: updateErr } = await db
      .from("transactions_normalized")
      .update({ ...norm, updated_at: now })
      .eq("id", keep.id);
    if (updateErr) console.error(`[dedup] update failed for ${keep.id}: ${updateErr.message}`);
    else stats.updated++;
  }
  return stats;
}

async function overlappingRows(db: any, userId: string, communicationIds: string[]): Promise<{ id: string }[]> {
  const { data, error } = await db
    .from("transactions_normalized")
    .select("id")
    .eq("user_id", userId)
    .overlaps("communication_ids", communicationIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[dedup] overlap lookup failed: ${error.message}`);
  return data ?? [];
}
