import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getGmailClient, fetchEmailById, parseEmailBody, parseEmailHtml, extractHeader } from "@/lib/integrations/gmail";
import { summarizeQueue } from "@/lib/queues";

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const DAYS = 90;
const DELAY_MS = 200;

export async function POST(request: Request) {
  const { secret } = await request.json().catch(() => ({}));
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations } = await supabase
    .from("integrations")
    .select("user_id, external_account_id")
    .eq("provider", "google");

  if (!integrations?.length) {
    return NextResponse.json({ message: "No Google integrations found" });
  }

  // Run in background — don't await
  (async () => {
    for (const integration of integrations) {
      const userId = integration.user_id;
      const gmail = await getGmailClient(userId).catch(() => null);
      if (!gmail) continue;

      const after = Math.floor((Date.now() - DAYS * 24 * 60 * 60 * 1000) / 1000);
      let pageToken: string | undefined;
      let imported = 0;

      do {
        const { data } = await gmail.users.messages.list({
          userId: "me",
          q: `after:${after} -in:spam -in:trash`,
          maxResults: 100,
          pageToken,
        }).catch(() => ({ data: { messages: [], nextPageToken: undefined } }));

        const messages = data.messages ?? [];
        pageToken = data.nextPageToken ?? undefined;

        for (const msg of messages) {
          const messageId = msg.id!;
          const { data: existing } = await supabase
            .from("communications")
            .select("id")
            .eq("user_id", userId)
            .eq("source", "gmail")
            .eq("external_id", messageId)
            .maybeSingle();

          if (existing) continue;

          try {
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
            if (labels.includes("IMPORTANT") && !listUnsubscribe) importanceScore += 0.2;
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

            if (comm?.id) {
              await summarizeQueue.add("summarize", { communicationId: comm.id, userId });
              imported++;
            }
          } catch {}

          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      } while (pageToken);

      console.log(`Backfill done for ${userId}: ${imported} new emails imported`);
    }
  })();

  return NextResponse.json({ message: "Backfill started in background", users: integrations.length });
}
