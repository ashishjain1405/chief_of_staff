import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { createServiceClient } from "@/lib/supabase/server";

export async function getCalendarClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.calendar({ version: "v3", auth });
}

export async function watchCalendar(userId: string): Promise<{ resourceId: string; expiration: string }> {
  const calendar = await getCalendarClient(userId);
  const channelId = `cal-${userId}-${Date.now()}`;
  const { data } = await calendar.events.watch({
    calendarId: "primary",
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/calendar`,
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60000), // 7 days - 1 min
    },
  });
  return { resourceId: data.resourceId!, expiration: data.expiration! };
}

export async function stopCalendarWatch(userId: string, channelId: string, resourceId: string) {
  const calendar = await getCalendarClient(userId);
  await calendar.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

export async function syncCalendarEvents(userId: string) {
  const supabase = await createServiceClient();
  const { data: integration } = await supabase
    .from("integrations")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();

  const calendar = await getCalendarClient(userId);
  const syncToken: string | undefined = integration?.metadata?.calendar_sync_token;

  const params: any = {
    calendarId: "primary",
    maxResults: 50,
    singleEvents: true,
  };
  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    // Initial sync: last 30 days + next 90 days
    params.timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    params.timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  }

  const { data } = await calendar.events.list(params);
  const events = data.items ?? [];
  const newSyncToken = data.nextSyncToken;

  // Save new sync token
  if (newSyncToken) {
    await supabase
      .from("integrations")
      .update({ metadata: { ...integration?.metadata, calendar_sync_token: newSyncToken } })
      .eq("user_id", userId)
      .eq("provider", "google");
  }

  return events;
}
