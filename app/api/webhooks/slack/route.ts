import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { slackRawQueue } from "@/lib/queues";

function verifySlackSignature(body: string, signature: string, timestamp: string): boolean {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false; // reject stale requests

  const sigBase = `v0:${timestamp}:${body}`;
  const expected = `v0=${crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET!)
    .update(sigBase)
    .digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature") ?? "";
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";

  if (!verifySlackSignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody);

  // Slack URL verification challenge
  if (body.type === "url_verification") {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.type !== "event_callback") return NextResponse.json({ ok: true });

  const event = body.event;
  const supabase = await createServiceClient();

  // Only process DMs and @mentions (privacy default)
  const isDM = event.channel_type === "im";
  const isMention = event.type === "app_mention";
  if (!isDM && !isMention) return NextResponse.json({ ok: true });

  // Skip bot messages
  if (event.bot_id || event.subtype === "bot_message") return NextResponse.json({ ok: true });

  // Find user whose Slack workspace this belongs to
  const { data: integration } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "slack")
    .eq("external_account_id", body.team_id)
    .single();

  if (!integration) return NextResponse.json({ ok: true });

  const externalId = `${event.channel}-${event.ts}`;
  const { error } = await supabase.from("raw_events").insert({
    user_id: integration.user_id,
    source: "slack",
    event_type: isDM ? "message.im" : "message.mention",
    external_id: externalId,
    raw_payload: event,
  });

  if (!error) {
    const { data: rawEvent } = await supabase
      .from("raw_events")
      .select("id")
      .eq("user_id", integration.user_id)
      .eq("source", "slack")
      .eq("external_id", externalId)
      .single();

    if (rawEvent) {
      await slackRawQueue.add("process-slack", { rawEventId: rawEvent.id });
    }
  }

  return NextResponse.json({ ok: true });
}
