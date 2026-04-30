import { createClient } from "@/lib/supabase/server";
import { getGmailClient } from "@/lib/integrations/gmail";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { communicationId } = await request.json();

  const { data: comm } = await supabase
    .from("communications")
    .select("external_id")
    .eq("id", communicationId)
    .eq("user_id", user.id)
    .single();

  if (!comm) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gmail = await getGmailClient(user.id);
  await gmail.users.messages.modify({
    userId: "me",
    id: comm.external_id,
    requestBody: {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    },
  });

  // Mark as action taken so it disappears from inbox action queue
  await supabase
    .from("communications")
    .update({ action_taken: true, requires_action: false })
    .eq("id", communicationId);

  return NextResponse.json({ ok: true });
}
