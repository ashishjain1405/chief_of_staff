import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/integrations/gmail";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { communicationId, draftId, body } = await request.json();

  const { data: comm } = await supabase
    .from("communications")
    .select("*, contacts(name, email)")
    .eq("id", communicationId)
    .eq("user_id", user.id)
    .single();

  if (!comm) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const contact = comm.contacts as any;
  const metadata = comm.channel_metadata as any ?? {};
  const replyTo = contact?.email ?? metadata?.from?.match(/<(.+)>/)?.[1] ?? metadata?.from;

  if (!replyTo) return NextResponse.json({ error: "No reply address found" }, { status: 400 });

  await sendEmail(user.id, {
    to: replyTo,
    subject: comm.subject?.startsWith("Re:") ? comm.subject : `Re: ${comm.subject ?? ""}`,
    body,
    threadId: comm.thread_id ?? undefined,
  });

  // Mark communication as action taken
  await supabase
    .from("communications")
    .update({ action_taken: true })
    .eq("id", communicationId);

  // Mark draft as sent
  if (draftId) {
    await supabase
      .from("drafts")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", draftId);
  }

  return NextResponse.json({ ok: true });
}
