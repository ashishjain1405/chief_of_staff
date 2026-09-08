import { Worker } from "bullmq";
import { getRedisConnection, getQueue } from "@/lib/queues";
import { processEmail } from "./jobs/process-email";
import { summarizeCommunication } from "./jobs/summarize-communication";
import { processMeetingSummary } from "./jobs/summarize-meeting";
import { generateAndDeliverDailyBrief } from "./jobs/generate-daily-brief";
import { computeOperationalState } from "./jobs/compute-operational-state";
import { renewGmailWatches } from "./jobs/renew-gmail-watches";
import { reconcileUnprocessedJob } from "./jobs/reconcile-unprocessed";

function makeWorker(queueName: string, handler: (job: any) => Promise<void>) {
  const worker = new Worker(queueName, handler, {
    connection: getRedisConnection(),
    concurrency: 5,
    stalledInterval: 60000,
    lockDuration: 60000,
    lockRenewTime: 30000,
    // Upstash doesn't support blocking commands well, so BullMQ falls back to
    // polling every drainDelay while idle. The 5s default burned through
    // Upstash's monthly command quota (500k) in ~3 days on idle polling alone.
    // 1hr while testing keeps that floor near-zero (~3.6k polls/month across
    // 5 workers) - dial back down before this needs to feel responsive.
    drainDelay: 3600,
  });

  worker.on("failed", (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[${queueName}] Job ${job.id} completed`);
  });

  // Without this, an EventEmitter "error" event with no listener (e.g. a
  // transient Redis error) throws as an uncaught exception and crashes the
  // whole process, taking every other queue's worker down with it.
  worker.on("error", (err) => {
    console.error(`[${queueName}] Worker error:`, err.message);
  });

  return worker;
}

makeWorker("email-raw", processEmail);
makeWorker("summarize", summarizeCommunication);
makeWorker("meetings-summarize", processMeetingSummary);
makeWorker("compute-operational-state", computeOperationalState);
makeWorker("scheduled", async (job) => {
  if (job.name === "generate-daily-brief") {
    await generateAndDeliverDailyBrief(job);
  }
  if (job.name === "renew-gmail-watches") {
    await renewGmailWatches(job);
  }
  if (job.name === "reconcile-unprocessed") {
    await reconcileUnprocessedJob(job);
  }
});

// Register repeating jobs (idempotent — BullMQ deduplicates by repeat key).
// This must not crash the process on failure (e.g. Redis temporarily
// unavailable/over quota) - the workers above are still useful even if this
// one bootstrap call fails, and BullMQ will just re-register it next boot.
const scheduledQueue = getQueue("scheduled");
scheduledQueue
  .add(
    "renew-gmail-watches",
    {},
    { repeat: { pattern: "0 */6 * * *" }, jobId: "renew-gmail-watches" }
  )
  .catch((err) => {
    console.error("Failed to register renew-gmail-watches repeat job:", err.message);
  });

// Offset from the watch renewal above so the two don't fire together.
scheduledQueue
  .add(
    "reconcile-unprocessed",
    {},
    { repeat: { pattern: "30 */6 * * *" }, jobId: "reconcile-unprocessed" }
  )
  .catch((err) => {
    console.error("Failed to register reconcile-unprocessed repeat job:", err.message);
  });

console.log("Worker process started. Listening for jobs...");

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
