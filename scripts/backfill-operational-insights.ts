/**
 * One-time backfill: enqueue compute-operational-state for all existing users.
 * Run once: npx tsx scripts/backfill-operational-insights.ts
 */
import { createClient } from "@supabase/supabase-js";
import { operationalQueue } from "../lib/queues";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: users, error } = await supabase.from("users").select("id");
  if (error) {
    console.error("Failed to fetch users:", error);
    process.exit(1);
  }

  if (!users?.length) {
    console.log("No users found.");
    process.exit(0);
  }

  console.log(`Enqueueing compute-operational-state for ${users.length} users...`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    // Stagger jobs by 2s each to avoid hammering the DB simultaneously
    await operationalQueue.add("compute-operational-state", { userId: user.id }, { delay: i * 2000 });
    console.log(`  [${i + 1}/${users.length}] Enqueued ${user.id}`);
  }

  console.log("Done. Jobs enqueued — worker will process them shortly.");
  process.exit(0);
}

main();
