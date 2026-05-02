/**
 * One-time backfill: runs compute-operational-state directly for all existing users.
 * Does NOT use Redis/BullMQ — calls the worker function inline to avoid Upstash limits.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-operational-insights.ts
 */
import { createClient } from "@supabase/supabase-js";
import { computeOperationalState } from "../worker/jobs/compute-operational-state";
import type { Job } from "bullmq";

function makeJob(userId: string): Job {
  return { data: { userId } } as unknown as Job;
}

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

  console.log(`Running backfill for ${users.length} user(s)...`);

  for (let i = 0; i < users.length; i++) {
    const { id: userId } = users[i];
    console.log(`\n[${i + 1}/${users.length}] Processing user ${userId}...`);
    try {
      await computeOperationalState(makeJob(userId));
      console.log(`  ✓ Done`);
    } catch (err) {
      console.error(`  ✗ Failed:`, err);
    }
  }

  console.log("\nBackfill complete.");
  process.exit(0);
}

main();
