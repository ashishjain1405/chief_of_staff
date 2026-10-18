// Manual trigger for the 6-hourly renewal; runs the worker's own job so the two
// cannot drift (this file was a copy that kept the old channel-leaking logic).
import type { Job } from "bullmq";
import { renewGmailWatches } from "../worker/jobs/renew-gmail-watches";

renewGmailWatches({} as Job)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
