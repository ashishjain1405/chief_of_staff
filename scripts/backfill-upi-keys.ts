/**
 * Fills transactions_normalized.upi_key for transactions saved before it
 * existed (migrations/add-transaction-rules.sql), so a rule for a UPI payee
 * matches their past payments too. The key comes from the transaction's own
 * emails - the UPI ID extraction found - or a merchant that is itself a UPI
 * handle ("q470388412@ybl"). Regrouping sets it for everything new.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-upi-keys.ts
 *   ...                                                                     --apply
 */

import { createClient } from "@supabase/supabase-js";
import { upiKey } from "@/lib/finance/rules";

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

async function main() {
  const raws = await all<{ id: string; upi_id: string | null }>("transactions_raw", "id, upi_id");
  const upiOfRaw = new Map(raws.map((r) => [r.id, upiKey(r.upi_id)]));
  const rows = await all<{ id: string; merchant_normalized: string | null; raw_transaction_ids: string[]; upi_key?: string | null }>(
    "transactions_normalized", APPLY ? "id, merchant_normalized, raw_transaction_ids, upi_key" : "id, merchant_normalized, raw_transaction_ids"
  );

  const changes = rows.flatMap((r) => {
    const key = r.raw_transaction_ids.map((id) => upiOfRaw.get(id)).find(Boolean) ?? upiKey(r.merchant_normalized);
    return key && key !== r.upi_key ? [{ id: r.id, key, merchant: r.merchant_normalized }] : [];
  });
  const payees = new Map<string, number>();
  for (const c of changes) payees.set(c.key, (payees.get(c.key) ?? 0) + 1);
  console.log(`${rows.length} transactions: ${changes.length} get a UPI payee, ${payees.size} distinct payees`);
  console.log([...payees].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `  ${k}: ${n}`).join("\n"));
  if (!APPLY) return console.log("\nDry run - nothing written. Run the migration, then re-run with --apply.");

  for (const [key, ids] of [...Map.groupBy(changes, (c) => c.key)].map(([k, list]) => [k, list.map((c) => c.id)] as const)) {
    const { error } = await db.from("transactions_normalized").update({ upi_key: key }).in("id", ids);
    if (error) throw new Error(error.message);
  }
  console.log(`\nUpdated ${changes.length} transactions.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
