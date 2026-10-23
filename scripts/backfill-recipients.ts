/**
 * Reads who each stored transfer went to, or came from, out of its email
 * (lib/finance/recipient.ts) and saves it on the transaction, so a rule for
 * "every transfer to account …5389" matches past transfers as well as new
 * ones. A transaction made of several emails takes the account where one
 * gives it, as regrouping does.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-recipients.ts
 *   ...                                                                     --apply
 */

import { createClient } from "@supabase/supabase-js";
import { transferRecipient, type Recipient } from "@/lib/finance/recipient";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Raw = { id: string; communication_id: string; transaction_type: string | null; amount: number | null; transaction_datetime: string | null };

async function main() {
  const raws: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions_raw").select("id, communication_id, transaction_type, amount, transaction_datetime").order("id").range(from, from + 999);
    if (error) throw error;
    raws.push(...((data ?? []) as Raw[]));
    if (!data || data.length < 1000) break;
  }
  const bodies = new Map<string, string>();
  const ids = [...new Set(raws.map((r) => r.communication_id))];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("communications").select("id, body").in("id", ids.slice(i, i + 150));
    if (error) throw error;
    for (const c of data ?? []) bodies.set(c.id, c.body ?? "");
  }
  const found = new Map<string, Recipient>();
  for (const r of raws) {
    const rec = transferRecipient(bodies.get(r.communication_id));
    if (rec) found.set(r.id, rec);
  }

  const norms: { id: string; raw_transaction_ids: string[]; merchant_normalized: string | null; amount: number; transaction_type: string | null; transaction_datetime: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions_normalized").select("id, raw_transaction_ids, merchant_normalized, amount, transaction_type, transaction_datetime").order("id").range(from, from + 999);
    if (error) throw error;
    norms.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const normChanges = norms.flatMap((n) => {
    const recs = n.raw_transaction_ids.map((id) => found.get(id)).filter((r): r is Recipient => !!r);
    const rec = recs.find((r) => r.key.startsWith("account:")) ?? recs[0];
    return rec ? [{ id: n.id, rec, n }] : [];
  });

  const byRecipient = new Map<string, string[]>();
  for (const { rec, n } of normChanges) byRecipient.set(rec.label, [...(byRecipient.get(rec.label) ?? []), `₹${Math.round(n.amount).toLocaleString("en-IN")} ${n.transaction_datetime.slice(0, 10)} ${n.transaction_type}`]);
  console.log(`${found.size} emails name a recipient; ${normChanges.length} transactions get one:\n`);
  for (const [label, list] of [...byRecipient].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${label} (${list.length}): ${list.join(" | ")}`);
  if (!APPLY) return console.log("\nDry run - nothing written. Run migrations/add-transfer-recipient.sql, then re-run with --apply.");

  for (const [rawId, rec] of found) {
    const { error } = await db.from("transactions_raw").update({ recipient_key: rec.key, recipient_label: rec.label }).eq("id", rawId);
    if (error) throw new Error(error.message);
  }
  for (const { id, rec } of normChanges) {
    const { error } = await db.from("transactions_normalized").update({ recipient_key: rec.key, recipient_label: rec.label }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  console.log(`\nSaved recipients on ${found.size} emails and ${normChanges.length} transactions.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
