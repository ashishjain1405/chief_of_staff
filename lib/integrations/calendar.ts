import { google } from "googleapis";
import { appUrl } from "@/lib/utils";
import { createHmac, timingSafeEqual } from "crypto";
import { getAuthenticatedClient } from "./google";
import { createServiceClient } from "@/lib/supabase/server";

// Google echoes a channel's token on every notification as X-Goog-Channel-Token.
// Without one, the webhook trusted the user id in the channel id, so anyone with
// a user's UUID could force syncs. Derived rather than stored, so the web and
// worker processes agree on it with no extra state.
export function calendarChannelToken(userId: string): string {
  return createHmac("sha256", process.env.ENCRYPTION_KEY!).update(`calendar-channel:${userId}`).digest("hex");
}

export function isValidCalendarChannelToken(userId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(calendarChannelToken(userId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function getCalendarClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.calendar({ version: "v3", auth });
}

export async function watchCalendar(userId: string): Promise<{ channelId: string; resourceId: string; expiration: string }> {
  const calendar = await getCalendarClient(userId);
  const channelId = `cal-${userId}-${Date.now()}`;
  const { data } = await calendar.events.watch({
    calendarId: "primary",
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: appUrl("/api/webhooks/calendar"),
      token: calendarChannelToken(userId),
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60000), // 7 days - 1 min
    },
  });
  return { channelId, resourceId: data.resourceId!, expiration: data.expiration! };
}

export async function stopCalendarWatch(userId: string, channelId: string, resourceId: string) {
  const calendar = await getCalendarClient(userId);
  await calendar.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

// Registers a new push channel, then stops the one it replaces. Renewal runs
// every 6 hours and never stopped the old channel, so live channels piled up
// and each calendar change was delivered - and synced - several times over.
// Returns the metadata fields to merge.
export async function renewCalendarWatch(userId: string, previous: Record<string, any> | null) {
  const next = await watchCalendar(userId);
  if (previous?.calendar_channel_id && previous?.calendar_resource_id) {
    // Best effort: an already-expired channel 404s, which is fine.
    await stopCalendarWatch(userId, previous.calendar_channel_id, previous.calendar_resource_id).catch(() => {});
  }
  return {
    calendar_channel_id: next.channelId,
    calendar_resource_id: next.resourceId,
    calendar_watch_expires_at: new Date(Number(next.expiration)).toISOString(),
  };
}

const INITIAL_WINDOW = { pastDays: 30, futureDays: 90 };

export async function syncCalendarEvents(userId: string) {
  const supabase = await createServiceClient();
  const { data: integration } = await supabase
    .from("integrations")
    .select("metadata")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();

  const calendar = await getCalendarClient(userId);
  const storedToken: string | undefined = integration?.metadata?.calendar_sync_token;

  let result: { events: any[]; nextSyncToken: string | null | undefined };
  try {
    result = await listAllEvents(calendar, storedToken);
  } catch (err: any) {
    // 410 Gone: Google expired the sync token. Without this the error repeated
    // on every notification and calendar sync stopped for good. A full sync
    // from scratch is the documented recovery.
    if (!storedToken || (err?.code ?? err?.response?.status) !== 410) throw err;
    console.warn(`[calendar] ${userId}: sync token expired (410) - running a full sync`);
    result = await listAllEvents(calendar, undefined);
  }

  // Merged into the latest metadata, not the copy read above: renewal or the
  // Gmail webhook may have written in between.
  if (result.nextSyncToken) {
    const { data: latest } = await supabase
      .from("integrations")
      .select("metadata")
      .eq("user_id", userId)
      .eq("provider", "google")
      .single();
    await supabase
      .from("integrations")
      .update({ metadata: { ...latest?.metadata, calendar_sync_token: result.nextSyncToken } })
      .eq("user_id", userId)
      .eq("provider", "google");
  }

  return result.events;
}

// Pages until Google returns nextSyncToken. Reading one page of 50 and keeping
// its token meant anything past the first page was skipped for good, since
// the next incremental sync starts after that token.
async function listAllEvents(calendar: any, syncToken: string | undefined) {
  const events: any[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null | undefined;
  do {
    const params: any = { calendarId: "primary", maxResults: 250, singleEvents: true, pageToken };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      params.timeMin = new Date(Date.now() - INITIAL_WINDOW.pastDays * 864e5).toISOString();
      params.timeMax = new Date(Date.now() + INITIAL_WINDOW.futureDays * 864e5).toISOString();
    }
    const { data } = await calendar.events.list(params);
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
    nextSyncToken = data.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken };
}
