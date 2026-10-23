import { MERCHANT_DATA, getCategoryForMerchant, getDomainForMerchant, merchantKey } from "@/lib/finance/normalize";
import { matchesFor, resolve, upiKey, type Overrides, type Rule } from "@/lib/finance/rules";

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
  raw_sender?: string | null;
  upi_id?: string | null;
  recipient_key?: string | null;
  recipient_label?: string | null;
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
  upi_key: string | null;
  recipient_key: string | null;
  recipient_label: string | null;
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

const ORDER_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;
const ORDER_AMOUNT_TOLERANCE = 0.1;

function idsOf(r: TransactionRaw): string[] {
  return [r.transaction_id, r.reference_id].map((v) => v?.trim()).filter((v): v is string => !!v && v.length >= 6);
}

// An order's emails - placed, shipped, delivered - arrive days apart, outside
// the 15-minute window, and each became its own transaction: one Tata 1mg
// order was counted four times, 28 orders about ₹3.2 lakh twice or more. They
// share an order or payment ID, so that ID (with the same merchant) identifies
// one purchase. The amount may shift in between (Netmeds ₹262 placed, ₹239
// delivered), hence the wider tolerance - but not too wide: Amazon charges
// each shipment separately under one order ID (₹221 and ₹264). Refunds still
// never merge with purchases, and recurring charges are excluded because a
// mandate ID repeats on every monthly debit.
function isSameOrder(a: TransactionRaw, b: TransactionRaw): boolean {
  if (a.is_recurring || b.is_recurring) return false;
  const bIds = new Set(idsOf(b));
  if (!idsOf(a).some((id) => bIds.has(id))) return false;
  if (merchantSimilarity(a.merchant_normalized, b.merchant_normalized) < 0.85) return false;
  if ((a.transaction_type === "refund") !== (b.transaction_type === "refund")) return false;
  const ta = a.transaction_datetime ? new Date(a.transaction_datetime).getTime() : 0;
  const tb = b.transaction_datetime ? new Date(b.transaction_datetime).getTime() : 0;
  if (Math.abs(ta - tb) > ORDER_WINDOW_MS) return false;
  return Math.abs(a.amount! - b.amount!) / Math.max(a.amount!, b.amount!) <= ORDER_AMOUNT_TOLERANCE;
}

// A shipping update - "picked up", "out for delivery", "delivered" - repeats a
// purchase already paid for. Courier mail carries a tracking number, not the
// order ID, so the order rule never joined it: one ₹525 Svaras order was
// counted six times. Such a row is stored as event_kind "shipping", kept out
// of dedup windows, and counts only when nothing paid for it.
const SHIPPING_SUBJECT = /\b(shipped|dispatched|picked up|out for delivery|delivered|in transit|on (its|the) way|arriving|has left)\b/i;
export function isShippingUpdate(subject: string): boolean {
  return SHIPPING_SUBJECT.test(subject);
}

// Couriers name themselves where the shop should be ("Velocity").
const COURIERS = /^(velocity|delhivery|blue ?dart|shiprocket|ekart|xpressbees|dtdc|ecom express|shadowfax)\b/i;
const SHIPPING_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

type Dated = { merchant_normalized: string | null; amount: number | null; transaction_datetime: string | null };

// Whether `payment` is the purchase `shipping` reports on: in the two weeks
// before it, the same merchant within the order tolerance - or, when only a
// courier is named, the same amount.
export function isPaymentForShipping(payment: Dated, shipping: Dated): boolean {
  if (!payment.amount || !shipping.amount || !payment.transaction_datetime || !shipping.transaction_datetime) return false;
  const tp = Date.parse(payment.transaction_datetime), ts = Date.parse(shipping.transaction_datetime);
  if (tp > ts + 60 * 60 * 1000 || tp < ts - SHIPPING_LOOKBACK_MS) return false;
  const gap = Math.abs(payment.amount - shipping.amount) / Math.max(payment.amount, shipping.amount);
  if (!shipping.merchant_normalized || COURIERS.test(shipping.merchant_normalized)) return Math.abs(payment.amount - shipping.amount) <= 0.5;
  return merchantSimilarity(payment.merchant_normalized, shipping.merchant_normalized) >= 0.85 && gap <= ORDER_AMOUNT_TOLERANCE;
}

