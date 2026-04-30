import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { fetchEmailById, parseEmailBody, extractHeader } from "@/lib/integrations/gmail";
import { summarizeQueue } from "@/lib/queues";

export async function processEmail(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { rawEventId } = job.data;

  const { data: rawEvent } = await supabase
    .from("raw_events")
    .select("*")
    .eq("id", rawEventId)
    .single();

  if (!rawEvent || rawEvent.processed) return;

  const userId = rawEvent.user_id;
  const messageId = rawEvent.external_id;

  // Fetch full email from Gmail API
  const message = await fetchEmailById(userId, messageId);
  const headers = message.payload?.headers ?? [];

  const from = extractHeader(headers, "from");
  const to = extractHeader(headers, "to");
  const subject = extractHeader(headers, "subject");
  const date = extractHeader(headers, "date");
  const threadId = message.threadId ?? undefined;
  const body = parseEmailBody(message.payload);
  const listUnsubscribe = extractHeader(headers, "list-unsubscribe");

  // Extract sender email
  const emailMatch = from.match(/<(.+)>/) ?? from.match(/(\S+@\S+)/);
  const senderEmail = emailMatch?.[1] ?? from;
  const senderName = from.replace(/<.+>/, "").trim().replace(/^"|"$/g, "");

  // Upsert contact
  const { data: contact } = await supabase
    .from("contacts")
    .upsert(
      {
        user_id: userId,
        email: senderEmail,
        name: senderName || senderEmail,
      },
      { onConflict: "user_id,email", ignoreDuplicates: false }
    )
    .select("id")
    .single();

  // Quick importance heuristic before AI
  const labels = message.labelIds ?? [];
  let importanceScore = 0.5;
  if (labels.includes("IMPORTANT")) importanceScore += 0.2;
  if (!to.includes(",")) importanceScore += 0.1; // direct, not CC'd
  if (body.match(/urgent|asap|deadline|invoice|contract|term sheet/i)) importanceScore += 0.15;
  if (body.match(/unsubscribe|list-unsubscribe/i)) importanceScore = 0.05;
  importanceScore = Math.min(1, importanceScore);

  // Write normalized communication
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
        body: body.substring(0, 10000), // cap raw body
        direction: "inbound",
        channel_metadata: { from, to, labels, list_unsubscribe: listUnsubscribe || null },
        occurred_at: date ? new Date(date).toISOString() : new Date().toISOString(),
        importance_score: importanceScore,
      },
      { onConflict: "user_id,source,external_id" }
    )
    .select("id")
    .single();

  // Mark raw event processed
  await supabase
    .from("raw_events")
    .update({ processed: true })
    .eq("id", rawEventId);

  // Enqueue summarization
  if (comm?.id) {
    await summarizeQueue.add("summarize-communication", {
      communicationId: comm.id,
      userId,
    });
  }
}
