import { createClient } from "@/lib/supabase/server";
import { generateDraft } from "@/lib/ai/claude";
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
    .select("business_context")
    .eq("id", user.id)
    .single();

  const bc = userData?.business_context as any ?? {};
  const contact = comm.contacts as any;

  const prompt = `You are a founder's chief of staff. Write a concise, professional reply to this email on behalf of the founder.

Business context: ${bc.company_name ?? ""} — ${bc.description ?? ""}

Email from: ${contact?.name ?? "Unknown"} <${contact?.email ?? ""}>
Subject: ${comm.subject ?? "(no subject)"}
Summary: ${comm.body_summary ?? ""}
Original email:
${(comm.body ?? "").substring(0, 3000)}

Write a reply that is direct, friendly, and appropriate to the context. Do not add a subject line. Start directly with the greeting.`;

  const draftText = await generateDraft(prompt);

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
