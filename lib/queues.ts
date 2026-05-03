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
