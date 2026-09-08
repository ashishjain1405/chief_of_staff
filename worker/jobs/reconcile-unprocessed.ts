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

  // PostgREST caps a single response at 1000 rows, so a larger limit has to be
  // paged. Paging by occurred_at cursor rather than offset because rows drop out
  // of the filter as the worker processes them, which would shift offsets. Ties
  // on occurred_at can skip or repeat a row at a page boundary; a repeat is a
  // cheap no-op and a skip gets picked up by the next scheduled run.
  const PAGE_SIZE = 1000;
  let cursor: string | null = null;
  let queued = 0;

  while (queued < limit) {
    let page = supabase
      .from("communications")
      .select("id, user_id, occurred_at")
      .in("user_id", activeUserIds)
      .or("body_summary.is.null,embedding.is.null")
      .order("occurred_at", { ascending: false })
      .limit(Math.min(PAGE_SIZE, limit - queued));

    if (cursor) page = page.lt("occurred_at", cursor);

    const { data, error } = await page;
    if (error) throw error;
    if (!data?.length) break;

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

    cursor = data[data.length - 1].occurred_at;
  }

  if (queued === 0) {
    console.log("[reconcile] Nothing to reconcile.");
    return 0;
  }

  console.log(`[reconcile] Queued ${queued} communications (newest first).`);
  return queued;
}

export async function reconcileUnprocessedJob(job: Job) {
  await reconcileUnprocessed(job.data?.limit ?? DEFAULT_BATCH);
}
