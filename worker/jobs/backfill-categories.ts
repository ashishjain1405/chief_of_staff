import { createClient } from "@supabase/supabase-js";
import { triageEmail } from "@/lib/ai/claude";
import { getSenderHint } from "@/lib/finance/senders";

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
        const senderEmail = (comm.contacts as any)?.email ?? "";
        const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${senderEmail}>${getSenderHint(senderEmail)}`;
        const triage = await triageEmail({}, senderInfo, comm.body_summary ?? comm.body ?? "");

        await supabase
          .from("communications")
          .update({
            email_category: triage.email_category,
            category_processed: true,
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
