import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { triageEmail, extractCommitments } from "@/lib/ai/claude";
import { embedAndStoreChunks, updateCommunicationEmbedding } from "@/lib/memory/embed";
import { classifySender, getSenderHint, shouldRunStage1 } from "@/lib/finance/senders";
import { operationalQueue } from "@/lib/queues";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { normalizeMerchant, getCategoryForMerchant, getWalletPaymentModeLabel } from "@/lib/finance/normalize";
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

  if (!comm) return;

  // Per-step idempotency: a row can have a summary but no embedding if an
  // earlier run died between the two (worker crash, embedding API error).
  // Returning early on body_summary alone left those permanently unsearchable,
  // so heal just the embedding instead of redoing triage.
  if (comm.body_summary) {
    if (comm.embedding) return;
    await embedAndStoreChunks({
      userId,
      sourceType: "communication",
      sourceId: communicationId,
      text: `${comm.subject}\n\n${comm.body_summary}`,
      metadata: {
        occurred_at: comm.occurred_at,
        contact_email: (comm.contacts as any)?.email ?? "",
      },
    });
    await updateCommunicationEmbedding(communicationId, comm.body_summary);
    return;
  }

  const { data: user } = await supabase
    .from("users")
    .select("business_context")
    .eq("id", userId)
    .single();

  const businessContext = user?.business_context ?? {};
  const senderEmail = (comm.contacts as any)?.email ?? "";
  const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${senderEmail}>${getSenderHint(senderEmail)}`;

  // Stage 0: General email triage
  const triage = await triageEmail(businessContext, senderInfo, comm.body ?? "");

  const LOW_SIGNAL_CATEGORIES = new Set([
    "news", "newsletters", "promotions", "entertainment",
    "social", "system_notifications",
  ]);
  const cappedScore = LOW_SIGNAL_CATEGORIES.has(triage.email_category)
    ? Math.min(triage.importance_score, 0.3)
    : triage.importance_score;

  const existingMeta = (comm.channel_metadata as any) ?? {};

  await supabase
    .from("communications")
    .update({
      body_summary: triage.summary,
      sentiment: triage.sentiment,
      importance_score: cappedScore,
      requires_action: triage.requires_action,
      email_category: triage.email_category,
      category_processed: true,
      channel_metadata: existingMeta,
    })
    .eq("id", communicationId);

  // Stage 1: Financial extraction
  if (shouldRunStage1(triage.email_category, comm.subject ?? "", comm.body?.substring(0, 500) ?? "")) {
    await runFinancialExtraction(
      supabase, userId, communicationId, senderEmail,
      comm.subject ?? "", comm.body ?? "",
      triage.email_category, (triage as any).fallback_category ?? null,
      comm.occurred_at
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

  // Reprocessing the same email must not create a second set of commitments or
  // tasks. Both are plain inserts keyed only by source_id, so a re-run (body
  // reparse, reconcile pass, retried job) would duplicate them. Skip rather
  // than delete-and-replace, so anything already acted on is preserved.
  const { count: existingCommitments } = await supabase
    .from("commitments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source_type", "email")
    .eq("source_id", communicationId);

  if (triage.requires_action && comm.body && !existingCommitments) {
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

  const { count: existingTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source_type", "email")
    .eq("source_id", communicationId);

  if (triage.requires_action && cappedScore >= 0.7 && !existingTasks) {
    await supabase.from("tasks").insert({
      user_id: userId,
      title: triage.action_description ?? `Reply to: ${comm.subject}`,
      source_type: "email",
      source_id: communicationId,
      contact_id: comm.contact_id,
      due_date: triage.follow_up_deadline,
      priority: cappedScore >= 0.85 ? "high" : "medium",
      ai_reasoning: `Importance: ${cappedScore.toFixed(2)}. ${triage.summary}`,
    });
  }

  await operationalQueue.add("compute-operational-state", { userId }, { delay: 30000, jobId: `ops-${userId}`, deduplication: { id: `ops-${userId}` } });
}

// A transaction cannot have happened in the future, but extraction sometimes
// picks up a due date, delivery date, or expiry instead. Those rows then skewed
// the finance tab and sat permanently inside the dedup window. Falls back to when
// the email actually arrived.
function resolveTransactionDatetime(
  extracted: string | null,
  occurredAt: string | null
): string | null {
  if (!extracted) return null;
  const parsed = new Date(extracted).getTime();
  if (Number.isNaN(parsed)) return occurredAt;
  // End of today rather than "now", so a same-day timestamp that's a few hours
  // ahead from timezone handling isn't needlessly rewritten.
  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  return parsed > endOfToday.getTime() ? occurredAt : extracted;
}

async function runFinancialExtraction(
  supabase: any,
  userId: string,
  communicationId: string,
  senderEmail: string,
  subject: string,
  body: string,
  emailCategory: string | null,
  fallbackCategory: string | null,
  occurredAt: string | null
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

  const senderDomain = senderEmail.includes("@") ? senderEmail.split("@")[1].toLowerCase() : "";
  const walletLabel = getWalletPaymentModeLabel(senderDomain);

  // If the email is from a wallet/payment-mode sender, don't record it as a merchant
  const merchantRaw = walletLabel ? null : (raw?.merchant_name ?? null);
  const deterministicNormalized = merchantRaw ? normalizeMerchant(merchantRaw) : null;
  // Prefer deterministic normalization; fall back to LLM's suggestion for unknown merchants
  const isKnownMerchant = deterministicNormalized !== null &&
    deterministicNormalized !== merchantRaw?.trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const merchantNormalized = walletLabel
    ? null
    : (isKnownMerchant ? deterministicNormalized : (raw?.merchant_normalized ?? deterministicNormalized));
  const paymentMethod = walletLabel ?? raw?.payment_method ?? null;
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
      payment_method: paymentMethod,
      transaction_datetime: resolveTransactionDatetime(
        raw?.transaction_datetime ?? null,
        occurredAt
      ),
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
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const db = supabase as any;

  const { data: rawRows } = await db
    .from("transactions_raw")
    .select("*")
    .eq("user_id", userId)
    .eq("is_financial_email", true)
    .eq("needs_review", false)
    .gte("transaction_datetime", since)
    // Upper bound matters: extraction sometimes picks up a due/delivery date, so
    // rows land in the future and would otherwise satisfy the lower bound on
    // every single dedup run, forever.
    .lte("transaction_datetime", now.toISOString());

  if (!rawRows?.length) return;

  const normalized = deduplicateRawTransactions(rawRows as TransactionRaw[]);

  for (const norm of normalized) {
    // Fetch every match rather than using maybeSingle(): maybeSingle errors when
    // 2+ rows match and returns null, which this code previously read as "not
    // found" and inserted another copy - each duplicate then guaranteed another
    // on the next run. Collapse to the oldest row and delete the rest so the
    // table self-heals as this runs.
    const { data: existing } = await db
      .from("transactions_normalized")
      .select("id")
      .eq("user_id", userId)
      .contains("communication_ids", norm.communication_ids)
      .order("created_at", { ascending: true });

    const matches = existing ?? [];

    if (matches.length === 0) {
      const { error: insertErr } = await db.from("transactions_normalized").insert({
        ...norm,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });

      // A concurrent dedup run can win the race between the select above and
      // this insert. The unique index on (user_id, communication_ids) rejects
      // the loser with 23505; without this branch the transaction would be
      // silently dropped, since supabase-js returns errors rather than throwing.
      if (insertErr) {
        if (insertErr.code !== "23505") {
          console.error(`[dedup] Insert failed: ${insertErr.message}`);
          continue;
        }
        const { data: raced } = await db
          .from("transactions_normalized")
          .select("id")
          .eq("user_id", userId)
          .contains("communication_ids", norm.communication_ids)
          .order("created_at", { ascending: true });
        if (raced?.length) {
          await db
            .from("transactions_normalized")
            .update({ ...norm, updated_at: now.toISOString() })
            .eq("id", raced[0].id);
        }
      }
      continue;
    }

    const [keep, ...redundant] = matches;

    const { error: updateErr } = await db
      .from("transactions_normalized")
      .update({ ...norm, updated_at: now.toISOString() })
      .eq("id", keep.id);
    if (updateErr) console.error(`[dedup] Update failed for ${keep.id}: ${updateErr.message}`);

    if (redundant.length > 0) {
      const { error: deleteErr } = await db
        .from("transactions_normalized")
        .delete()
        .in("id", redundant.map((r: { id: string }) => r.id));
      if (deleteErr) {
        console.error(`[dedup] Failed to delete duplicates: ${deleteErr.message}`);
      } else {
        console.log(
          `[dedup] Collapsed ${redundant.length} duplicate normalized rows into ${keep.id}`
        );
      }
    }
  }
}
