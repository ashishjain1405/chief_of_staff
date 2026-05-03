import { createClient } from "@supabase/supabase-js";
import { getCalendarClient } from "@/lib/integrations/calendar";

const DAYS = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "90");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("user_id, external_account_id")
    .eq("provider", "google")
    .eq("is_active", true);

  if (error) throw error;
  if (!integrations?.length) {
    console.log("No active Google integrations found.");
    process.exit(0);
  }

  for (const { user_id, external_account_id } of integrations) {
    console.log(`\nBackfilling ${DAYS} days of calendar events for ${external_account_id} (${user_id})`);
    try {
      await backfillUser(supabase, user_id, DAYS);
    } catch (err: any) {
      console.error(`  Failed for ${external_account_id}:`, err.message);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

async function backfillUser(supabase: any, userId: string, days: number) {
  const calendar = await getCalendarClient(userId);

  const { data } = await calendar.events.list({
    calendarId: "primary",
    maxResults: 250,
    singleEvents: true,
    orderBy: "startTime",
    timeMin: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const events = data.items ?? [];
  console.log(`  Found ${events.length} events`);

  let imported = 0;
  let skipped = 0;

  for (const event of events) {
    if (!event.id || event.status === "cancelled") { skipped++; continue; }

    const attendees = (event.attendees ?? []).map((a: any) => ({
      email: a.email,
      name: a.displayName,
      response_status: a.responseStatus,
    }));

    const zoomUrl = event.conferenceData?.entryPoints?.find(
      (e: any) => e.entryPointType === "video"
    )?.uri ?? event.location ?? "";

    const { error } = await supabase.from("meetings").upsert(
      {
        user_id: userId,
        source: "google_calendar",
        external_id: event.id,
        title: event.summary,
        description: event.description,
        start_time: event.start?.dateTime ?? event.start?.date,
        end_time: event.end?.dateTime ?? event.end?.date,
        attendees,
        location: event.location,
        meeting_url: zoomUrl,
        status: event.status === "confirmed" ? "scheduled" : event.status,
      },
      { onConflict: "user_id,source,external_id" }
    );

    if (error) {
      console.error(`  Failed to upsert ${event.id}:`, error.message);
    } else {
      imported++;
    }
  }

  console.log(`  Done: ${imported} upserted, ${skipped} skipped`);
}

main();
