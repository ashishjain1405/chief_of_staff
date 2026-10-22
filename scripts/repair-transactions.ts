/**
 * Repairs extraction and dedup faults in stored transactions.
 *
 * A. Merchant spends typed as transfers. Before the extraction prompt fix
 *    (deployed to the worker 2026-10-19 17:52 UTC) a debit-card purchase from a
 *    bank alert - "spent at BOOK MY SHOW" - was often typed bank_transfer, so the
 *    finance tab showed it as "Not counted · transfer". Those rows are
 *    re-extracted with the current prompt; only type and category are updated.
 *
 * B. IST times stored as UTC. Bank alerts give a local time with no zone
 *    ("19-10-2026 21:25:36"), extraction returned it without an offset, and it
 *    was stored as 21:25 UTC - 5h30m late, which can push it onto the next day.
 *    A transaction cannot happen after the email reporting it, so rows stored
 *    hours after their email arrived are shifted back by 5h30m - and so are
 *    bank alerts whose stored time is exactly the time they state plus 5h30m,
 *    which the first rule misses when the bank sent the alert hours late.
 *
 * C. Spellings a new dictionary entry now claims. Ask AI looks a merchant up by
 *    its dictionary name, so once "BookMyShow" is in the dictionary, rows left
 *    as "BOOK MY SHOW" would drop out of "how much on BookMyShow?".
 *
 * D. Purchases counted twice. Dedup merges a bank alert with its receipt when
 *    they are within 15 minutes; with one of the pair stored 5h30m late they
 *    never were - Bata ₹699 was a card alert and a receipt, two transactions.
 *    The same shift kept some rows off the finance tab entirely: dated in the
 *    future when extracted, they fell outside a dedup window that ends at now.
 *    Dedup is re-run over the corrected times and names, and only groups that
 *    merge existing rows or take in a missing one are written. The dedup rules
 *    now also join a card alert to the receipt naming the restaurant or brand
 *    ("ZOMATO" and "Themis Barbeque House").
 *
 * E. Bank alerts from .bank.in domains stored as UNKNOWN senders, which hid
 *    them from the alert-and-receipt rule.
 *
 * F. Known merchants typed as transfers (an Uber Cash ride), and rides typed
 *    food_order.
 *
 * H. (with B) Dates with no time, stored as midnight UTC - "05:30" - move to
 *    the email's arrival time when it arrived that day.
 *
 * G. Shipping updates counted as purchases. Each is relabelled "shipping"; its
 *    own row is removed when an earlier payment covers it and kept when it is
 *    the only record of the purchase.
 *
 * The dry run writes a plan file; --apply writes exactly that plan, so what is
 * changed is what was reviewed.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/repair-transactions.ts --plan plan.json
 *   ...                                                                           --apply plan.json
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { classifySender } from "@/lib/finance/senders";
import { MERCHANT_DATA, findKnownMerchant, getCategoryForMerchant, resolveTransactionType } from "@/lib/finance/normalize";
import { notSpendReason, spendAmount } from "@/lib/finance/spend";
import { deduplicateRawTransactions, isPaymentForShipping, isShippingUpdate, saveNormalizedGroups, type NormalizedTransaction } from "@/lib/finance/dedup";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PROMPT_FIX = "2026-10-19T17:52:00Z";
const TRANSFERS = ["bank_transfer", "p2p_transfer"];
const IST_OFFSET_MIN = 330;
// Stored this long after the email arrived: an IST wall-clock time saved as
// UTC, less the minutes the alert took to arrive. Nothing correct lands here.
const SHIFTED_MIN = { from: 240, to: 345 };
const RENAMED = ["BookMyShow", "PVR INOX", "Honey Dough", "Indus Flavour", "Bata", "Mediscape Imaging", "The Whole Truth Foods", "GYFTR", "Svaras", "Domino's", "HP Gas"];
const TABLES = ["transactions_raw", "transactions_normalized"] as const;

type Plan = {
  transfers: {
    normId: string; merchant: string; amount: number; when: string;
    old: { type: string; category: string | null }; next: { type: string; category: string | null };
    raw: { id: string; transaction_type: string; category: string | null }[];
  }[];
  times: {
    raw: { id: string; from: string; to: string; merchant: string | null; amount: number | null; deltaMin: number }[];
    norm: { id: string; from: string; to: string }[];
  };
  merchants: { table: (typeof TABLES)[number]; id: string; from: string; to: string; category: string | null }[];
  merges: { group: NormalizedTransaction; rows: { id: string; merchant: string | null; amount: number; spend: number }[] }[];
  senders: { id: string; from: string | null; to: string }[];
  types: { table: (typeof TABLES)[number]; id: string; merchant: string | null; amount: number; from: string; to: string }[];
  shipping: { rawId: string; normId: string | null; merchant: string | null; amount: number; when: string; subject: string; coveredBy: string | null }[];
};

const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
// The time a bank alert states, in IST: HDFC "on 13 Sep, 2026 at 18:20:44",
// Axis "26-09-2026 14:07:50".
function statedTime(body: string): number | null {
  let m = body.match(/on (\d{1,2}) ([A-Za-z]{3})[a-z]*,? (\d{4}) at (\d{2}):(\d{2}):(\d{2})/);
  if (m && MON[m[2].toLowerCase()]) return Date.parse(`${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}T${m[4]}:${m[5]}:${m[6]}+05:30`);
  m = body.match(/(\d{2})-(\d{2})-(\d{4}),? (\d{2}):(\d{2}):(\d{2})/);
  if (m) return Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
  return null;
}

const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const ist = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

async function chunked<T>(ids: string[], run: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await run(ids.slice(i, i + 150))));
  return out;
}

async function all<T>(query: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function planTransfers(): Promise<Plan["transfers"]> {
  const norms = await all<any>((from) =>
    db.from("transactions_normalized")
      .select("id, merchant_normalized, amount, category, transaction_type, transaction_datetime, raw_transaction_ids, primary_source, status")
      .in("transaction_type", TRANSFERS).not("merchant_normalized", "is", null)
      .order("transaction_datetime", { ascending: false }).range(from, from + 999)
  );
  const rawIds = [...new Set(norms.flatMap((n) => n.raw_transaction_ids ?? []))] as string[];
  const raws = await chunked<any>(rawIds, async (part) => {
    const { data, error } = await db.from("transactions_raw")
      .select("id, communication_id, transaction_type, category, merchant_normalized, sender_type, extracted_at, amount")
      .in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const rawById = new Map(raws.map((r) => [r.id, r]));

  const plan: Plan["transfers"] = [];
  let skippedNewer = 0;
  for (const n of norms) {
    const group = (n.raw_transaction_ids as string[]).map((id) => rawById.get(id)).filter(Boolean);
    if (!group.length || group.some((r) => r.extracted_at >= PROMPT_FIX)) { skippedNewer++; continue; }

    const next: Plan["transfers"][number]["raw"] = [];
    for (const r of group) {
      const { data: comm } = await db.from("communications")
        .select("subject, body, occurred_at, contacts(email)").eq("id", r.communication_id).single();
      const sender = (comm?.contacts as any)?.email ?? "";
      const ext = await extractFinancialTransaction(sender, classifySender(sender), comm?.subject ?? "", comm?.body ?? "", comm?.occurred_at);
      const t = ext.transaction;
      // Same rule as the worker: a known merchant's category wins.
      const category = r.merchant_normalized ? (getCategoryForMerchant(r.merchant_normalized) ?? t?.category ?? null) : (t?.category ?? null);
      if (!ext.is_financial_email || !t?.transaction_type || t.event_kind !== "completed") {
        console.log(`  ! ${n.merchant_normalized} ${n.amount}: re-extraction says ${ext.is_financial_email ? t?.event_kind : "not financial"} - left as is`);
        continue;
      }
      if (t.amount != null && Number(t.amount) !== Number(r.amount)) {
        console.log(`  ! ${n.merchant_normalized}: amount ${r.amount} now reads ${t.amount} - amount is not changed`);
      }
      next.push({ id: r.id, transaction_type: t.transaction_type, category });
    }
    if (next.length !== group.length) continue;
    // Only rows that become spending. Moving between two kinds of not-spending
    // changes nothing on the finance tab, and the re-extraction's guesses there
    // are no better than what is stored - a family NEFT came back as salary.
    if (next.some((x) => notSpendReason({ ...x, merchant_normalized: n.merchant_normalized }) !== null)) continue;

    // The normalized row takes its type from the primary email, as dedup does.
    const primaryIdx = Math.max(0, group.findIndex((r) => r.sender_type === n.primary_source && r.transaction_type === n.transaction_type));
    const nextType = next[primaryIdx].transaction_type;
    const nextCategory = next[primaryIdx].category ?? next.find((x) => x.category)?.category ?? null;
    plan.push({
      normId: n.id, merchant: n.merchant_normalized, amount: Number(n.amount), when: n.transaction_datetime,
      old: { type: n.transaction_type, category: n.category },
      next: { type: nextType, category: nextCategory },
      raw: next,
    });
  }
  console.log(`\nA. ${norms.length} transfer rows with a merchant; ${skippedNewer} extracted after the prompt fix, skipped.\n`);
  return plan;
}

async function planTimes(): Promise<Plan["times"]> {
  const raws = await all<any>((from) =>
    db.from("transactions_raw")
      .select("id, communication_id, transaction_datetime, merchant_normalized, amount, raw_sender")
      .eq("is_financial_email", true).not("transaction_datetime", "is", null)
      .order("id").range(from, from + 999)
  );
  const comms = await chunked<any>([...new Set(raws.map((r) => r.communication_id))], async (part) => {
    const { data, error } = await db.from("communications").select("id, occurred_at").in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const arrived = new Map(comms.map((c) => [c.id, c.occurred_at]));
  const alertIds = [...new Set(raws.filter((r) => classifySender(r.raw_sender ?? "") === "BANK").map((r) => r.communication_id))];
  const bodies = await chunked<any>(alertIds, async (part) => {
    const { data, error } = await db.from("communications").select("id, body").in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const stated = new Map(bodies.map((c) => [c.id, statedTime(String(c.body ?? ""))]));

  const buckets: Record<string, number> = { "before email": 0, "0-60 min after": 0, "1-4 h after": 0, "4-5h45 after": 0, "over 5h45 after": 0 };
  const shifted: Plan["times"]["raw"] = [];
  for (const r of raws) {
    const at = arrived.get(r.communication_id);
    if (!at) continue;
    const delta = (Date.parse(r.transaction_datetime) - Date.parse(at)) / 60000;
    if (delta <= 0) buckets["before email"]++;
    else if (delta <= 60) buckets["0-60 min after"]++;
    else if (delta < SHIFTED_MIN.from) buckets["1-4 h after"]++;
    else if (delta <= SHIFTED_MIN.to) buckets["4-5h45 after"]++;
    else buckets["over 5h45 after"]++;
    const said = stated.get(r.communication_id);
    const lateAlert = said != null && Math.abs((Date.parse(r.transaction_datetime) - said) / 60000 - IST_OFFSET_MIN) <= 2;
    // H. A date with no time, stored as midnight UTC, on the day the email
    // arrived: the arrival time, as the worker now does.
    const dateOnly = /T00:00:00(\.0+)?(\+00:00|Z)$/.test(r.transaction_datetime) && istDay(at) === istDay(r.transaction_datetime);
    if (dateOnly) {
      shifted.push({ id: r.id, from: r.transaction_datetime, deltaMin: Math.round(delta), to: new Date(at).toISOString(), merchant: r.merchant_normalized, amount: r.amount });
    } else if ((delta >= SHIFTED_MIN.from && delta <= SHIFTED_MIN.to) || lateAlert) {
      shifted.push({
        id: r.id, from: r.transaction_datetime, deltaMin: Math.round(delta),
        to: new Date(Date.parse(r.transaction_datetime) - IST_OFFSET_MIN * 60000).toISOString(),
        merchant: r.merchant_normalized, amount: r.amount,
      });
    }
  }
  console.log(`B. Stored time vs email arrival, ${raws.length} rows:`, buckets);

  // A normalized row is dated by its earliest email, so recompute from the
  // corrected raw times.
  const fixed = new Map(shifted.map((s) => [s.id, s.to]));
  const norms = await chunked<any>(shifted.map((s) => s.id), async (part) => {
    const { data, error } = await db.from("transactions_normalized")
      .select("id, transaction_datetime, raw_transaction_ids").overlaps("raw_transaction_ids", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const groupIds = [...new Set(norms.flatMap((n) => n.raw_transaction_ids as string[]))];
  const groupRaws = await chunked<any>(groupIds, async (part) => {
    const { data, error } = await db.from("transactions_raw").select("id, transaction_datetime").in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const timeOf = new Map(groupRaws.map((r) => [r.id, fixed.get(r.id) ?? r.transaction_datetime]));
  const norm = [...new Map(norms.map((n) => [n.id, n])).values()].flatMap((n) => {
    const times = (n.raw_transaction_ids as string[]).map((id) => timeOf.get(id)).filter(Boolean) as string[];
    const earliest = times.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
    return Date.parse(earliest) === Date.parse(n.transaction_datetime) ? [] : [{ id: n.id, from: n.transaction_datetime, to: earliest }];
  });
  return { raw: shifted, norm };
}

async function planMerchants(): Promise<Plan["merchants"]> {
  const out: Plan["merchants"] = [];
  for (const table of TABLES) {
    const rows = await all<any>((from) =>
      db.from(table).select("id, merchant_normalized").not("merchant_normalized", "is", null).order("id").range(from, from + 999)
    );
    for (const r of rows) {
      const canonical = findKnownMerchant(r.merchant_normalized);
      if (!canonical || !RENAMED.includes(canonical) || r.merchant_normalized === canonical) continue;
      out.push({ table, id: r.id, from: r.merchant_normalized, to: canonical, category: getCategoryForMerchant(canonical) });
    }
  }
  return out;
}

async function planMerges(
  times: Plan["times"], merchants: Plan["merchants"], senders: Plan["senders"], types: Plan["types"], shipping: Plan["shipping"]
): Promise<Plan["merges"]> {
  const raws = await all<any>((from) =>
    db.from("transactions_raw").select("*")
      .eq("is_financial_email", true).eq("needs_review", false).eq("event_kind", "completed")
      .not("transaction_datetime", "is", null).order("id").range(from, from + 999)
  );
  // As the rows will be once the other steps are applied.
  const shifted = new Map(times.raw.map((t) => [t.id, t.to]));
  const renamed = new Map(merchants.filter((m) => m.table === "transactions_raw").map((m) => [m.id, m]));
  const sender = new Map(senders.map((s) => [s.id, s.to]));
  const retyped = new Map(types.filter((t) => t.table === "transactions_raw").map((t) => [t.id, t.to]));
  const relabelled = new Set(shipping.map((s) => s.rawId));
  for (let i = raws.length - 1; i >= 0; i--) if (relabelled.has(raws[i].id)) raws.splice(i, 1);
  for (const r of raws) {
    r.transaction_datetime = shifted.get(r.id) ?? r.transaction_datetime;
    const m = renamed.get(r.id);
    if (m) { r.merchant_normalized = m.to; r.category = m.category ?? r.category; }
    r.sender_type = sender.get(r.id) ?? r.sender_type;
    r.transaction_type = retyped.get(r.id) ?? r.transaction_type;
  }
  const removed = new Set(shipping.map((s) => s.normId).filter(Boolean));
  const norms = (await all<any>((from) =>
    db.from("transactions_normalized")
      .select("id, merchant_normalized, amount, transaction_type, category, status, communication_ids").order("id").range(from, from + 999)
  )).filter((n) => !removed.has(n.id));
  const byComm = new Map<string, any>(norms.flatMap((n) => n.communication_ids.map((c: string) => [c, n])));

  const out: Plan["merges"] = [];
  for (const userId of new Set(raws.map((r) => r.user_id))) {
    for (const g of deduplicateRawTransactions(raws.filter((r) => r.user_id === userId))) {
      const existing = [...new Map(g.communication_ids.map((c) => byComm.get(c)).filter(Boolean).map((n) => [n.id, n])).values()];
      const missing = g.communication_ids.filter((c) => !byComm.has(c));
      if (existing.length < 2 && !missing.length) continue;
      // The kept row takes exactly the group's emails, so an email it holds
      // outside the group would drop out of the finance tab.
      if (existing.some((n) => n.communication_ids.some((c: string) => !g.communication_ids.includes(c)))) {
        console.log(`  ! merge of ${existing.map((n) => `${n.merchant_normalized} ${n.amount}`).join(" + ")} would drop an email - skipped`);
        continue;
      }
      out.push({ group: g, rows: existing.map((n) => ({ id: n.id, merchant: n.merchant_normalized, amount: Number(n.amount), spend: spendAmount(n) })) });
    }
  }
  return out;
}

async function planSenders(): Promise<Plan["senders"]> {
  const rows = await all<any>((from) =>
    db.from("transactions_raw").select("id, raw_sender, sender_type").eq("sender_type", "UNKNOWN").order("id").range(from, from + 999)
  );
  return rows.flatMap((r) => {
    const to = classifySender(r.raw_sender ?? "");
    return to === "UNKNOWN" ? [] : [{ id: r.id, from: r.sender_type, to }];
  });
}

// A ride is not a food order either: two Uber receipts came back food_order.
function retype(type: string | null, merchant: string | null): string | null {
  if (type === "food_order" && merchant && MERCHANT_DATA[merchant]?.category === "transport") return "purchase";
  return resolveTransactionType(type, merchant);
}

async function planTypes(): Promise<Plan["types"]> {
  const out: Plan["types"] = [];
  for (const table of TABLES) {
    const rows = await all<any>((from) =>
      db.from(table).select("id, merchant_normalized, amount, transaction_type").not("merchant_normalized", "is", null).order("id").range(from, from + 999)
    );
    for (const r of rows) {
      const to = retype(r.transaction_type, r.merchant_normalized);
      if (to && to !== r.transaction_type) out.push({ table, id: r.id, merchant: r.merchant_normalized, amount: Number(r.amount), from: r.transaction_type, to });
    }
  }
  return out;
}

async function planShipping(): Promise<Plan["shipping"]> {
  const raws = await all<any>((from) =>
    db.from("transactions_raw")
      .select("id, communication_id, merchant_normalized, amount, transaction_datetime, transaction_id, reference_id, communications(subject)")
      .eq("is_financial_email", true).eq("needs_review", false).eq("event_kind", "completed")
      .not("transaction_datetime", "is", null).order("id").range(from, from + 999)
  );
  // An update sharing an order ID with another email is already joined to it.
  const idCount = new Map<string, number>();
  for (const r of raws) for (const id of new Set([r.transaction_id, r.reference_id].filter((v) => v && v.trim().length >= 6))) idCount.set(id, (idCount.get(id) ?? 0) + 1);
  const candidates = raws
    .filter((r) => isShippingUpdate(String(r.communications?.subject ?? "")))
    .filter((r) => ![r.transaction_id, r.reference_id].some((id) => id && (idCount.get(id) ?? 0) > 1))
    .sort((a, b) => Date.parse(a.transaction_datetime) - Date.parse(b.transaction_datetime));

  const norms = await all<any>((from) =>
    db.from("transactions_normalized").select("id, merchant_normalized, amount, transaction_datetime, communication_ids").order("id").range(from, from + 999)
  );
  const out: Plan["shipping"] = [];
  const dropped = new Set<string>();
  for (const r of candidates) {
    const own = norms.find((n) => n.communication_ids.includes(r.communication_id));
    // Already joined to a payment in its row: relabelling could only change that row's primary.
    if (own && own.communication_ids.length > 1) continue;
    const cover = norms.find((n) => n !== own && !dropped.has(n.id) && isPaymentForShipping(n, r));
    if (cover && own) dropped.add(own.id);
    out.push({
      rawId: r.id, normId: cover && own ? own.id : null, merchant: r.merchant_normalized, amount: Number(r.amount), when: r.transaction_datetime,
      subject: String(r.communications?.subject ?? "").slice(0, 60), coveredBy: cover ? `${cover.merchant_normalized} ₹${cover.amount} ${ist(cover.transaction_datetime)}` : null,
    });
  }
  return out;
}

async function apply(plan: Plan) {
  for (const t of plan.transfers) {
    for (const r of t.raw) {
      const { error } = await db.from("transactions_raw").update({ transaction_type: r.transaction_type, category: r.category }).eq("id", r.id);
      if (error) throw new Error(`raw ${r.id}: ${error.message}`);
    }
    const { error } = await db.from("transactions_normalized")
      .update({ transaction_type: t.next.type, category: t.next.category, updated_at: new Date().toISOString() }).eq("id", t.normId);
    if (error) throw new Error(`normalized ${t.normId}: ${error.message}`);
  }
  for (const r of plan.times.raw) {
    const { error } = await db.from("transactions_raw").update({ transaction_datetime: r.to }).eq("id", r.id).eq("transaction_datetime", r.from);
    if (error) throw new Error(`raw ${r.id}: ${error.message}`);
  }
  for (const n of plan.times.norm) {
    const { error } = await db.from("transactions_normalized").update({ transaction_datetime: n.to, updated_at: new Date().toISOString() }).eq("id", n.id);
    if (error) throw new Error(`normalized ${n.id}: ${error.message}`);
  }
  for (const m of plan.merchants) {
    const { error } = await db.from(m.table).update({ merchant_normalized: m.to, ...(m.category ? { category: m.category } : {}) }).eq("id", m.id);
    if (error) throw new Error(`${m.table} ${m.id}: ${error.message}`);
  }
  for (const s of plan.senders ?? []) {
    const { error } = await db.from("transactions_raw").update({ sender_type: s.to }).eq("id", s.id);
    if (error) throw new Error(`raw ${s.id}: ${error.message}`);
  }
  for (const t of plan.types ?? []) {
    const { error } = await db.from(t.table).update({ transaction_type: t.to }).eq("id", t.id);
    if (error) throw new Error(`${t.table} ${t.id}: ${error.message}`);
  }
  for (const s of plan.shipping ?? []) {
    const { error } = await db.from("transactions_raw").update({ event_kind: "shipping" }).eq("id", s.rawId);
    if (error) throw new Error(`raw ${s.rawId}: ${error.message}`);
    if (!s.normId) continue;
    const { error: delErr } = await db.from("transactions_normalized").delete().eq("id", s.normId);
    if (delErr) throw new Error(`normalized ${s.normId}: ${delErr.message}`);
  }
  let collapsed = 0;
  for (const userId of new Set(plan.merges.map((m) => m.group.user_id))) {
    const stats = await saveNormalizedGroups(db, userId, plan.merges.filter((m) => m.group.user_id === userId).map((m) => m.group));
    collapsed += stats.collapsed;
  }
  console.log(`Applied: ${plan.transfers.length} re-typed, ${plan.times.raw.length} raw and ${plan.times.norm.length} normalized times shifted, ${plan.merchants.length} merchant names, ${(plan.senders ?? []).length} sender types, ${(plan.types ?? []).length} types, ${(plan.shipping ?? []).length} shipping updates, ${collapsed} duplicate rows merged away.`);
}

async function main() {
  const applyIdx = process.argv.indexOf("--apply");
  if (applyIdx > -1) return apply(JSON.parse(readFileSync(process.argv[applyIdx + 1], "utf8")));

  const planPath = process.argv[process.argv.indexOf("--plan") + 1];
  if (!planPath || planPath.startsWith("--")) throw new Error("--plan <file> or --apply <file>");
  const transfers = await planTransfers();
  const times = await planTimes();
  const merchants = await planMerchants();
  const senders = await planSenders();
  const types = await planTypes();
  const shipping = await planShipping();
  const plan: Plan = { transfers, times, merchants, senders, types, shipping, merges: await planMerges(times, merchants, senders, types, shipping) };

  console.table(plan.transfers.map((t) => ({
    merchant: t.merchant, amount: t.amount, when: ist(t.when),
    was: `${t.old.type} / ${t.old.category ?? "-"}`, now: `${t.next.type} / ${t.next.category ?? "-"}`,
    counted: `${notSpendReason({ transaction_type: t.old.type, category: t.old.category, merchant_normalized: t.merchant }) ?? "spend"} -> ${notSpendReason({ transaction_type: t.next.type, category: t.next.category, merchant_normalized: t.merchant }) ?? "spend"}`,
  })));
  console.table(plan.times.raw.map((r) => ({ merchant: r.merchant, amount: r.amount, afterEmail: `${r.deltaMin} min`, was: ist(r.from), now: ist(r.to) })));
  console.log(`${plan.times.norm.length} normalized rows change date.`);
  console.table(plan.merchants.map((m) => ({ table: m.table, was: m.from, now: `${m.to} / ${m.category ?? "category kept"}` })));
  console.log(`${plan.senders.length} raw rows get a sender type:`, Object.entries(plan.senders.reduce<Record<string, number>>((c, s) => ({ ...c, [s.to]: (c[s.to] ?? 0) + 1 }), {})));
  console.table(plan.types.map((t) => ({ table: t.table, merchant: t.merchant, amount: t.amount, was: t.from, now: t.to })));
  console.table(plan.shipping.map((s) => ({ when: ist(s.when), row: `${s.merchant} ₹${s.amount}`, subject: s.subject, outcome: s.coveredBy ? `removed, paid by ${s.coveredBy}` : s.normId ? "?" : "kept, only record" })));
  console.table(plan.merges.map((m) => ({
    when: ist(m.group.transaction_datetime),
    rows: [...m.rows.map((r) => `${r.merchant} ₹${r.amount}`), ...(m.group.communication_ids.length > m.rows.length ? ["(missing email)"] : [])].join(" + "),
    spend: `₹${Math.round(m.rows.reduce((s, r) => s + r.spend, 0))} -> ₹${Math.round(spendAmount(m.group as any))}`,
  })));
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`Plan written to ${planPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
