import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { getGmailClient } from "@/lib/integrations/gmail";
import { getQueue, IMPORT_PRIORITY } from "@/lib/queues";

// Gmail's IDs are 16 characters; 100 per page keeps the "already imported"
// lookup's URL short.
const PAGE = 100;

// Reads the mail from before Gmail was connected - `after` is 90 days before
// that moment - so Finance, Tasks and Ask AI are not empty on day one. Each
// message takes the webhook's path (raw_events -> process-email -> summarize)
// at low priority, marked as imported so old asks do not become tasks
// (lib/tasks/deadline stillActionable).
//
// Sent mail and drafts are left out, as the webhook does; archived mail is kept,
// since bank alerts are often filtered past the inbox.
export async function importGmailHistory(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { userId, after } = job.data as { userId: string; after: number };
  const gmail = await getGmailClient(userId);

  let pageToken: string | undefined;
  let seen = 0;
  let queued = 0;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: `after:${after} -in:sent -in:drafts -in:spam -in:trash -in:chats`,
      maxResults: PAGE,
      pageToken,
    });
    pageToken = data.nextPageToken ?? undefined;
    const ids = (data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
    seen += ids.length;
    if (!ids.length) continue;

    // Mail pushed since connecting, or read by an earlier import, is skipped.
    const { data: known, error: knownError } = await supabase
      .from("communications")
      .select("external_id")
      .eq("user_id", userId)
      .eq("source", "gmail")
      .in("external_id", ids);
    if (knownError) throw new Error(`communications: ${knownError.message}`);
    const have = new Set((known ?? []).map((r) => r.external_id));
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) continue;

    const { error } = await supabase.from("raw_events").upsert(
      missing.map((id) => ({
        user_id: userId,
        source: "gmail",
        event_type: "email.imported",
        external_id: id,
        raw_payload: { messageId: id },
      })),
      { onConflict: "user_id,source,external_id", ignoreDuplicates: true }
    );
    if (error) throw new Error(`raw_events: ${error.message}`);
    // Marked processed with no communication behind it: that run failed
    // silently, so read it again.
    await supabase.from("raw_events").update({ processed: false })
      .eq("user_id", userId).eq("source", "gmail").eq("processed", true).in("external_id", missing);

    const { data: events, error: eventsError } = await supabase
      .from("raw_events")
      .select("id")
      .eq("user_id", userId)
      .eq("source", "gmail")
      .eq("processed", false)
      .in("external_id", missing);
    if (eventsError) throw new Error(`raw_events: ${eventsError.message}`);

    await getQueue("email-raw").addBulk(
      (events ?? []).map((e) => ({
        name: "process-email",
        data: { rawEventId: e.id, imported: true },
        opts: { priority: IMPORT_PRIORITY },
      }))
    );
    queued += events?.length ?? 0;
  } while (pageToken);

  console.log(`[import-gmail-history] ${userId}: queued ${queued} of ${seen} emails since ${new Date(after * 1000).toISOString()}`);
}
