import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyZoomWebhook, getMeetingRecordings, downloadTranscript, parseVttTranscript } from "@/lib/integrations/zoom";
import { summarizeQueue } from "@/lib/queues";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-zm-signature") ?? "";
  const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";

  // Handle Zoom URL validation challenge
  const body = JSON.parse(rawBody);
  if (body.event === "endpoint.url_validation") {
    const crypto = await import("crypto");
    const hash = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN!)
      .update(body.payload.plainToken)
      .digest("hex");
    return NextResponse.json({ plainToken: body.payload.plainToken, encryptedToken: hash });
  }

  if (!verifyZoomWebhook(rawBody, signature, timestamp)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const { event, payload } = body;

  if (event === "recording.completed") {
    const { object: recording } = payload;
    const hostEmail = recording.host_email;
    const meetingId = recording.id ?? recording.uuid;

    // Find user by email
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", hostEmail)
      .single();

    if (!user) return NextResponse.json({ ok: true });

    // Find meeting
    const { data: meeting } = await supabase
      .from("meetings")
      .select("id")
      .eq("user_id", user.id)
      .eq("source", "zoom")
      .eq("external_id", String(meetingId))
      .single();

    if (!meeting) return NextResponse.json({ ok: true });

    // Download transcript
    const recordings = await getMeetingRecordings(String(meetingId));
    const transcriptFile = recordings?.recording_files?.find(
      (f: any) => f.file_type === "TRANSCRIPT"
    );

    if (!transcriptFile) return NextResponse.json({ ok: true });

    try {
      const vttText = await downloadTranscript(transcriptFile.download_url);
      const transcript = parseVttTranscript(vttText);

      await supabase
        .from("meetings")
        .update({ transcript, recording_url: transcriptFile.download_url })
        .eq("id", meeting.id);

      await summarizeQueue.add(
        "summarize-meeting",
        { meetingId: meeting.id, userId: user.id },
        { delay: 5000 } // short delay to ensure DB write committed
      );
    } catch (err: any) {
      console.error("Transcript download error:", err.message);
    }
  }

  return NextResponse.json({ ok: true });
}
