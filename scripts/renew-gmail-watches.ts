import { createClient } from "@supabase/supabase-js";
import { watchGmailInbox } from "@/lib/integrations/gmail";
import { watchCalendar } from "@/lib/integrations/calendar";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("user_id, external_account_id, metadata")
    .eq("provider", "google")
    .eq("is_active", true);

  if (error) throw error;
  if (!integrations?.length) {
    console.log("No active Google integrations found.");
    process.exit(0);
  }

  for (const { user_id, external_account_id, metadata } of integrations) {
    const [gmailResult, calendarResult] = await Promise.allSettled([
      watchGmailInbox(user_id),
      watchCalendar(user_id),
    ]);

    const gmailMeta = gmailResult.status === "fulfilled"
      ? { last_history_id: gmailResult.value.historyId, watch_expires_at: new Date(Number(gmailResult.value.expiration)).toISOString() }
      : {};
    const calendarMeta = calendarResult.status === "fulfilled"
      ? { calendar_resource_id: calendarResult.value.resourceId, calendar_watch_expires_at: new Date(Number(calendarResult.value.expiration)).toISOString() }
      : {};

    if (gmailResult.status === "rejected") console.error(`✗ ${external_account_id} gmail:`, (gmailResult.reason as any).message);
    if (calendarResult.status === "rejected") console.error(`✗ ${external_account_id} calendar:`, (calendarResult.reason as any).message);

    await supabase
      .from("integrations")
      .update({ metadata: { ...metadata, ...gmailMeta, ...calendarMeta } })
      .eq("user_id", user_id)
      .eq("provider", "google");

    console.log(`✓ ${external_account_id} — renewed gmail=${gmailResult.status} calendar=${calendarResult.status}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main();
