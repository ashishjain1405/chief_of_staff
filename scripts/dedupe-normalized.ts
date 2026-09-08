import { createClient } from "@supabase/supabase-js";

// Collapses duplicate transactions_normalized rows. Groups strictly by identical
// communication_ids - two rows built from the same source email(s) are duplicates
// by definition, whereas grouping on merchant/amount/datetime could merge two
// genuinely distinct payments that happen to match.
//
// Dry run by default. Pass --apply to delete.
//
//   npm run dedupe:normalized                # report only
//   npm run dedupe:normalized -- --apply     # delete redundant rows

const APPLY = process.argv.includes("--apply");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from("transactions_normalized")
    .select("id, user_id, merchant_normalized, amount, transaction_datetime, communication_ids, created_at")
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!data?.length) {
    console.log("No normalized transactions found.");
    return;
  }

  const groups = new Map<string, typeof data>();
  for (const row of data) {
    const ids = [...(row.communication_ids ?? [])].sort();
    if (ids.length === 0) continue; // nothing to key on; leave alone
    const key = `${row.user_id}|${ids.join(",")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  const toDelete = dupGroups.flatMap((g) => g.slice(1)); // keep earliest created_at

  console.log(`Scanned ${data.length} rows across ${groups.size} distinct source groups.`);
  console.log(`Duplicate groups: ${dupGroups.length}`);
  console.log(`Redundant rows: ${toDelete.length}\n`);

  for (const g of dupGroups) {
    const keep = g[0];
    console.log(
      `  ${keep.merchant_normalized ?? "(no merchant)"} ${keep.amount} @ ${keep.transaction_datetime}` +
        ` - keeping ${keep.id.slice(0, 8)} (created ${keep.created_at}), deleting ${g.length - 1}`
    );
  }

  if (!APPLY) {
    console.log("\nDry run - nothing deleted. Re-run with --apply to delete.");
    return;
  }

  console.log("\nDeleting...");
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100).map((r) => r.id);
    const { error: delErr } = await supabase
      .from("transactions_normalized")
      .delete()
      .in("id", batch);
    if (delErr) {
      console.error(`  batch failed: ${delErr.message}`);
      continue;
    }
    deleted += batch.length;
    console.log(`  deleted ${deleted}/${toDelete.length}`);
  }
  console.log(`\nDone. Deleted ${deleted} redundant rows.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
