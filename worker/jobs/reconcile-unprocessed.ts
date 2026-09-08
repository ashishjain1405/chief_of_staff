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

  // Only reconcile accounts whose Gmail watch is still live. A lapsed watch
  // means the account isn't syncing (disconnected or dormant), so processing its
  // backlog spends LLM budget on data that won't be kept current anyway.
  // Reconnecting an account renews its watch, which brings it back into scope
  // automatically. This also excludes eval fixture users - they have no Google
  // integration, and evals/scripts/seed.ts nulls some embeddings deliberately
  // (case S4), so reconciling them would break eval expectations.
  const { data: liveIntegrations } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "google")
    .eq("is_active", true)
    .gt("metadata->>watch_expires_at", new Date().toISOString());

  const activeUserIds = (liveIntegrations ?? []).map((i) => i.user_id);
  if (activeUserIds.length === 0) {
    console.log("[reconcile] No accounts with a live Gmail watch - nothing to do.");
    return 0;
  }

  const { data, error } = await supabase
    .from("communications")
    .select("id, user_id")
    .in("user_id", activeUserIds)
    .or("body_summary.is.null,embedding.is.null")
    .order("occurred_at", { ascending: false })
    .limit(limit);

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