const ALERT_SOURCES = new Set(["BANK", "CREDIT_CARD", "UPI", "WALLET"]);
const RECEIPT_WINDOW_MS = 3 * 60 * 60 * 1000;
const senderDomain = (r: TransactionRaw) => (r.raw_sender ?? "").split("@")[1]?.toLowerCase() ?? "";

// A card alert names whoever charged the card - "ZOMATO", "RELIANCE DIGITAL"
// for a Netmeds order - and the receipt names the restaurant or the brand, so
// the merchants never matched and 14 payments were counted twice. An alert
// and a receipt for exactly the same amount within 15 minutes are one payment
// whatever the names; within 3 hours, and the usual tolerance, when the
// receipt came from the alert's merchant itself, as Zomato's order email
// arrives with the food. Near amounts are not enough without the names: a
// ₹5,000 voucher and the ₹4,952 order it paid for are two events. Two alerts
// never match this way: they are two payments.
function isAlertAndReceipt(a: TransactionRaw, b: TransactionRaw, gapMs: number): boolean {
  const aAlert = ALERT_SOURCES.has(a.sender_type ?? "");
  if (aAlert === ALERT_SOURCES.has(b.sender_type ?? "")) return false;
  if (gapMs <= WINDOW_MS && Math.abs(a.amount! - b.amount!) <= 0.5) return true;
  if (gapMs > RECEIPT_WINDOW_MS) return false;
  const [alert, receipt] = aAlert ? [a, b] : [b, a];
  const domain = getDomainForMerchant(alert.merchant_normalized);
  const from = senderDomain(receipt);
  return !!domain && (from === domain || from.endsWith(`.${domain}`));
}

function areDuplicates(a: TransactionRaw, b: TransactionRaw): boolean {
  if (!a.amount || !b.amount) return false;
  if (isSameOrder(a, b)) return true;
  if (!isSameAmount(a.amount, b.amount)) return false;

  const ta = a.transaction_datetime ? new Date(a.transaction_datetime).getTime() : 0;
  const tb = b.transaction_datetime ? new Date(b.transaction_datetime).getTime() : 0;
  const refundMismatch = (a.transaction_type === "refund") !== (b.transaction_type === "refund");
  if (!refundMismatch && isAlertAndReceipt(a, b, Math.abs(ta - tb))) return true;
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
    // Highest-priority sender wins; among equals the latest email, whose
    // amount is final (an order's delivered total, not the one first placed).
    const time = (r: TransactionRaw) => (r.transaction_datetime ? new Date(r.transaction_datetime).getTime() : 0);
    const primary = group.reduce((best, cur) =>
      priorityOf(cur) > priorityOf(best) || (priorityOf(cur) === priorityOf(best) && time(cur) > time(best)) ? cur : best
    );
    // Dated by when the money first moved - the order, not its delivery.
    const earliest = group.reduce((a, b) => (time(b) < time(a) ? b : a));

    const isBankSource = (r: TransactionRaw) =>
      r.sender_type === "BANK" || r.sender_type === "CREDIT_CARD";
    const isMerchantSource = (r: TransactionRaw) =>
      r.sender_type === "MERCHANT" || r.sender_type === "UNKNOWN";

    // The bank alert wins on priority but usually names no merchant; the
    // receipt in the same group does. Taking only the primary's left the
    // transaction merchant-less even though the group knew it.
    // The alert may name the company ("RELIANCE DIGITAL") where the receipt,
    // sent by the merchant itself, names the brand ("Netmeds"); that wins, then
    // any name the dictionary knows - "Zomato" over the restaurant it paid.
    const known = (r: TransactionRaw) => !!r.merchant_normalized && r.merchant_normalized in MERCHANT_DATA;
    const selfSent = (r: TransactionRaw) => {
      const domain = getDomainForMerchant(r.merchant_normalized);
      const from = senderDomain(r);
      return !!domain && (from === domain || from.endsWith(`.${domain}`));
    };
    const withMerchant = group.find(selfSent) ?? [primary, ...group].find(known) ?? [primary, ...group].find((r) => r.merchant_normalized);
    const knownCategory = withMerchant?.merchant_normalized ? getCategoryForMerchant(withMerchant.merchant_normalized) : null;

    return {
      user_id: primary.user_id,
      primary_source: primary.sender_type ?? "UNKNOWN",
      merchant_normalized: withMerchant?.merchant_normalized ?? null,
      amount: primary.amount ?? 0,
      currency: primary.currency ?? "INR",
      category: knownCategory ?? primary.category ?? withMerchant?.category ?? null,
      transaction_type: primary.transaction_type,
      transaction_datetime: earliest.transaction_datetime ?? primary.transaction_datetime ?? new Date().toISOString(),
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
      upi_key: group.map((r) => upiKey(r.upi_id)).find(Boolean) ?? upiKey(withMerchant?.merchant_normalized) ?? null,
      // The account where one email gives it: an RTGS "transfer to payee SBI
      // Home Loan Account" and its confirmation "credited to A/c ending 5389"
      // are one transfer, and the account is what later transfers share.
      ...(() => {
        const r = group.find((x) => x.recipient_key?.startsWith("account:")) ?? group.find((x) => x.recipient_key);
        return { recipient_key: r?.recipient_key ?? null, recipient_label: r?.recipient_label ?? null };
      })(),
    };
  });
}

