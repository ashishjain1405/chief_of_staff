import { createClient } from "@/lib/supabase/server";
import { generateDraft } from "@/lib/ai/claude";
import { draftReplyPrompt, NO_REPLY_NEEDED } from "@/lib/ai/prompts";
import { isNoReplySender } from "@/lib/email/drafts";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { communicationId } = await request.json();

  const { data: comm } = await supabase
    .from("communications")
    .select("*, contacts(name, email)")
    .eq("id", communicationId)
    .eq("user_id", user.id)
    .single();

  if (!comm) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: userData } = await supabase
    .from("users")
    .select("business_context, full_name, email")
    .eq("id", user.id)
    .single();

  const bc = userData?.business_context as any ?? {};
  const contact = comm.contacts as any;

  const senderEmail: string = contact?.email ?? "";
  // A robot never reads the reply, and drafting one invited "thanks for the
  // reminder, we'll join" to no-reply@zoom.us. The founder's own mail has no
  // one to answer.
  if (isNoReplySender(senderEmail)) {
    return NextResponse.json({ skipped: "This email is from an automated address that does not read replies." });
  }
  if (userData?.email && senderEmail.toLowerCase() === userData.email.toLowerCase()) {
    return NextResponse.json({ skipped: "This email was sent by you." });
  }

  // Quoted text is kept: when the founder already chose ("Wednesday works"),
  // the quoted chain is the only evidence the draft may confirm it.
  const prompt = draftReplyPrompt({
    founderName: (userData?.full_name ?? "").trim().split(/\s+/)[0] ?? "",
    companyName: bc.company_name ?? "",
    companyDescription: bc.description ?? "",
    contactName: contact?.name ?? "",
    contactEmail: senderEmail,
    subject: comm.subject ?? "",
    summary: comm.body_summary ?? "",
    body: comm.body ?? "",
  });

  const draftText = await generateDraft(prompt);
  if (draftText.trim().replace(/[.\s]+$/, "") === NO_REPLY_NEEDED) {
    return NextResponse.json({ skipped: "This email does not need a reply." });
  }

  const { data: draft } = await supabase
    .from("drafts")
    .insert({
      user_id: user.id,
      communication_id: communicationId,
      draft_text: draftText,
      status: "pending_review",
    })
    .select("id, draft_text, status, created_at")
    .single();

  return NextResponse.json({ draft });
}
