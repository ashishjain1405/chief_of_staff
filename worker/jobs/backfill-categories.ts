import { createClient } from "@supabase/supabase-js";
import { triageEmail } from "@/lib/ai/claude";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let offset = 0;
  let processed = 0;
  const BATCH = 50;

  while (true) {
    const { data: rows } = await supabase
      .from("communications")
      .select("id, user_id, subject, body, body_summary, channel_metadata, contacts(name, email)")
      .eq("category_processed", false)
      .not("body_summary", "is", null)
      .order("occurred_at", { ascending: false })
      .range(offset, offset + BATCH - 1);

    if (!rows || rows.length === 0) break;

    for (const comm of rows) {
      try {
        const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${(comm.contacts as any)?.email ?? ""}>`;
        const triage = await triageEmail({}, senderInfo, comm.body_summary ?? comm.body ?? "");

        const isFinancial = triage.email_category === "finance_bills" || triage.email_category === "transactions";
        const existingMeta = (comm.channel_metadata as any) ?? {};
        const financialMeta = isFinancial
          ? { fin_amount: triage.fin_amount, fin_currency: triage.fin_currency, fin_merchant: triage.fin_merchant, fin_sub_category: triage.fin_sub_category }
          : {};

        await supabase
          .from("communications")
          .update({
            email_category: triage.email_category,
            category_processed: true,
            channel_metadata: { ...existingMeta, ...financialMeta },
          })
          .eq("id", comm.id);

        processed++;
        console.log(`[${processed}] ${comm.subject} → ${triage.email_category}`);
        await new Promise((r) => setTimeout(r, 1500));
      } catch (err: any) {
        console.error(`Failed ${comm.id}:`, err.message);
        await supabase
          .from("communications")
          .update({ category_processed: true, email_category: "other" })
          .eq("id", comm.id);
      }
    }

    offset += BATCH;
  }

  console.log(`\nDone. Backfilled ${processed} emails.`);
  process.exit(0);
}

main();
