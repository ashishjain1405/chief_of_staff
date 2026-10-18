import { Queue } from "bullmq";
import IORedis from "ioredis";

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    connection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: url.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return connection;
}

const queues: Record<string, Queue> = {};

export function getQueue(name: string): Queue {
  if (!queues[name]) {
    queues[name] = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    });
  }
  return queues[name];
}

function makeQueue(name: string) {
  return {
    add: (jobName: string, data: any, opts?: any) =>
      getQueue(name).add(jobName, data, opts),
  };
}

export const emailRawQueue = makeQueue("email-raw");
export const calendarRawQueue = makeQueue("calendar-raw");
export const slackRawQueue = makeQueue("slack-raw");
export const zoomRawQueue = makeQueue("zoom-raw");
export const summarizeQueue = makeQueue("summarize");
export const embedQueue = makeQueue("embed");
export const reasonQueue = makeQueue("reason");
export const actQueue = makeQueue("act");
export const scheduledQueue = makeQueue("scheduled");
export const operationalQueue = makeQueue("compute-operational-state");

const OPS_DEBOUNCE_MS = 30_000;

// Collapses a burst of processed emails into one recompute. Deliberately no
// fixed jobId: with jobId `ops-<user>`, BullMQ ignored every later add while the
// completed job was still stored, and completed jobs are only pruned when
// another job on the queue completes — so the first job pinned itself forever
// and insights stopped recomputing after 10 Sep. A ttl-bound dedup key expires
// on its own, so a stuck key cannot outlive the window.
export function enqueueOperationalState(userId: string) {
  return operationalQueue.add(
    "compute-operational-state",
    { userId },
    { delay: OPS_DEBOUNCE_MS, deduplication: { id: `ops-${userId}`, ttl: OPS_DEBOUNCE_MS } }
  );
}
