import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { triageEmail, extractCommitments } from "@/lib/ai/claude";
import { embedAndStoreChunks, updateCommunicationEmbedding } from "@/lib/memory/embed";
import { classifySender, shouldRunStage1 } from "@/lib/finance/senders";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { normalizeMerchant, getCategoryForMerchant } from "@/lib/finance/normalize";
import { deduplicateRawTransactions, type TransactionRaw } from "@/lib/finance/dedup";

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

  if (!comm || comm.body_summary) return;

  const { data: user } = await supabase
    .from("users")
    .select("business_context")
    .eq("id", userId)
    .single();

  const businessContext = user?.business_context ?? {};
  const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${(comm.contacts as any)?.email ?? ""}>`;
  const senderEmail = (comm.contacts as any)?.email ?? "";

  // Stage 0: General email triage (unchanged)
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

  // Stage 1: Financial extraction
  if (shouldRunStage1(triage.email_category, comm.subject ?? "", comm.body?.substring(0, 500) ?? "")) {
    await runFinancialExtraction(
      supabase, userId, communicationId, senderEmail,
      comm.subject ?? "", comm.body ?? "",
      triage.email_category, (triage as any).fallback_category ?? null
    );
  }

  // Embed summary into memory
  await embedAndStoreChunks({
    userId,
    sourceType: "communication",
    sourceId: communicationId,
    text: `${comm.subject}\n\n${triage.summary}`,
    metadata: {
      occurred_at: comm.occurred_at,
      entities: triage.entities_mentioned,
      contact_email: senderEmail,
    },
  });

  await updateCommunicationEmbedding(communicationId, triage.summary);

  if (triage.requires_action && comm.body) {
    const commitments = await extractCommitments(
      comm.body,
      senderEmail
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

async function runFinancialExtraction(
  supabase: any,
  userId: string,
  communicationId: string,
  senderEmail: string,
  subject: string,
  body: string,
  emailCategory: string | null,
  fallbackCategory: string | null
) {
  const senderType = classifySender(senderEmail);
  const extraction = await extractFinancialTransaction(senderEmail, senderType, subject, body);

  // LLM says not financial and no amount — skip entirely
  if (!extraction.is_financial_email && extraction.transaction?.amount == null) return;

  const raw = extraction.transaction;

  // Determine needs_review flag
  const needsReview =
    (!extraction.is_financial_email && raw?.amount != null) ||
    (extraction.is_financial_email && extraction.confidence < 0.5) ||
    (extraction.is_financial_email && extraction.confidence >= 0.5 && raw?.amount == null);

  if (!extraction.is_financial_email && !needsReview) return;

  const merchantRaw = raw?.merchant_name ?? null;
  const deterministicNormalized = merchantRaw ? normalizeMerchant(merchantRaw) : null;
  // Prefer deterministic normalization; fall back to LLM's suggestion for unknown merchants
  const isKnownMerchant = deterministicNormalized !== null &&
    deterministicNormalized !== merchantRaw?.trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const merchantNormalized = isKnownMerchant
    ? deterministicNormalized
    : (raw?.merchant_normalized ?? deterministicNormalized);
  const category = merchantNormalized
    ? (getCategoryForMerchant(merchantNormalized) ?? raw?.category ?? null)
    : (raw?.category ?? null);

  // Accept LLM sender_type only for types the deterministic engine doesn't classify
  const LLM_ONLY_SENDER_TYPES = new Set(["INSURANCE_PROVIDER", "TRAVEL_PROVIDER", "SUBSCRIPTION_PROVIDER"]);
  const resolvedSenderType = LLM_ONLY_SENDER_TYPES.has(raw?.sender_type ?? "")
    ? raw!.sender_type!
    : senderType;

  await (supabase.from as any)("transactions_raw").upsert(
    {
      user_id: userId,
      communication_id: communicationId,
      is_financial_email: extraction.is_financial_email,
      confidence: extraction.confidence,
      transaction_type: raw?.transaction_type ?? null,
      category,
      amount: raw?.amount ?? null,
      currency: raw?.currency ?? "INR",
      merchant_name: merchantRaw,
      merchant_normalized: merchantNormalized,
      bank_name: raw?.bank_name ?? null,
      payment_method: raw?.payment_method ?? null,
      transaction_datetime: raw?.transaction_datetime ?? null,
      due_date: raw?.due_date ?? null,
      transaction_id: raw?.transaction_id ?? null,
      reference_id: raw?.reference_id ?? null,
      upi_id: raw?.upi_id ?? null,
      masked_account: raw?.masked_account ?? null,
      is_recurring: raw?.is_recurring ?? false,
      recurring_frequency: raw?.recurring_frequency ?? null,
      status: raw?.status ?? null,
      sender_type: resolvedSenderType,
      raw_sender: senderEmail,
      needs_review: needsReview,
      extracted_at: new Date().toISOString(),
    },
    { onConflict: "communication_id" }
  );

  // If triage said financial but Stage 1 disagrees, correct the category
  const triageWasFinancial = emailCategory === "finance_bills" || emailCategory === "transactions";
  if (triageWasFinancial && !extraction.is_financial_email) {
    await supabase
      .from("communications")
      .update({ email_category: fallbackCategory ?? "other" })
      .eq("id", communicationId);
  }

  if (!needsReview) {
    await runDedup(supabase, userId);
  }
}

async function runDedup(supabase: any, userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const db = supabase as any;

  const { data: rawRows } = await db
    .from("transactions_raw")
    .select("*")
    .eq("user_id", userId)
    .eq("is_financial_email", true)
    .eq("needs_review", false)
    .gte("transaction_datetime", since);

  if (!rawRows?.length) return;

  const normalized = deduplicateRawTransactions(rawRows as TransactionRaw[]);

  for (const norm of normalized) {
    const { data: existing } = await db
      .from("transactions_normalized")
      .select("id")
      .eq("user_id", userId)
      .contains("communication_ids", norm.communication_ids)
      .maybeSingle();

    if (existing) {
      await db
        .from("transactions_normalized")
        .update({ ...norm, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await db.from("transactions_normalized").insert({
        ...norm,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }
}
