import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchHistorySince } from "@/lib/integrations/gmail";
import { emailRawQueue } from "@/lib/queues";

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Google Pub/Sub push format
  const message = body.message;
  if (!message?.data) return NextResponse.json({ ok: true });

  const decoded = JSON.parse(Buffer.from(message.data, "base64").toString());
  const { emailAddress, historyId } = decoded;

  if (!emailAddress || !historyId) return NextResponse.json({ ok: true });

  const supabase = await createServiceClient();

  // Find user by email
  const { data: integration } = await supabase
    .from("integrations")
    .select("user_id, metadata")
    .eq("provider", "google")
    .eq("external_account_id", emailAddress)
    .single();

  if (!integration) return NextResponse.json({ ok: true });

  const userId = integration.user_id;
  const lastHistoryId = integration.metadata?.last_history_id;

  if (!lastHistoryId) {
    // First push — save historyId and wait for next push
    await supabase
      .from("integrations")
      .update({ metadata: { ...integration.metadata, last_history_id: historyId } })
      .eq("user_id", userId)
      .eq("provider", "google");
    return NextResponse.json({ ok: true });
  }

  // Fetch new messages since last history ID
  let history: any[];
  try {
    history = await fetchHistorySince(userId, lastHistoryId);
  } catch (err: any) {
    console.error("Gmail history fetch error:", err.message);
    return NextResponse.json({ ok: true });
  }

  const messageIds = new Set<string>();
  for (const entry of history) {
    for (const added of entry.messagesAdded ?? []) {
      const labels = added.message?.labelIds ?? [];
      // Only INBOX messages, skip sent/drafts
      if (labels.includes("INBOX") && !labels.includes("SENT")) {
        messageIds.add(added.message.id);
      }
    }
  }

  // Write raw events and enqueue
  for (const messageId of messageIds) {
    const { error } = await supabase.from("raw_events").insert({
      user_id: userId,
      source: "gmail",
      event_type: "email.received",
      external_id: messageId,
      raw_payload: { messageId, historyId },
    });

    if (!error) {
      const { data: rawEvent } = await supabase
        .from("raw_events")
        .select("id")
        .eq("user_id", userId)
        .eq("source", "gmail")
        .eq("external_id", messageId)
        .single();

      if (rawEvent) {
        await emailRawQueue.add("process-email", { rawEventId: rawEvent.id });
      }
    }
  }

  // Update last history ID
  await supabase
    .from("integrations")
    .update({ metadata: { ...integration.metadata, last_history_id: historyId } })
    .eq("user_id", userId)
    .eq("provider", "google");

  return NextResponse.json({ ok: true });
}
