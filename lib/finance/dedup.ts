import { MERCHANT_DATA, getCategoryForMerchant, getDomainForMerchant, merchantKey } from "@/lib/finance/normalize";
import { matchesFor, resolve, upiKey, type Overrides, type Rule } from "@/lib/finance/rules";

export type TransactionRaw = {
  id: string;
  user_id: string;
  communication_id: string;
  amount: number | null;
  // The order's full value when a balance paid part of it (migrations/add-order-total.sql).
  order_total?: number | null;
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
  order_total: number | null;
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
// "There is A Slight Delay In Your Order" is status too: it and the "out for
// delivery" after it made a ₹1,078 Myntra order count twice.
const SHIPPING_SUBJECT = /\b(shipped|dispatched|picked up|out for delivery|delivered|in transit|on (its|the) way|arriving|has left|slight delay|delay in your order|order (is |has been )?delayed)\b/i;
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

type ShippingCandidate = Dated & { id: string; shippingOnly: boolean; methods?: (string | null)[] };

// Card, store credit, cash on delivery...: an item's email says how it was
// paid, and only an order paid the same way can hold it.
const methodFamily = (m: string | null | undefined) => {
  const s = (m ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/card/.test(s)) return "card";
  if (/credit|wallet|gift|balance|store/.test(s)) return "credit";
  if (/cod|cash/.test(s)) return "cash";
  if (/upi/.test(s)) return "upi";
  return s;
};
const samePaymentMethod = (a: ShippingCandidate, b: ShippingCandidate) => {
  const fa = new Set((a.methods ?? []).map(methodFamily).filter(Boolean));
  const fb = new Set((b.methods ?? []).map(methodFamily).filter(Boolean));
  return !fa.size || !fb.size || [...fa].some((f) => fb.has(f));
};
// An item's update shows that item's price, not the order's: the four items
// of a ₹4,610.80 Myntra order came to ₹4,610.81 and were counted on top of it.
// It belongs to a recent order from the same shop, paid the same way, with
// room left for it. Couriers name no shop, so they still need the exact amount.
const holdsItem = (order: ShippingCandidate, item: ShippingCandidate, room: number) =>
  !!item.merchant_normalized && !COURIERS.test(item.merchant_normalized) && isPaymentForShipping({ ...order, amount: item.amount }, item)
  && samePaymentMethod(order, item) && room + 1 >= (item.amount ?? 0);

// Removing a counted row needs the exact amount as well: the 10% order
// tolerance took a ₹1,691 Myntra item for a repeat of a ₹1,780 one.
const coversShipping = (payment: Dated, shipping: Dated) =>
  isPaymentForShipping(payment, shipping) && Math.abs((payment.amount ?? 0) - (shipping.amount ?? 0)) <= 0.5;

// Which rows made only of shipping updates no longer count: one a payment
// covers, and of several for the same unpaid order, all but the first.
export function unneededShippingRows(rows: ShippingCandidate[]): string[] {
  const payments = rows.filter((r) => !r.shippingOnly);
  const room = new Map(payments.map((p) => [p.id, p.amount ?? 0]));
  const kept: ShippingCandidate[] = [];
  const held: ShippingCandidate[] = [];
  const drop: string[] = [];
  const time = (r: Dated) => r.transaction_datetime ?? "";
  const updates = rows.filter((r) => r.shippingOnly).sort((a, b) => time(a).localeCompare(time(b)));
  for (const s of updates) {
    // The whole order, or a repeat of an update already placed.
    if (payments.some((p) => coversShipping(p, s)) || [...kept, ...held].some((k) => coversShipping(k, s))) {
      drop.push(s.id);
      continue;
    }
    const order = payments.filter((p) => holdsItem(p, s, room.get(p.id)!)).sort((a, b) => time(b).localeCompare(time(a)))[0];
    if (order) {
      room.set(order.id, room.get(order.id)! - (s.amount ?? 0));
      held.push(s);
      drop.push(s.id);
    } else kept.push(s);
  }
  return drop;
}

// An update is counted when it arrives before anything paid for it, and the
// payment can come later - a delayed alert, or mail read by the 90-day import:
// a ₹525 Svaras order showed four times. So whenever a payment or an update is
// saved, the shipping-only rows around it are settled again, whichever came first.
export async function settleShippingRows(db: any, userId: string, around: string): Promise<number> {
  const at = Date.parse(around);
  const { data: rows, error } = await db
    .from("transactions_normalized")
    .select("id, merchant_normalized, amount, transaction_datetime, raw_transaction_ids")
    .eq("user_id", userId)
    // A refund pays for nothing (a ₹1,295 cancellation was taken for an order).
    .or("transaction_type.is.null,transaction_type.neq.refund")
    .gte("transaction_datetime", new Date(at - 2 * SHIPPING_LOOKBACK_MS).toISOString())
    .lte("transaction_datetime", new Date(at + 2 * SHIPPING_LOOKBACK_MS).toISOString());
  if (error) throw new Error(`[shipping] settle lookup failed: ${error.message}`);
  const rawIds: string[] = (rows ?? []).flatMap((r: { raw_transaction_ids: string[] | null }) => r.raw_transaction_ids ?? []);
  const raw = new Map<string, { event_kind: string | null; payment_method: string | null }>();
  for (let i = 0; i < rawIds.length; i += 200) {
    const { data, error: kindError } = await db.from("transactions_raw").select("id, event_kind, payment_method").in("id", rawIds.slice(i, i + 200));
    if (kindError) throw new Error(`[shipping] settle lookup failed: ${kindError.message}`);
    for (const r of data ?? []) raw.set(r.id, r);
  }
  const drop = unneededShippingRows((rows ?? []).map((r: any) => ({
    ...r,
    shippingOnly: (r.raw_transaction_ids ?? []).length > 0 && r.raw_transaction_ids.every((id: string) => raw.get(id)?.event_kind === "shipping"),
    methods: (r.raw_transaction_ids ?? []).map((id: string) => raw.get(id)?.payment_method ?? null),
  })));
  if (!drop.length) return 0;
  const { error: deleteError } = await db.from("transactions_normalized").delete().in("id", drop);
  if (deleteError) throw new Error(`[shipping] settle delete failed: ${deleteError.message}`);
  return drop.length;
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

// One transfer, several bank emails. Both ends report it - HDFC's debit and
// Axis's credit for a move between the founder's own accounts - and HDFC sends
// an RTGS "initiated" and a "completed" notice: the ₹2,60,000 loan payment on
// 1 September was three rows. Two alerts are otherwise never merged.
const TRANSFER_TYPES = new Set(["bank_transfer", "p2p_transfer", "salary_credit"]);
const TRANSFER_REF_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const refsOf = (r: TransactionRaw) => [r.transaction_id, r.reference_id].map((v) => v?.trim() ?? "").filter((v) => v.length >= 8);

// The bank reference (UTR, IMPS number) is quoted on both ends, sometimes
// inside a longer string: Axis's "IMPS/P2A/626039800226/ASHISHJA" carries
// HDFC's "626039800226".
function sharesTransferRef(a: TransactionRaw, b: TransactionRaw): boolean {
  if (!TRANSFER_TYPES.has(a.transaction_type ?? "") || !TRANSFER_TYPES.has(b.transaction_type ?? "")) return false;
  if (Math.abs(a.amount! - b.amount!) > 0.5) return false;
  const ra = refsOf(a), rb = refsOf(b);
  return ra.some((x) => rb.some((y) => x === y || (x.length >= 10 && y.includes(x)) || (y.length >= 10 && x.includes(y))));
}

// An initiation and its confirmation: same sender, exactly the same amount,
// minutes apart. One names the payee, the other gives the account, so the
// recipients must not contradict - two different accounts, or two different
// names, are two transfers.
function isSameTransferNotice(a: TransactionRaw, b: TransactionRaw, gapMs: number): boolean {
  const transfer = (r: TransactionRaw) => r.transaction_type === "bank_transfer" || r.transaction_type === "p2p_transfer";
  if (!transfer(a) || !transfer(b) || gapMs > WINDOW_MS) return false;
  if (!a.raw_sender || a.raw_sender.toLowerCase() !== b.raw_sender?.toLowerCase()) return false;
  if (Math.abs(a.amount! - b.amount!) > 0.5) return false;
  const [ka, kb] = [a.recipient_key, b.recipient_key];
  return !(ka && kb && ka !== kb && ka.split(":")[0] === kb.split(":")[0]);
}

// A refund is announced twice - "initiated", then "processed" a day or two
// later - and the second often carries only the bank's ARN, not the return ID:
// one ₹1,399 Myntra return was subtracted twice. Same shop, the same amount
// within three days, and no two different IDs. The first email named the
// seller ("Pepe Jeans") and the second Myntra, so the shop's own sender counts
// as the shop - never a bank's, which sends refunds for every merchant.
export const REFUND_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
function isSameRefund(a: TransactionRaw, b: TransactionRaw, gapMs: number): boolean {
  if (a.transaction_type !== "refund" || b.transaction_type !== "refund" || gapMs > REFUND_WINDOW_MS) return false;
  if (Math.abs(a.amount! - b.amount!) > 0.5) return false;
  const shopSender = (r: TransactionRaw) => (ALERT_SOURCES.has(r.sender_type ?? "") ? "" : senderDomain(r));
  const sameShop = merchantSimilarity(a.merchant_normalized, b.merchant_normalized) >= 0.85 || (!!shopSender(a) && shopSender(a) === shopSender(b));
  return sameShop && !(a.transaction_id && b.transaction_id && a.transaction_id !== b.transaction_id);
}

function areDuplicates(a: TransactionRaw, b: TransactionRaw): boolean {
  if (!a.amount || !b.amount) return false;
  if (isSameOrder(a, b)) return true;
  if (!isSameAmount(a.amount, b.amount)) return false;

  const ta = a.transaction_datetime ? new Date(a.transaction_datetime).getTime() : 0;
  const tb = b.transaction_datetime ? new Date(b.transaction_datetime).getTime() : 0;
  if (Math.abs(ta - tb) <= TRANSFER_REF_WINDOW_MS && sharesTransferRef(a, b)) return true;
  if (isSameTransferNotice(a, b, Math.abs(ta - tb))) return true;
  const refundMismatch = (a.transaction_type === "refund") !== (b.transaction_type === "refund");
  if (!refundMismatch && isAlertAndReceipt(a, b, Math.abs(ta - tb))) return true;
  if (isSameRefund(a, b, Math.abs(ta - tb))) return true;
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
    // Between equal senders, the debit side of a transfer leads: Axis files
    // the credit end of a move from HDFC as "salary_credit", which is not what
    // the transfer was.
    const debitSide = (r: TransactionRaw) => (r.transaction_type === "salary_credit" ? 0 : 1);
    const primary = group.reduce((best, cur) =>
      priorityOf(cur) > priorityOf(best) ||
      (priorityOf(cur) === priorityOf(best) && (debitSide(cur) > debitSide(best) || (debitSide(cur) === debitSide(best) && time(cur) > time(best))))
        ? cur : best
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
      // The receipt knows the order's full value; the card alert only its share.
      order_total: Math.max(0, ...group.map((r) => Number(r.order_total ?? 0))) || null,
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

    // Regrouping only ever adds emails to a row. A run sees part of the data -
    // a 24-hour window, plus rows sharing an order ID - and a partial group
    // used to overwrite the row with fewer emails: Axis repeats BookMyShow's
    // merchant ID "89098526" in every alert, so a new booking pulled in older
    // alerts without their ticket receipts, and the receipts fell out of the
    // finance tab.
    const union = (key: "communication_ids" | "raw_transaction_ids") =>
      [...new Set([...norm[key], ...matches.flatMap((m) => m[key] ?? [])])].sort();
    const { error: updateErr } = await db
      .from("transactions_normalized")
      .update({ ...withChoices(norm, matches), communication_ids: union("communication_ids"), raw_transaction_ids: union("raw_transaction_ids"), updated_at: now })
      .eq("id", keep.id);
    if (updateErr) console.error(`[dedup] update failed for ${keep.id}: ${updateErr.message}`);
    else stats.updated++;
  }
  return stats;
}

type PriorRow = { id: string; communication_ids?: string[]; raw_transaction_ids?: string[] } & Partial<Overrides>;

async function overlappingRows(db: any, userId: string, communicationIds: string[]): Promise<PriorRow[]> {
  const { data, error } = await db
    .from("transactions_normalized")
    .select("id, communication_ids, raw_transaction_ids, category, category_source, counted_override, counted_source")
    .eq("user_id", userId)
    .overlaps("communication_ids", communicationIds)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`[dedup] overlap lookup failed: ${error.message}`);
  return data ?? [];
}
