import { Worker } from "bullmq";
import { getRedisConnection, getQueue } from "@/lib/queues";
import { processEmail } from "./jobs/process-email";
import { summarizeCommunication } from "./jobs/summarize-communication";
import { processMeetingSummary } from "./jobs/summarize-meeting";
import { generateAndDeliverDailyBrief } from "./jobs/generate-daily-brief";

function makeWorker(queueName: string, handler: (job: any) => Promise<void>) {
  const worker = new Worker(queueName, handler, {
    connection: getRedisConnection(),
    concurrency: 5,
  });

  worker.on("failed", (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[${queueName}] Job ${job.id} completed`);
  });

  return worker;
}

makeWorker("email-raw", processEmail);
makeWorker("summarize", summarizeCommunication);
makeWorker("meetings-summarize", processMeetingSummary);
makeWorker("scheduled", async (job) => {
  if (job.name === "generate-daily-brief") {
    await generateAndDeliverDailyBrief(job);
  }
});

console.log("Worker process started. Listening for jobs...");

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
