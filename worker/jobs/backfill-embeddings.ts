import { createClient } from "@supabase/supabase-js";
import { embedAndStoreChunks, updateCommunicationEmbedding } from "@/lib/memory/embed";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let offset = 0;
  let embedded = 0;
  let skipped = 0;
  const BATCH = 50;

  while (true) {
    const { data: rows } = await supabase
      .from("communications")
      .select("id, user_id, subject, body_summary, occurred_at, contacts(email)")
      .not("body_summary", "is", null)
      .order("occurred_at", { ascending: false })
      .range(offset, offset + BATCH - 1);

    if (!rows || rows.length === 0) break;

    for (const comm of rows) {
      // Skip if already has memory chunks
      const { data: existing } = await supabase
        .from("memory_chunks")
        .select("id")
        .eq("user_id", comm.user_id)
        .eq("source_type", "communication")
        .eq("source_id", comm.id)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      try {
        const text = `${comm.subject ?? ""}\n\n${comm.body_summary}`;
        const contactEmail = (comm.contacts as any)?.email ?? "";

        await embedAndStoreChunks({
          userId: comm.user_id,
          sourceType: "communication",
          sourceId: comm.id,
          text,
          metadata: {
            occurred_at: comm.occurred_at,
            contact_email: contactEmail,
          },
        });

        await updateCommunicationEmbedding(comm.id, comm.body_summary!);

        embedded++;
        console.log(`[${embedded} embedded / ${skipped} skipped] ${comm.subject}`);
      } catch (err: any) {
        console.error(`  Failed ${comm.id}:`, err.message);
      }

      await new Promise((r) => setTimeout(r, 1200));
    }

    offset += BATCH;
  }

  console.log(`\nDone. Embedded ${embedded}, skipped ${skipped} (already had chunks).`);
  process.exit(0);
}

main();
