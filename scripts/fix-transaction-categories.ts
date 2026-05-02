/**
 * One-time migration: re-categorize transactions where merchant is known
 * but category is null or mismatched against MERCHANT_DATA.
 *
 * Run: npx tsx --env-file=.env.local scripts/fix-transaction-categories.ts
 */
import { createClient } from "@supabase/supabase-js";
import { MERCHANT_DATA } from "../lib/finance/normalize";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Build alias → { canonical, category } lookup (same as normalize.ts)
  const aliasMap: Record<string, { canonical: string; category: string }> = {};
  for (const [canonical, data] of Object.entries(MERCHANT_DATA)) {
    for (const alias of data.aliases) {
      aliasMap[alias.toUpperCase()] = { canonical, category: data.category };
    }
    // Also index the canonical name itself
    aliasMap[canonical.toUpperCase()] = { canonical, category: data.category };
  }

  // Fetch all transactions that have a merchant_normalized value
  const { data: rows, error } = await supabase
    .from("transactions_normalized")
    .select("id, merchant_normalized, category")
    .not("merchant_normalized", "is", null);

  if (error) {
    console.error("Failed to fetch transactions:", error);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("No transactions found.");
    process.exit(0);
  }

  console.log(`Checking ${rows.length} transactions...`);

  const updates: { id: string; category: string; merchant: string }[] = [];

  for (const row of rows) {
    const upper = (row.merchant_normalized as string).toUpperCase().trim();
    const match = aliasMap[upper]
      ?? Object.entries(aliasMap).find(([alias]) => upper.startsWith(alias))?.[1];

    if (!match) continue;

    // Only update if category is null or different from MERCHANT_DATA value
    if (row.category !== match.category) {
      updates.push({ id: row.id, category: match.category, merchant: row.merchant_normalized });
    }
  }

  if (updates.length === 0) {
    console.log("All transaction categories are already correct.");
    process.exit(0);
  }

  console.log(`\nFound ${updates.length} transactions to update:`);
  const byCategory: Record<string, number> = {};
  for (const u of updates) {
    byCategory[u.category] = (byCategory[u.category] ?? 0) + 1;
  }
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Batch update in chunks of 100
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    for (const u of chunk) {
      const { error: updateError } = await supabase
        .from("transactions_normalized")
        .update({ category: u.category })
        .eq("id", u.id);
      if (updateError) {
        console.error(`  Failed to update ${u.id} (${u.merchant}):`, updateError.message);
      } else {
        updated++;
      }
    }
    console.log(`  Progress: ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
  }

  console.log(`\nDone. Updated ${updated}/${updates.length} transactions.`);
  process.exit(0);
}

main();
