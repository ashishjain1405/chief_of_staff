import { createClient } from "@supabase/supabase-js";
import { fetchEmailById, parseEmailHtml } from "@/lib/integrations/gmail";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "google");

  if (!integrations?.length) {
    console.log("No Google integrations found.");
    process.exit(0);
  }

  for (const integration of integrations) {
    const userId = integration.user_id;
    let offset = 0;
    let updated = 0;
    let skipped = 0;
    const BATCH = 50;

    console.log(`\nBackfilling HTML for user ${userId}`);

    while (true) {
      const { data: rows } = await supabase
        .from("communications")
        .select("id, external_id")
        .eq("user_id", userId)
        .eq("source", "gmail")
        .is("body_html", null)
        .not("external_id", "is", null)
        .range(offset, offset + BATCH - 1);

      if (!rows || rows.length === 0) break;

      for (const row of rows) {
        try {
          const message = await fetchEmailById(userId, row.external_id!);
          const bodyHtml = parseEmailHtml(message.payload);

          await supabase
            .from("communications")
            .update({ body_html: bodyHtml.substring(0, 500000) || null })
            .eq("id", row.id);

          updated++;
          console.log(`[${updated} updated / ${skipped} skipped] ${row.external_id}`);
        } catch (err: any) {
          console.error(`  Failed ${row.id}:`, err.message);
          skipped++;
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      offset += BATCH;
    }

    console.log(`\nUser done: ${updated} updated, ${skipped} failed.`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main();
