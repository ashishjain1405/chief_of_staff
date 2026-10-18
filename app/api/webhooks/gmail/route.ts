import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchHistorySince } from "@/lib/integrations/gmail";
import { emailRawQueue } from "@/lib/queues";
import { OAuth2Client } from "google-auth-library";

const tokenVerifier = new OAuth2Client();
let warnedUnverified = false;

// Unauthenticated, this route let anyone who knew a connected address move the
// Gmail history cursor and make mail skip or replay. Pub/Sub can sign each push
// with an OIDC token for a chosen service account; this checks it.
//
// Enforced only once GMAIL_PUSH_SERVICE_ACCOUNT is set, because it requires the
// subscription to be configured to send the token first — enforcing earlier
// rejects every push and stops ingestion, the outage this app has had twice.
async function rejectUnverifiedPush(request: NextRequest): Promise<string | null> {
  const expected = process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!expected) {
    if (!warnedUnverified) console.warn("[gmail-webhook] GMAIL_PUSH_SERVICE_ACCOUNT unset — accepting unauthenticated pushes");
    warnedUnverified = true;
    return null;
  }
  const header = request.headers.get("authorization") ?? "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return "missing bearer token";
  const audience = process.env.GMAIL_PUSH_AUDIENCE ?? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/gmail`;
  try {
    const ticket = await tokenVerifier.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (payload?.email !== expected || !payload.email_verified) {
      return `token from an unexpected service account (got ${payload?.email ?? "none"}, expected ${expected})`;
    }
    return null;
  } catch (err) {
    // The library's message omits the values that differ ("payload audience !=
    // requiredAudience"), so log the token's own aud/email claims - identifiers,
    // not secrets - to make a misconfigured subscription diagnosable.
    return `invalid token: ${(err as Error).message} | token aud=${claim(idToken, "aud")} email=${claim(idToken, "email")} | expected aud=${audience}`;
  }
}

function claim(jwt: string, name: string): string {
  try {
    const value = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())[name];
    return typeof value === "string" ? value : "none";
  } catch {
    return "unreadable";
  }
}

export async function POST(request: NextRequest) {
  const rejection = await rejectUnverifiedPush(request);
  if (rejection) {
    console.error(`[gmail-webhook] rejected push: ${rejection}`);
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
