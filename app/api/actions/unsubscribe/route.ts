import { createClient } from "@/lib/supabase/server";
import { getGmailClient } from "@/lib/integrations/gmail";
import { sendEmail } from "@/lib/integrations/gmail";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { communicationId } = await request.json();

  const { data: comm } = await supabase
    .from("communications")
    .select("external_id, subject, channel_metadata")
    .eq("id", communicationId)
    .eq("user_id", user.id)
    .single();

  if (!comm) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const metadata = comm.channel_metadata as any ?? {};
  const listUnsubscribe: string = metadata.list_unsubscribe ?? "";

  if (!listUnsubscribe) {
    return NextResponse.json({ error: "No unsubscribe link found for this email" }, { status: 400 });
  }

  // Parse List-Unsubscribe header — can contain <mailto:...> and/or <https://...>
  const mailtoMatch = listUnsubscribe.match(/<mailto:([^>]+)>/i);
  const httpMatch = listUnsubscribe.match(/<(https?:\/\/[^>]+)>/i);

  if (mailtoMatch) {
    // Send unsubscribe email
    const mailtoRaw = mailtoMatch[1];
    const [toAddr, queryString] = mailtoRaw.split("?");
    const subjectMatch = queryString?.match(/subject=([^&]+)/i);
    const unsubSubject = subjectMatch
      ? decodeURIComponent(subjectMatch[1])
      : "Unsubscribe";

    await sendEmail(user.id, {
      to: toAddr,
      subject: unsubSubject,
      body: "Please unsubscribe me from this mailing list.",
    });
  } else if (httpMatch) {
    // Hit the HTTP unsubscribe URL
    await fetch(httpMatch[1], { method: "POST" }).catch(() =>
      fetch(httpMatch[1], { method: "GET" })
    );
  } else {
    return NextResponse.json({ error: "Could not parse unsubscribe link" }, { status: 400 });
  }

  // Mark as spam in Gmail and done in DB
  const gmail = await getGmailClient(user.id);
  await gmail.users.messages.modify({
    userId: "me",
    id: comm.external_id,
    requestBody: {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    },
  });

  await supabase
    .from("communications")
    .update({ action_taken: true, requires_action: false })
    .eq("id", communicationId);

  return NextResponse.json({ ok: true });
}
