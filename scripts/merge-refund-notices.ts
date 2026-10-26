/**
 * One-off repair: a refund announced twice ("initiated", then "processed")
 * and counted twice, from before lib/finance/dedup isSameRefund. Regroups each
 * founder's refund rows with the same rules; saving merges the rows a group
 * spans into one (saveNormalizedGroups), keeping every email.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/merge-refund-notices.ts
 *   ...                                                                             --apply
 */

import { createClient } from "@supabase/supabase-js";
import { deduplicateRawTransactions, saveNormalizedGroups, type TransactionRaw } from "@/lib/finance/dedup";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await db.from("transactions_raw").select("*")
    .eq("is_financial_email", true).eq("needs_review", false).eq("event_kind", "completed").eq("transaction_type", "refund");
  if (error) throw new Error(error.message);
  const refunds = (data ?? []) as TransactionRaw[];
  const { data: norms } = await db.from("transactions_normalized").select("id, communication_ids").eq("transaction_type", "refund");
  const rowOf = (commId: string) => (norms ?? []).find((n) => (n.communication_ids ?? []).includes(commId))?.id ?? null;

  for (const userId of new Set(refunds.map((r) => (r as unknown as { user_id: string }).user_id))) {
    const mine = refunds.filter((r) => (r as unknown as { user_id: string }).user_id === userId);
    // Only groups now spanning more than one saved row change anything.
    const merges = deduplicateRawTransactions(mine).filter((g) => new Set(g.communication_ids.map(rowOf)).size > 1);
    console.log(`${userId}: ${mine.length} refund emails, ${merges.length} refunds counted more than once`);
    for (const g of merges) console.log(`  ${g.transaction_datetime.slice(0, 10)} ₹${g.amount} ${g.merchant_normalized}: ${g.communication_ids.length} emails in ${new Set(g.communication_ids.map(rowOf)).size} rows`);
    if (APPLY && merges.length) console.log("  saved:", await saveNormalizedGroups(db, userId, merges));
  }
  if (!APPLY) console.log("\nDry run - nothing written. Re-run with --apply.");
}

main().catch((e) => { console.error(e); process.exit(1); });
