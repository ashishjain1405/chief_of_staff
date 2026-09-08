import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { summarizeQueue } from "@/lib/queues";

const DEFAULT_BATCH = 500;

// Re-enqueues summarize jobs for communications that were imported but never
// processed. Imports write the row to Supabase first and enqueue afterwards, so
// if the enqueue fails (Redis down/over quota) the row is committed with nothing
// recording that it still needs work - `communications` has no processed flag
// like `raw_events` does. Without this pass those rows are orphaned forever.
export async function reconcileUnprocessed(limit = DEFAULT_BATCH): Promise<number> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Eval fixtures deliberately leave some embeddings null (see
  // evals/scripts/seed.ts, case S4), so reconciling them would silently break
  // eval expectations. Skip the seeded test users entirely.
  const { data: testUsers } = await supabase
    .from("users")
    .select("id")
    .like("email", "%@test.local");
  const excludedIds = (testUsers ?? []).map((u) => u.id);

  let query = supabase
    .from("communications")
    .select("id, user_id")
    .or("body_summary.is.null,embedding.is.null")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (excludedIds.length > 0) {
    query = query.not("user_id", "in", `(${excludedIds.join(",")})`);
  }

  const { data, error } = await query;

  if (error) throw error;
  if (!data?.length) {
    console.log("[reconcile] Nothing to reconcile.");
    return 0;
  }

  let queued = 0;
  for (const row of data) {
    try {
      await summarizeQueue.add(
        "summarize",
        { communicationId: row.id, userId: row.user_id },
        { jobId: `resummarize-${row.id}` }
      );
      queued++;
    } catch (err: any) {
      console.error(`[reconcile] Failed to queue ${row.id}:`, err.message);
    }
  }

  console.log(`[reconcile] Queued ${queued}/${data.length} communications (newest first).`);
  return queued;
}

export async function reconcileUnprocessedJob(job: Job) {
  await reconcileUnprocessed(job.data?.limit ?? DEFAULT_BATCH);
}
