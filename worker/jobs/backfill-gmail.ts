import { createClient } from "@supabase/supabase-js";
import { getGmailClient, fetchEmailById, parseEmailBody, parseEmailHtml, extractHeader } from "@/lib/integrations/gmail";

const DAYS = parseInt(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? "90");
const DELAY_MS = 200; // ~5 req/s, well under Gmail quota

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get all users with a Google integration
  const { data: integrations } = await supabase
    .from("integrations")
    .select("user_id, external_account_id")
    .eq("provider", "google");

  if (!integrations?.length) {
    console.log("No Google integrations found.");
    process.exit(0);
  }

  for (const integration of integrations) {
    const userId = integration.user_id;
    console.log(`\nBackfilling ${DAYS} days for user ${integration.external_account_id} (${userId})`);

    try {
      await backfillUser(supabase, userId, DAYS);
    } catch (err: any) {
      console.error(`Failed for user ${userId}:`, err.message);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

async function backfillUser(supabase: any, userId: string, days: number) {
  const gmail = await getGmailClient(userId);
  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

  let pageToken: string | undefined;
  let fetched = 0;
  let skipped = 0;
  let imported = 0;

  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q: `after:${after}`,
      maxResults: 100,
      pageToken,
    });

    const messages = data.messages ?? [];
    pageToken = data.nextPageToken ?? undefined;

    for (const msg of messages) {
      fetched++;
      const messageId = msg.id!;

      // Skip if already in communications
      const { data: existing } = await supabase
        .from("communications")
        .select("id")
        .eq("user_id", userId)
        .eq("source", "gmail")
        .eq("external_id", messageId)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      try {
        await importMessage(supabase, userId, messageId);
        imported++;
        console.log(`[${imported} imported / ${skipped} skipped / ${fetched} seen] ${messageId}`);
      } catch (err: any) {
        console.error(`  Failed ${messageId}:`, err.message);
      }

      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  } while (pageToken);

  console.log(`\nUser done: ${imported} imported, ${skipped} already existed, ${fetched} total seen.`);
}

async function importMessage(supabase: any, userId: string, messageId: string) {
  const message = await fetchEmailById(userId, messageId);
  const headers = message.payload?.headers ?? [];

  const from = extractHeader(headers, "from");
  const to = extractHeader(headers, "to");
  const subject = extractHeader(headers, "subject");
  const date = extractHeader(headers, "date");
  const threadId = message.threadId ?? undefined;
  const body = parseEmailBody(message.payload);
  const bodyHtml = parseEmailHtml(message.payload);
  const listUnsubscribe = extractHeader(headers, "list-unsubscribe");

  const emailMatch = from.match(/<(.+)>/) ?? from.match(/(\S+@\S+)/);
  const senderEmail = emailMatch?.[1] ?? from;
  const senderName = from.replace(/<.+>/, "").trim().replace(/^"|"$/g, "");

  // Upsert contact
  const { data: contact } = await supabase
    .from("contacts")
    .upsert(
      { user_id: userId, email: senderEmail, name: senderName || senderEmail },
      { onConflict: "user_id,email", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  const labels = message.labelIds ?? [];
  let importanceScore = 0.5;
  if (labels.includes("IMPORTANT")) importanceScore += 0.2;
  if (!to.includes(",")) importanceScore += 0.1;
  if (body.match(/urgent|asap|deadline|invoice|contract|term sheet/i)) importanceScore += 0.15;
  if (body.match(/unsubscribe|list-unsubscribe/i)) importanceScore = 0.05;
  importanceScore = Math.min(1, importanceScore);

  const { data: comm } = await supabase
    .from("communications")
    .upsert(
      {
        user_id: userId,
        source: "gmail",
        external_id: messageId,
        thread_id: threadId,
        contact_id: contact?.id,
        subject,
        body: body.substring(0, 10000),
        body_html: bodyHtml.substring(0, 500000) || null,
        direction: "inbound",
        channel_metadata: { from, to, labels, list_unsubscribe: listUnsubscribe || null },
        occurred_at: date ? new Date(date).toISOString() : new Date().toISOString(),
        importance_score: importanceScore,
      },
      { onConflict: "user_id,source,external_id" }
    )
    .select("id")
    .single();

  // summarization skipped — enqueue manually once Redis quota resets
}

main();
