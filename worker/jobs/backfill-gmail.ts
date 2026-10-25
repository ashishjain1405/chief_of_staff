/**
 * Queues the Gmail history import (worker/jobs/import-gmail-history) for every
 * connected Google account - the same job that runs when Gmail is connected.
 * Mail already imported is skipped, so a re-run only fills gaps.
 *
 * Usage:
 *   npm run backfill:gmail -- --days=90
 */

import { createClient } from "@supabase/supabase-js";
import { enqueueGmailImport, IMPORT_DAYS } from "@/lib/queues";

const DAYS = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? String(IMPORT_DAYS));

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations } = await supabase
    .from("integrations")
    .select("user_id, external_account_id")
    .eq("provider", "google");

  if (!integrations?.length) {
    console.log("No Google integrations found.");
    process.exit(0);
  }

  for (const integration of integrations) {
    await enqueueGmailImport(integration.user_id, DAYS);
    console.log(`Queued ${DAYS} days for ${integration.external_account_id} (${integration.user_id})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
