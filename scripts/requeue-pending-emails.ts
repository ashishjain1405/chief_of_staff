import { createClient } from "@supabase/supabase-js";
import { emailRawQueue } from "@/lib/queues";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: pending, error } = await supabase
    .from("raw_events")
    .select("id, external_id")
    .eq("source", "gmail")
    .eq("processed", false);

  if (error) throw error;
  if (!pending?.length) {
    console.log("No pending raw_events found.");
    process.exit(0);
  }

  console.log(`Re-enqueueing ${pending.length} unprocessed emails...`);

  for (const event of pending) {
    await emailRawQueue.add("process-email", { rawEventId: event.id });
    console.log(`  Queued ${event.id} (${event.external_id})`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main();