// Writes each group as one normalized row. A group is matched to existing rows
// that share ANY of its emails, not rows containing all of them: when a second
// email for a purchase arrived, "contains" found nothing and inserted a second
// row beside the first, counting the purchase twice. The oldest overlapping
// row is kept and updated; the rest are deleted.
//
// The group's category is the automatic one (category_auto). What is written
// as category and counted_override follows the founder: a choice made on any
// of the rows being merged survives - regrouping once split the Zomato pair
// and rewrote its fields - and otherwise their rules apply (lib/finance/rules).
export async function saveNormalizedGroups(
  db: any,
  userId: string,
  groups: NormalizedTransaction[]
): Promise<{ inserted: number; updated: number; collapsed: number }> {
  const stats = { inserted: 0, updated: 0, collapsed: 0 };
  const { data: ruleRows, error: rulesError } = await db
    .from("transaction_rules")
    .select("match_type, match_key, label, category, counted")
    .eq("user_id", userId);
  if (rulesError) throw new Error(`[dedup] rules lookup failed: ${rulesError.message}`);
  const rules = (ruleRows ?? []) as Rule[];
  const withChoices = (norm: NormalizedTransaction, prior: PriorRow[]) => {
    const userCategory = prior.find((r) => r.category_source === "user");
    const userCounted = prior.find((r) => r.counted_source === "user");
    const current: Partial<Overrides> = {
      category: userCategory?.category ?? null,
      category_source: userCategory ? "user" : "auto",
      counted_override: userCounted?.counted_override ?? null,
      counted_source: userCounted ? "user" : null,
    };
    return { ...norm, category_auto: norm.category, ...resolve(current, norm.category, rules, matchesFor(norm, (n) => n)) };
  };

  for (const norm of groups) {
    const now = new Date().toISOString();
    let matches = await overlappingRows(db, userId, norm.communication_ids);

    if (matches.length === 0) {
      const { error } = await db.from("transactions_normalized").insert({ ...withChoices(norm, []), created_at: now, updated_at: now });
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
      .update({ ...withChoices(norm, matches), updated_at: now })
      .eq("id", keep.id);
    if (updateErr) console.error(`[dedup] update failed for ${keep.id}: ${updateErr.message}`);
    else stats.updated++;
  }
  return stats;
}

type PriorRow = { id: string } & Partial<Overrides>;

async function overlappingRows(db: any, userId: string, communicationIds: string[]): Promise<PriorRow[]> {
  const { data, error } = await db
    .from("transactions_normalized")
    .select("id, category, category_source, counted_override, counted_source")
    .eq("user_id", userId)
    .overlaps("communication_ids", communicationIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[dedup] overlap lookup failed: ${error.message}`);
  return data ?? [];
}
