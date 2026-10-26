/**
 * Fills order_total (migrations/add-order-total.sql) for orders paid partly
 * from a balance, read before extraction asked for it. Only what the email
 * states, in the two formats found:
 *
 *  - Myntra: "Myntra Credit - ₹3805.11 ... Net Paid ₹310.89", with the row's
 *    amount the net paid: the order was ₹4,116.
 *  - Zomato: "Zomato Money ₹829" on a ₹1,018.60 bill, when a card charge for
 *    the other ₹189.60 is on record within three hours: the bill's amount
 *    becomes the ₹189.60 charged, so it joins that charge, and its total stays.
 *
 * Amazon's "Amazon Pay balance" on a receipt is what is left, not what was
 * used (₹8,964 on a ₹132 order), so it is not read.
 *
 * Usage (after the migration):
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-order-totals.ts
 *   ...                                                                             --apply
 */

import { createClient } from "@supabase/supabase-js";
import { deduplicateRawTransactions, saveNormalizedGroups, type TransactionRaw } from "@/lib/finance/dedup";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : NaN);
const HOURS_3 = 3 * 60 * 60 * 1000;

type Raw = TransactionRaw & { user_id: string; communication_id: string };
type Change = { raw: Raw; amount: number; orderTotal: number; why: string };

async function main() {
  const raws: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions_raw").select("*").eq("event_kind", "completed").neq("transaction_type", "refund").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    raws.push(...((data ?? []) as Raw[]));
    if (!data || data.length < 1000) break;
  }

  const changes: Change[] = [];
  for (let i = 0; i < raws.length; i += 100) {
    const chunk = raws.slice(i, i + 100);
    const { data } = await db.from("communications").select("id, body").in("id", chunk.map((r) => r.communication_id));
    for (const c of data ?? []) {
      const raw = chunk.find((r) => r.communication_id === c.id)!;
      const text = (c.body ?? "").replace(/\s+/g, " ");
      const amount = Number(raw.amount ?? 0);
      const credit = num(/Myntra Credit\s*-\s*₹\s?([\d,]+(?:\.\d+)?)/i.exec(text)?.[1]);
      const net = num(/Net Paid\s*₹\s?([\d,]+(?:\.\d+)?)/i.exec(text)?.[1]);
      if (credit > 0 && net > 0 && Math.abs(net - amount) <= 0.5) {
        changes.push({ raw, amount, orderTotal: Math.round((amount + credit) * 100) / 100, why: `Myntra Credit ₹${credit}` });
        continue;
      }
      const money = num(/Zomato Money\s*₹\s?([\d,]+(?:\.\d+)?)/i.exec(text)?.[1]);
      if (money > 0 && money < amount - 0.5) {
        const rest = Math.round((amount - money) * 100) / 100;
        const at = Date.parse(raw.transaction_datetime ?? "");
        const charge = raws.find((o) => o.user_id === raw.user_id && o.id !== raw.id && Math.abs(Number(o.amount) - rest) <= 0.5 && Math.abs(Date.parse(o.transaction_datetime ?? "") - at) <= HOURS_3);
        if (charge) changes.push({ raw, amount: rest, orderTotal: amount, why: `Zomato Money ₹${money}, card ₹${rest}` });
      }
    }
  }

  console.log(`${changes.length} orders paid partly from a balance:`);
  for (const c of changes) console.log(`  ${c.raw.transaction_datetime?.slice(0, 10)} ${c.raw.merchant_normalized}: charged ₹${c.amount}, order ₹${c.orderTotal} (${c.why})`);
  if (!APPLY) return console.log("\nDry run - nothing written. Run the migration, then re-run with --apply.");

  for (const c of changes) {
    const { error } = await db.from("transactions_raw").update({ amount: c.amount, order_total: c.orderTotal }).eq("id", c.raw.id);
    if (error) throw new Error(error.message);
  }
  // Regroup around each order, so the saved row takes the total and a receipt
  // now matching its card charge joins it.
  for (const c of changes) {
    const at = Date.parse(c.raw.transaction_datetime ?? "");
    const { data } = await db.from("transactions_raw").select("*").eq("user_id", c.raw.user_id).eq("is_financial_email", true).eq("needs_review", false).eq("event_kind", "completed")
      .gte("transaction_datetime", new Date(at - HOURS_3).toISOString()).lte("transaction_datetime", new Date(at + HOURS_3).toISOString());
    const groups = deduplicateRawTransactions((data ?? []) as TransactionRaw[]).filter((g) => g.communication_ids.includes(c.raw.communication_id));
    console.log(`  ${c.raw.merchant_normalized}:`, await saveNormalizedGroups(db, c.raw.user_id, groups));
  }
  console.log("\nApplied.");
}

main().catch((e) => { console.error(e); process.exit(1); });
