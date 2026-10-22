/**
 * Repairs two extraction faults in stored transactions.
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
 *    hours after their email arrived are shifted back by 5h30m.
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
 *    merge existing rows or take in a missing one are written.
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
import { findKnownMerchant, getCategoryForMerchant } from "@/lib/finance/normalize";
import { notSpendReason, spendAmount } from "@/lib/finance/spend";
import { deduplicateRawTransactions, saveNormalizedGroups, type NormalizedTransaction } from "@/lib/finance/dedup";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const PROMPT_FIX = "2026-10-19T17:52:00Z";
const TRANSFERS = ["bank_transfer", "p2p_transfer"];
const IST_OFFSET_MIN = 330;
// Stored this long after the email arrived: an IST wall-clock time saved as
// UTC, less the minutes the alert took to arrive. Nothing correct lands here.
const SHIFTED_MIN = { from: 240, to: 345 };
const RENAMED = ["BookMyShow", "PVR INOX", "Honey Dough", "Indus Flavour", "Bata", "Mediscape Imaging", "The Whole Truth Foods", "GYFTR", "Svaras"];
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
};

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
      .select("id, communication_id, transaction_datetime, merchant_normalized, amount")
      .eq("is_financial_email", true).not("transaction_datetime", "is", null)
      .order("id").range(from, from + 999)
  );
  const comms = await chunked<any>([...new Set(raws.map((r) => r.communication_id))], async (part) => {
    const { data, error } = await db.from("communications").select("id, occurred_at").in("id", part);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const arrived = new Map(comms.map((c) => [c.id, c.occurred_at]));

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
    if (delta >= SHIFTED_MIN.from && delta <= SHIFTED_MIN.to) {
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

async function planMerges(times: Plan["times"], merchants: Plan["merchants"]): Promise<Plan["merges"]> {
  const raws = await all<any>((from) =>
    db.from("transactions_raw").select("*")
      .eq("is_financial_email", true).eq("needs_review", false).eq("event_kind", "completed")
      .not("transaction_datetime", "is", null).order("id").range(from, from + 999)
  );
  // As the rows will be once B and C are applied.
  const shifted = new Map(times.raw.map((t) => [t.id, t.to]));
  const renamed = new Map(merchants.filter((m) => m.table === "transactions_raw").map((m) => [m.id, m]));
  for (const r of raws) {
    r.transaction_datetime = shifted.get(r.id) ?? r.transaction_datetime;
    const m = renamed.get(r.id);
    if (m) { r.merchant_normalized = m.to; r.category = m.category ?? r.category; }
  }
  const norms = await all<any>((from) =>
    db.from("transactions_normalized")
      .select("id, merchant_normalized, amount, transaction_type, category, status, communication_ids").order("id").range(from, from + 999)
  );
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
  let collapsed = 0;
  for (const userId of new Set(plan.merges.map((m) => m.group.user_id))) {
    const stats = await saveNormalizedGroups(db, userId, plan.merges.filter((m) => m.group.user_id === userId).map((m) => m.group));
    collapsed += stats.collapsed;
  }
  console.log(`Applied: ${plan.transfers.length} re-typed, ${plan.times.raw.length} raw and ${plan.times.norm.length} normalized times shifted, ${plan.merchants.length} merchant names, ${collapsed} duplicate rows merged away.`);
}

async function main() {
  const applyIdx = process.argv.indexOf("--apply");
  if (applyIdx > -1) return apply(JSON.parse(readFileSync(process.argv[applyIdx + 1], "utf8")));

  const planPath = process.argv[process.argv.indexOf("--plan") + 1];
  if (!planPath || planPath.startsWith("--")) throw new Error("--plan <file> or --apply <file>");
  const transfers = await planTransfers();
  const times = await planTimes();
  const merchants = await planMerchants();
  const plan: Plan = { transfers, times, merchants, merges: await planMerges(times, merchants) };

  console.table(plan.transfers.map((t) => ({
    merchant: t.merchant, amount: t.amount, when: ist(t.when),
    was: `${t.old.type} / ${t.old.category ?? "-"}`, now: `${t.next.type} / ${t.next.category ?? "-"}`,
    counted: `${notSpendReason({ transaction_type: t.old.type, category: t.old.category, merchant_normalized: t.merchant }) ?? "spend"} -> ${notSpendReason({ transaction_type: t.next.type, category: t.next.category, merchant_normalized: t.merchant }) ?? "spend"}`,
  })));
  console.table(plan.times.raw.map((r) => ({ merchant: r.merchant, amount: r.amount, afterEmail: `${r.deltaMin} min`, was: ist(r.from), now: ist(r.to) })));
  console.log(`${plan.times.norm.length} normalized rows change date.`);
  console.table(plan.merchants.map((m) => ({ table: m.table, was: m.from, now: `${m.to} / ${m.category ?? "category kept"}` })));
  console.table(plan.merges.map((m) => ({
    when: ist(m.group.transaction_datetime),
    rows: [...m.rows.map((r) => `${r.merchant} ₹${r.amount}`), ...(m.group.communication_ids.length > m.rows.length ? ["(missing email)"] : [])].join(" + "),
    spend: `₹${Math.round(m.rows.reduce((s, r) => s + r.spend, 0))} -> ₹${Math.round(spendAmount(m.group as any))}`,
  })));
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`Plan written to ${planPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
