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
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return queues[name];
}

export const emailRawQueue = { add: (...a: any[]) => getQueue("email-raw").add(...a) };
export const calendarRawQueue = { add: (...a: any[]) => getQueue("calendar-raw").add(...a) };
export const slackRawQueue = { add: (...a: any[]) => getQueue("slack-raw").add(...a) };
export const zoomRawQueue = { add: (...a: any[]) => getQueue("zoom-raw").add(...a) };
export const summarizeQueue = { add: (...a: any[]) => getQueue("summarize").add(...a) };
export const embedQueue = { add: (...a: any[]) => getQueue("embed").add(...a) };
export const reasonQueue = { add: (...a: any[]) => getQueue("reason").add(...a) };
export const actQueue = { add: (...a: any[]) => getQueue("act").add(...a) };
export const scheduledQueue = { add: (...a: any[]) => getQueue("scheduled").add(...a) };
