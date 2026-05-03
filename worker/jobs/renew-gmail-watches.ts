import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { watchGmailInbox } from "@/lib/integrations/gmail";
import { watchCalendar } from "@/lib/integrations/calendar";

export async function renewGmailWatches(_job: Job) {
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
  if (!integrations?.length) return;

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

    if (gmailResult.status === "rejected") console.error(`[renew-watches] ✗ ${external_account_id} gmail:`, (gmailResult.reason as any).message);
    if (calendarResult.status === "rejected") console.error(`[renew-watches] ✗ ${external_account_id} calendar:`, (calendarResult.reason as any).message);

    await supabase
      .from("integrations")
      .update({ metadata: { ...metadata, ...gmailMeta, ...calendarMeta } })
      .eq("user_id", user_id)
      .eq("provider", "google");

    console.log(`[renew-watches] ✓ ${external_account_id} gmail=${gmailResult.status} calendar=${calendarResult.status}`);
  }
}
