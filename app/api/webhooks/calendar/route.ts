import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncCalendarEvents } from "@/lib/integrations/calendar";

export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const resourceState = request.headers.get("x-goog-resource-state");

  if (resourceState === "sync") return NextResponse.json({ ok: true });

  // Extract userId from channelId format: cal-{userId}-{timestamp}
  const match = channelId.match(/^cal-([a-f0-9-]+)-\d+$/);
  if (!match) return NextResponse.json({ ok: true });

  const userId = match[1];
  const supabase = await createServiceClient();

  try {
    const events = await syncCalendarEvents(userId);

    for (const event of events) {
      if (!event.id) continue;

      if (event.status === "cancelled") {
        await supabase
          .from("meetings")
          .update({ status: "cancelled" })
          .eq("user_id", userId)
          .eq("source", "google_calendar")
          .eq("external_id", event.id);
        continue;
      }

      const attendees = (event.attendees ?? []).map((a: any) => ({
        email: a.email,
        name: a.displayName,
        response_status: a.responseStatus,
      }));

      const zoomUrl = event.conferenceData?.entryPoints?.find(
        (e: any) => e.entryPointType === "video"
      )?.uri ?? event.location ?? "";

      await supabase.from("meetings").upsert(
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
    }
  } catch (err: any) {
    console.error("Calendar sync error:", err.message);
  }

  return NextResponse.json({ ok: true });
}
