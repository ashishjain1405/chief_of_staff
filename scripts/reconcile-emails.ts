import { reconcileUnprocessed } from "@/worker/jobs/reconcile-unprocessed";

const LIMIT = parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "500"
);

async function main() {
  console.log(`Reconciling up to ${LIMIT} unprocessed communications...\n`);
  const queued = await reconcileUnprocessed(LIMIT);
  console.log(`\nDone. Queued ${queued}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
