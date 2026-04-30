import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { triageEmail, extractCommitments } from "@/lib/ai/claude";
import { embedAndStoreChunks, updateCommunicationEmbedding } from "@/lib/memory/embed";

export async function summarizeCommunication(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { communicationId, userId } = job.data;

  const { data: comm } = await supabase
    .from("communications")
    .select("*, contacts(name, email)")
    .eq("id", communicationId)
    .single();

  if (!comm || comm.body_summary) return; // already processed

  const { data: user } = await supabase
    .from("users")
    .select("business_context")
    .eq("id", userId)
    .single();

  const businessContext = user?.business_context ?? {};
  const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${(comm.contacts as any)?.email ?? ""}>`;

  // Claude Haiku triage
  const triage = await triageEmail(businessContext, senderInfo, comm.body ?? "");

  const isFinancial = triage.email_category === "finance_bills" || triage.email_category === "transactions";
  const existingMeta = (comm.channel_metadata as any) ?? {};
  const financialMeta = isFinancial
    ? {
        fin_amount: triage.fin_amount,
        fin_currency: triage.fin_currency,
        fin_merchant: triage.fin_merchant,
        fin_sub_category: triage.fin_sub_category,
      }
    : {};

  await supabase
    .from("communications")
    .update({
      body_summary: triage.summary,
      sentiment: triage.sentiment,
      importance_score: triage.importance_score,
      requires_action: triage.requires_action,
      email_category: triage.email_category,
      category_processed: true,
      channel_metadata: { ...existingMeta, ...financialMeta },
    })
    .eq("id", communicationId);

  // Embed summary into memory
  await embedAndStoreChunks({
    userId,
    sourceType: "communication",
    sourceId: communicationId,
    text: `${comm.subject}\n\n${triage.summary}`,
    metadata: {
      occurred_at: comm.occurred_at,
      entities: triage.entities_mentioned,
      contact_email: (comm.contacts as any)?.email,
    },
  });

  // Update inline embedding on communications table
  await updateCommunicationEmbedding(communicationId, triage.summary);

  // Extract commitments if action required
  if (triage.requires_action && comm.body) {
    const commitments = await extractCommitments(
      comm.body,
      (comm.contacts as any)?.email ?? ""
    );

    for (const c of commitments) {
      if (c.confidence < 0.6) continue;

      let contactId: string | null = null;
      if (c.to_whom) {
        const { data: contact } = await supabase
          .from("contacts")
          .select("id")
          .eq("user_id", userId)
          .ilike("email", `%${c.to_whom}%`)
          .single();
        contactId = contact?.id ?? null;
      }

      await supabase.from("commitments").insert({
        user_id: userId,
        description: c.description,
        to_contact_id: contactId,
        source_type: "email",
        source_id: communicationId,
        due_date: c.due_date,
        extracted_by: "ai",
        ai_confidence: c.confidence,
      });
    }
  }

  // Create task if high importance with required action
  if (triage.requires_action && triage.importance_score >= 0.7) {
    await supabase.from("tasks").insert({
      user_id: userId,
      title: triage.action_description ?? `Reply to: ${comm.subject}`,
      source_type: "email",
      source_id: communicationId,
      contact_id: comm.contact_id,
      due_date: triage.follow_up_deadline,
      priority: triage.importance_score >= 0.85 ? "high" : "medium",
      ai_reasoning: `Importance: ${triage.importance_score.toFixed(2)}. ${triage.summary}`,
    });
  }
}
