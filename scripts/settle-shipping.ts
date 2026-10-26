/**
 * One-off repair for shipping updates counted as spending (lib/finance/dedup
 * settleShippingRows). Two passes:
 *
 *  1. A "completed" row from a shipping email whose order or tracking ID is
 *     shared only with other shipping emails becomes "shipping" - the "picked
 *     up" mail for a ₹525 Svaras order shared Velocity's tracking number with
 *     a "being shipped" mail, not with the payment.
 *  2. Rows made only of shipping updates that a payment covers, or that repeat
 *     an earlier update for the same unpaid order, are removed. The raw rows
 *     stay, so nothing read from mail is lost.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/settle-shipping.ts
 *   ...                                                                       --apply
 */

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { isShippingUpdate, unneededShippingRows } from "@/lib/finance/dedup";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function all<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type Raw = { id: string; user_id: string; communication_id: string; event_kind: string | null; transaction_id: string | null; reference_id: string | null };
type Norm = { id: string; user_id: string; merchant_normalized: string | null; amount: number | null; transaction_datetime: string; raw_transaction_ids: string[] | null };

async function main() {
  const raws = await all<Raw>("transactions_raw", "id, user_id, communication_id, event_kind, transaction_id, reference_id");
  const subjects = new Map<string, string>();
  const commIds = raws.filter((r) => r.event_kind === "completed").map((r) => r.communication_id);
  for (let i = 0; i < commIds.length; i += 200) {
    const { data } = await db.from("communications").select("id, subject").in("id", commIds.slice(i, i + 200));
    for (const c of data ?? []) subjects.set(c.id, c.subject ?? "");
  }

  // Pass 1: IDs (6+ characters, as the order rule uses) held by completed rows.
  const idsOf = (r: Raw) => [r.transaction_id, r.reference_id].map((v) => v?.trim()).filter((v): v is string => !!v && v.length >= 6);
  const completedById = new Map<string, Raw[]>();
  for (const r of raws.filter((x) => x.event_kind === "completed")) for (const id of idsOf(r)) completedById.set(id, [...(completedById.get(id) ?? []), r]);
  const relabel = raws.filter((r) => r.event_kind === "completed" && isShippingUpdate(subjects.get(r.communication_id) ?? "")
    && !idsOf(r).some((id) => (completedById.get(id) ?? []).some((o) => o.id !== r.id && !isShippingUpdate(subjects.get(o.communication_id) ?? ""))));
  console.log(`Pass 1: ${relabel.length} completed rows from shipping emails become "shipping"`);
  for (const r of relabel) console.log(`  ${subjects.get(r.communication_id)?.slice(0, 80)}`);

  // Pass 2, on the kinds as they will be.
  const kind = new Map(raws.map((r) => [r.id, relabel.some((x) => x.id === r.id) ? "shipping" : r.event_kind]));
  const norms = await all<Norm>("transactions_normalized", "id, user_id, merchant_normalized, amount, transaction_datetime, raw_transaction_ids");
  const drop: Norm[] = [];
  for (const userId of new Set(norms.map((n) => n.user_id))) {
    const mine = norms.filter((n) => n.user_id === userId);
    const ids = new Set(unneededShippingRows(mine.map((n) => ({
      ...n, shippingOnly: (n.raw_transaction_ids ?? []).length > 0 && (n.raw_transaction_ids ?? []).every((id) => kind.get(id) === "shipping"),
    }))));
    drop.push(...mine.filter((n) => ids.has(n.id)));
  }
  const kept = norms.filter((n) => (n.raw_transaction_ids ?? []).length && (n.raw_transaction_ids ?? []).every((id) => kind.get(id) === "shipping") && !drop.includes(n));
  console.log(`\nPass 2: ${drop.length} shipping-only transactions removed (₹${Math.round(drop.reduce((s, n) => s + (n.amount ?? 0), 0)).toLocaleString("en-IN")}); ${kept.length} stay as the only record of their order`);
  for (const n of drop) console.log(`  remove ${n.transaction_datetime.slice(0, 10)} ₹${n.amount} ${n.merchant_normalized}`);
  for (const n of kept) console.log(`  keep   ${n.transaction_datetime.slice(0, 10)} ₹${n.amount} ${n.merchant_normalized}`);
  if (!APPLY) return console.log("\nDry run - nothing written. Re-run with --apply.");

  writeFileSync(`settle-shipping-backup-${Date.now()}.json`, JSON.stringify({ relabel: relabel.map((r) => r.id), removed: drop }, null, 1));
  if (relabel.length) {
    const { error } = await db.from("transactions_raw").update({ event_kind: "shipping" }).in("id", relabel.map((r) => r.id));
    if (error) throw new Error(error.message);
  }
  if (drop.length) {
    const { error } = await db.from("transactions_normalized").delete().in("id", drop.map((n) => n.id));
    if (error) throw new Error(error.message);
  }
  console.log("\nApplied. A backup of what changed was written next to this script's working directory.");
}

main().catch((e) => { console.error(e); process.exit(1); });
