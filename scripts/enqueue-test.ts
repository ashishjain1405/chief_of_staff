import { getQueue } from "../lib/queues";

async function main() {
  const rawEventId = process.argv[2];
  if (!rawEventId) {
    console.error("Usage: npx tsx scripts/enqueue-test.ts <raw-event-id>");
    process.exit(1);
  }

  const q = getQueue("email-raw");
  await q.add("process-email", { rawEventId });
  console.log("Enqueued raw event:", rawEventId);
  process.exit(0);
}

main();
