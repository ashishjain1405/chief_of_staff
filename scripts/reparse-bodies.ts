import { createClient } from "@supabase/supabase-js";
import {
  fetchEmailById,
  parseEmailBody,
  parseEmailHtml,
} from "@/lib/integrations/gmail";
import { summarizeQueue } from "@/lib/queues";

// Re-fetches emails whose stored body was mangled by the old parser (stylesheet
// text leaking through tag stripping), re-parses with the current parser, then
// clears body_summary/embedding and re-enqueues so triage, extraction and
// embeddings all run again against clean input.
//
//   npm run reparse:bodies                       # dry run, reports scope
//   npm run reparse:bodies -- --apply --limit=50
//
// Scoped to accounts with a live Gmail watch, matching the reconcile job: a
// lapsed watch means the payloads can't be fetched anyway.

const CSS = /@media|font-family|!important|-webkit-|text-size-adjust/i;
const FETCH_DELAY_MS = 120; // ~8/s, well inside Gmail's quota

const APPLY = process.argv.includes("--apply");
const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "50",
  10
);

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integ } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "google")
    .eq("is_active", true)
    .gt("metadata->>watch_expires_at", new Date().toISOString());

  const userIds = (integ ?? []).map((i) => i.user_id);
  if (userIds.length === 0) {
    console.log("No account with a live Gmail watch - nothing to do.");
    return;
  }

  // Can't filter on a regex server-side, so page through and test locally.
  const affected: { id: string; external_id: string; user_id: string }[] = [];
  let cursor: string | null = null;

  while (affected.length < LIMIT) {
    let q = supabase
      .from("communications")
      .select("id, external_id, user_id, body, occurred_at")
      .in("user_id", userIds)
      .eq("source", "gmail")
      .not("external_id", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(1000);

    if (cursor) q = q.lt("occurred_at", cursor);

    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      if (affected.length >= LIMIT) break;
      if (row.body && CSS.test(row.body.slice(0, 300))) {
        affected.push({ id: row.id, external_id: row.external_id!, user_id: row.user_id });
      }
    }
    cursor = data[data.length - 1].occurred_at;
  }

  console.log(
    `${affected.length} email(s) queued for reparse${APPLY ? "" : "  (dry run - pass --apply)"}\n`
  );
  if (!APPLY || affected.length === 0) {
    if (!APPLY) console.log("Nothing changed.");
    return;
  }

  let reparsed = 0;
  let improved = 0;
  let failed = 0;
  let queued = 0;
  let deferred = 0;
  let redisUsable = true;
  let redisFailures = 0;

  for (const row of affected) {
    try {
      const msg = await fetchEmailById(row.user_id, row.external_id);
      const body = parseEmailBody(msg.payload);
      const bodyHtml = parseEmailHtml(msg.payload);

      if (!body || body.trim().length === 0) {
        console.log(`  skip ${row.external_id}: reparse produced nothing`);
        continue;
      }
      if (!CSS.test(body.slice(0, 300))) improved++;

      const { error: updErr } = await supabase
        .from("communications")
        .update({
          body: body.substring(0, 10000),
          body_html: bodyHtml.substring(0, 500000) || null,
          // Cleared so summarizeCommunication runs the full path again rather
          // than short-circuiting on an existing summary.
          body_summary: null,
          embedding: null,
        })
        .eq("id", row.id);

      if (updErr) {
        failed++;
        console.error(`  fail ${row.external_id}: ${updErr.message}`);
        continue;
      }

      // Best-effort: clearing body_summary above is what actually matters,
      // because the 6-hourly reconcile job finds rows missing a summary and
      // queues them from Railway. Enqueuing here only makes it immediate, and
      // Redis isn't always reachable from a laptop (port 6379 egress), where a
      // maxRetriesPerRequest: null connection would otherwise hang forever.
      if (redisUsable) {
        try {
          await Promise.race([
            summarizeQueue.add(
              "summarize",
              { communicationId: row.id, userId: row.user_id },
              { jobId: `reparse-${row.id}` }
            ),
            new Promise((_, rej) => setTimeout(() => rej(new Error("redis timeout")), 5000)),
          ]);
          queued++;
          redisFailures = 0;
        } catch {
          deferred++;
          // Stop paying the timeout on every remaining row once it's clear
          // Redis isn't reachable - otherwise 2,500 rows cost 3.5h of waiting.
          if (++redisFailures >= 3) {
            redisUsable = false;
            console.log("  Redis unreachable - deferring the rest to the reconcile job");
          }
        }
      } else {
        deferred++;
      }

      reparsed++;
      if (reparsed % 25 === 0) {
        console.log(`  ${reparsed}/${affected.length} reparsed (queued=${queued}, deferred=${deferred})`);
      }
    } catch (e: any) {
      failed++;
      console.error(`  fail ${row.external_id}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
  }

  console.log(
    `\nDone. reparsed=${reparsed}, now clean=${improved}, failed=${failed}`
  );
  console.log(`Queued immediately: ${queued} | left for the reconcile job: ${deferred}`);
  console.log("Triage, extraction and embeddings re-run for each as they are picked up.");
  // Explicit exit: the BullMQ/ioredis connection keeps the event loop alive,
  // which previously left the process hanging with stdout unflushed.
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
