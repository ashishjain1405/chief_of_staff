import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { triageEmail, extractCommitments } from "@/lib/ai/claude";
import { embedAndStoreChunks, updateCommunicationEmbedding } from "@/lib/memory/embed";
import { classifySender, getSenderHint, shouldRunStage1, isKnownFinancialDomain } from "@/lib/finance/senders";
import { enqueueOperationalState } from "@/lib/queues";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { getCategoryForMerchant, getWalletPaymentModeLabel, resolveMerchant, resolveTransactionType } from "@/lib/finance/normalize";
import { deduplicateRawTransactions, isPaymentForShipping, isShippingUpdate, saveNormalizedGroups, type TransactionRaw } from "@/lib/finance/dedup";
import { resolveFollowUpDeadline } from "@/lib/tasks/deadline";
import { LOW_SIGNAL_CATEGORIES } from "@/lib/inbox/categories";
import { shouldCreateTask, ccOnlyWithoutAsk, hasMessageText } from "@/lib/tasks/gate";
import { isPersonalSender, owesMoney, taskPriority } from "@/lib/tasks/priority";
import { conversationSubject, isSimilarTaskTitle } from "@/lib/tasks/similar";
import { FEATURES } from "@/lib/features";

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
    .select("business_context, email, full_name")
    .eq("id", userId)
    .single();

  const businessContext = user?.business_context ?? {};
  const senderEmail = (comm.contacts as any)?.email ?? "";
  const senderInfo = `${(comm.contacts as any)?.name ?? ""} <${senderEmail}>${getSenderHint(senderEmail)}`;

  // Triage saw only the sender and the body, never who the mail was addressed
  // to, so it could not tell whether the founder was the one being asked to
  // act. It wrote third-person chores for other people - "Ensure Kamal
  // understands...", "The receiver needs to verify..." - and those became
  // tasks. channel_metadata.to is already captured at ingest; cc is not, so
  // "directly addressed" versus "merely copied" stays unanswerable until
  // ingest stores it.
  const recipients = String((comm.channel_metadata as any)?.to ?? "").trim();
  const ccRecipients = String((comm.channel_metadata as any)?.cc ?? "").trim();
  const recipientInfo = [
    user?.email ? `the founder's own address is ${user.email}` : null,
    recipients ? `this email's To: ${recipients}` : "no recipient recorded",
    ccRecipients ? `Cc: ${ccRecipients}` : null,
  ]
    .filter(Boolean)
    .join("; ");

  // Stage 0: General email triage
  const isBulk = !!(comm.channel_metadata as any)?.list_unsubscribe;
  const triage = await triageEmail(businessContext, senderInfo, comm.body ?? "", recipientInfo, isBulk, comm.occurred_at);

  const cappedScore = LOW_SIGNAL_CATEGORIES.has(triage.email_category)
    ? Math.min(triage.importance_score, 0.3)
    : triage.importance_score;

  // With nothing written, triage still writes a summary, and invents one:
  // "reaching out regarding a matter that requires his attention" for an
  // attachment-only email. Say what is actually there instead.
  const summary = hasMessageText(comm.body ?? "")
    ? triage.summary
    : `No message text - only the subject "${comm.subject ?? ""}" and any attachment.`;

  const existingMeta = (comm.channel_metadata as any) ?? {};

  // Whether something is a task is a semantic question - is there an
  // outstanding action the founder owns - so it is gated on requires_action
  // and the category, not on importance_score.
  //
  // The old gate was `requires_action && cappedScore >= 0.7`, which made task
  // creation hostage to a noisy magnitude. Tightening the action guidance in
  // the prompt pulled importance down a notch as a side effect, and genuine
  // "reply to Kamal about the marketing plan" emails came back action=true at
  // 0.60 - dropping 6 of 8 real tasks while the intended noise was already
  // handled by category. importance_score still sets priority below, which is
  // what a magnitude is actually good for.
  const categoryAllowsTask = shouldCreateTask({
    category: triage.email_category,
    requiresAction: triage.requires_action,
    senderEmail,
    founderEmail: user?.email ?? null,
    isFinancialDomain: isKnownFinancialDomain(senderEmail),
    isBulk,
    ccOnlyWithoutAsk: ccOnlyWithoutAsk({
      to: recipients,
      cc: ccRecipients,
      founderEmail: user?.email,
      founderFirstName: user?.full_name?.trim().split(/\s+/)[0],
      body: comm.body ?? "",
    }),
    title: triage.action_description,
    subject: comm.subject,
    body: comm.body ?? "",
  });

  await supabase
    .from("communications")
    .update({
      body_summary: summary,
      sentiment: triage.sentiment,
      importance_score: cappedScore,
      // Stored as the gate's answer, not triage's raw flag. The daily brief and
      // the follow-up insights read this column, so a bank alert whose "report
      // it if this wasn't you" line triage took for an action - blocked as a
      // task - still reached the brief as an email needing action.
      requires_action: categoryAllowsTask,
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
    text: `${comm.subject}\n\n${summary}`,
    metadata: {
      occurred_at: comm.occurred_at,
      entities: triage.entities_mentioned,
      contact_email: senderEmail,
    },
  });

  await updateCommunicationEmbedding(communicationId, summary);

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

  // Newsletters, promotions and the like effectively never contain a real
  // commitment, but a triage that flags one as requiring action still paid for
  // an extraction call. Their importance is already capped at 0.3 above, which
  // is what keeps them from creating tasks.
  //
  // A commitment is something the user promised, so it can only appear in mail
  // the user sent. Every ingested message is inbound today, which is why 317
  // eligible emails produced zero commitments: the extraction was running on
  // other people's words. Gate on direction regardless of FEATURES.commitments
  // - this is the right condition even once sent mail is ingested.
  const worthExtractingCommitments =
    FEATURES.commitments &&
    comm.direction === "outbound" &&
    !LOW_SIGNAL_CATEGORIES.has(triage.email_category);

  if (triage.requires_action && comm.body && !existingCommitments && worthExtractingCommitments) {
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

  // Two distinct checks, which the single source_id count used to conflate.
  //
  // Same email, any status: idempotency. A reprocess (body reparse, reconcile
  // pass, retried job) must not add a second copy even if the first was
  // already completed.
  const { count: sameEmailTasks } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source_type", "email")
    .eq("source_id", communicationId);

  // Same thread, still open: grouping. Tasks were keyed on a single
  // communication, so every reply in a thread produced its own - one
  // Investment Memo thread yielded 8 tasks ("Follow up with Jatin",
  // "Response required regarding differentiation", "Consider investing in the
  // proposed products") for what is one conversation restated.
  //
  // Only open tasks block: once the founder has completed or dismissed the
  // thread's task, a genuinely new ask later in the same thread should be able
  // to create another. Skipping rather than updating the existing task keeps
  // anything already acted on intact, matching how commitments behave.
  //
  // Threads are short, so resolving sibling ids avoids adding thread_id to
  // tasks and backfilling it.
  let openThreadTasks = 0;
  if (comm.thread_id) {
    const { data: siblings } = await supabase
      .from("communications")
      .select("id")
      .eq("user_id", userId)
      .eq("thread_id", comm.thread_id);

    const siblingIds = (siblings ?? []).map((r: { id: string }) => r.id).filter((id) => id !== communicationId);
    if (siblingIds.length > 0) {
      const { count } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("source_type", "email")
        .in("source_id", siblingIds)
        .in("status", ["pending", "snoozed"]);
      openThreadTasks = count ?? 0;
    }
  }

  // Same sender, still open, same ask: separate threads restating one thing.
  // PolicyBazaar sent nine "renew your i20 insurance" countdowns, each its own
  // thread, and every one became a task. Skips rather than updates, as above.
  //
  // A company's reminder is also compared with open tasks from any sender:
  // PolicyBazaar and Tata AIG chased the same Hyundai renewal from separate
  // addresses. People are left to the same-sender check - two people asking
  // for "the deck" are two asks.
  const taskTitle = triage.action_description ?? `Reply to: ${comm.subject}`;
  const company = !isPersonalSender(senderEmail);
  let openSenderDuplicate = false;
  if (comm.contact_id || company) {
    let open = supabase.from("tasks").select("title, source_id").eq("user_id", userId).in("status", ["pending", "snoozed"]);
    if (!company) open = open.eq("contact_id", comm.contact_id);
    const { data: openTasks } = await open;
    openSenderDuplicate = (openTasks ?? []).some((t: { title: string }) => isSimilarTaskTitle(t.title, taskTitle));

    // A person's conversation under a new subject line ("Indian Express SEO",
    // then "... - Doc 2") is the same conversation: one open task for it.
    const sourceIds = (openTasks ?? []).map((t: { source_id: string | null }) => t.source_id).filter(Boolean);
    if (!company && !openSenderDuplicate && sourceIds.length && comm.subject) {
      const { data: sources } = await supabase.from("communications").select("subject").in("id", sourceIds);
      const here = conversationSubject(comm.subject);
      openSenderDuplicate = (sources ?? []).some((s: { subject: string | null }) => !!s.subject && conversationSubject(s.subject) === here);
    }
  }

  const alreadyTracked = (sameEmailTasks ?? 0) > 0 || openThreadTasks > 0 || openSenderDuplicate;

  if (categoryAllowsTask && !alreadyTracked) {
    let priority = taskPriority({ title: taskTitle, importance: cappedScore, senderEmail, isBulk, isFinancialDomain: isKnownFinancialDomain(senderEmail) });
    let learned = "";
    // Learning from the founder's own clicks, not a trained model: if they
    // dismissed two or more of this company's tasks in the last 30 days and
    // completed none, the next one starts low and says why. People and money
    // owed are never demoted. Automatic closures are "expired", not
    // "dismissed", so they do not count.
    if (company && comm.contact_id && priority !== "low" && !owesMoney(taskTitle)) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase.from("tasks").select("status")
        .eq("user_id", userId).eq("contact_id", comm.contact_id).in("status", ["dismissed", "done"]).gte("updated_at", since);
      const dismissed = (recent ?? []).filter((t: { status: string }) => t.status === "dismissed").length;
      if (dismissed >= 2 && !(recent ?? []).some((t: { status: string }) => t.status === "done")) {
        priority = "low";
        learned = `Low: you dismissed ${dismissed} recent tasks from this sender. `;
      }
    }
    await supabase.from("tasks").insert({
      user_id: userId,
      title: taskTitle,
      source_type: "email",
      source_id: communicationId,
      contact_id: comm.contact_id,
      due_date: resolveFollowUpDeadline(triage.follow_up_deadline, comm.occurred_at),
      priority,
      ai_reasoning: `Importance: ${cappedScore.toFixed(2)}. ${learned}${summary}`,
    });
  }

  await enqueueOperationalState(userId);
}

// A statement or receipt can legitimately reference a transaction from a prior
// billing cycle, so this is deliberately generous - it only catches dates that
// are wrong by years, not by weeks.
const MAX_BACKDATE_MS = 90 * 24 * 60 * 60 * 1000;

const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// A transaction cannot have happened in the future, but extraction sometimes
// picks up a due date, delivery date, or expiry instead. Those rows then skewed
// the finance tab and sat permanently inside the dedup window. Falls back to when
// the email actually arrived.
function resolveTransactionDatetime(
  extracted: string | null,
  occurredAt: string | null
): string | null {
  // No date extracted: fall back to arrival, as for every other bad date. A
  // null here kept the row out of every dedup window, so it never reached the
  // finance tab - 65 transactions were stranded that way.
  if (!extracted) return occurredAt;
  // Bank alerts give a local time with no zone ("19-10-2026 21:25:36") and
  // extraction passes it on as "2026-10-19T21:25:36", which was stored as UTC -
  // 5h30m late, often on the next day: 168 transactions. A time with no zone
  // is IST.
  const trimmed = extracted.trim();
  // A date with no time was stored as midnight UTC - "05:30" on 148 rows - so a
  // receipt could never match the bank alert from later that day. On the day
  // the email arrived, its arrival time is the better guess.
  const dateOnly = /^(\d{4}-\d{2}-\d{2})(?:[T ]00:00(?::00(?:\.0+)?)?)?$/.exec(trimmed)?.[1];
  if (dateOnly && occurredAt && istDay(occurredAt) === dateOnly) return occurredAt;
  if (/[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) extracted = `${trimmed.replace(" ", "T")}+05:30`;
  const parsed = new Date(extracted).getTime();
  if (Number.isNaN(parsed)) return occurredAt;

  // End of today rather than "now", so a same-day timestamp that's a few hours
  // ahead from timezone handling isn't needlessly rewritten.
  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);
  if (parsed > endOfToday.getTime()) return occurredAt;

  // Indian bank alerts write dates as DD-MM-YY ("22-08-26" = 22 Aug 2026), and
  // extraction sometimes reads that as YY-MM-DD, landing the transaction years
  // in the past - 16 of 180 rows on first ingestion. A transactional alert
  // arrives within hours of the event, so a date long before the email is
  // wrong; fall back to when the email actually arrived.
  if (occurredAt) {
    const arrived = new Date(occurredAt).getTime();
    if (!Number.isNaN(arrived) && parsed < arrived - MAX_BACKDATE_MS) {
      return occurredAt;
    }
  }

  return extracted;
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
  const extraction = await extractFinancialTransaction(senderEmail, senderType, subject, body, occurredAt);

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

  // Known aliases win and wallets are never the merchant; see resolveMerchant.
  const merchantRaw = raw?.merchant_name?.trim() || null;
  const merchantNormalized = resolveMerchant({
    extractedName: merchantRaw,
    extractedNormalized: raw?.merchant_normalized,
    senderDomain,
    bankName: raw?.bank_name,
  });
  const paymentMethod = walletLabel ?? raw?.payment_method ?? null;
  const category = merchantNormalized
    ? (getCategoryForMerchant(merchantNormalized) ?? raw?.category ?? null)
    : (raw?.category ?? null);

  // Accept LLM sender_type only for types the deterministic engine doesn't classify
  const LLM_ONLY_SENDER_TYPES = new Set(["INSURANCE_PROVIDER", "TRAVEL_PROVIDER", "SUBSCRIPTION_PROVIDER"]);
  const resolvedSenderType = LLM_ONLY_SENDER_TYPES.has(raw?.sender_type ?? "")
    ? raw!.sender_type!
    : senderType;

  const transactionDatetime = resolveTransactionDatetime(raw?.transaction_datetime ?? null, occurredAt);

  // See isShippingUpdate. An update sharing an order ID with another email
  // stays "completed": the order rule already joins it, and a delivered total
  // can be the final amount.
  const shipping = raw?.event_kind === "completed" && isShippingUpdate(subject)
    && !(await sharesOrderId(supabase, userId, communicationId, [raw?.transaction_id, raw?.reference_id]));
  const eventKind = shipping ? "shipping" : (raw?.event_kind ?? null);

  await (supabase.from as any)("transactions_raw").upsert(
    {
      user_id: userId,
      communication_id: communicationId,
      is_financial_email: extraction.is_financial_email,
      confidence: extraction.confidence,
      transaction_type: resolveTransactionType(raw?.transaction_type, merchantNormalized),
      category,
      amount: raw?.amount ?? null,
      currency: raw?.currency ?? "INR",
      merchant_name: merchantRaw,
      merchant_normalized: merchantNormalized,
      bank_name: raw?.bank_name ?? null,
      payment_method: paymentMethod,
      transaction_datetime: transactionDatetime,
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
      event_kind: eventKind,
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

  // Only money that moved becomes a transaction. A bill due, renewal quote or
  // statement stays as a raw row for reference but is never normalized.
  if (!needsReview && transactionDatetime && eventKind === "completed") {
    await runDedup(supabase, userId, transactionDatetime, [raw?.transaction_id, raw?.reference_id]);
  } else if (!needsReview && transactionDatetime && shipping) {
    await countShippingIfUnpaid(supabase, userId, communicationId, {
      merchant_normalized: merchantNormalized, amount: raw?.amount ?? null, transaction_datetime: transactionDatetime,
    });
  }
}

const orderIdsOf = (values: (string | null | undefined)[]) =>
  [...new Set(values.map((v) => v?.trim()).filter((v): v is string => !!v && v.length >= 6))];
const quoteIds = (ids: string[]) => ids.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",");

async function sharesOrderId(supabase: any, userId: string, communicationId: string, values: (string | null | undefined)[]): Promise<boolean> {
  const ids = orderIdsOf(values);
  if (!ids.length) return false;
  const { data, error } = await supabase
    .from("transactions_raw")
    .select("id")
    .eq("user_id", userId)
    .neq("communication_id", communicationId)
    .or(`transaction_id.in.(${quoteIds(ids)}),reference_id.in.(${quoteIds(ids)})`)
    .limit(1);
  if (error) throw new Error(`[shipping] order lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

// The only record of a purchase still counts: a Myntra order whose
// confirmation never reached the inbox shows up only as "out for delivery".
async function countShippingIfUnpaid(
  supabase: any,
  userId: string,
  communicationId: string,
  shipping: { merchant_normalized: string | null; amount: number | null; transaction_datetime: string }
) {
  const at = new Date(shipping.transaction_datetime).getTime();
  const { data: candidates, error } = await supabase
    .from("transactions_normalized")
    .select("merchant_normalized, amount, transaction_datetime")
    .eq("user_id", userId)
    .gte("transaction_datetime", new Date(at - 14 * 24 * 60 * 60 * 1000).toISOString())
    .lte("transaction_datetime", new Date(at + 60 * 60 * 1000).toISOString());
  if (error) throw new Error(`[shipping] payment lookup failed: ${error.message}`);
  if ((candidates ?? []).some((p: any) => isPaymentForShipping(p, shipping))) return;

  const { data: row } = await supabase.from("transactions_raw").select("*").eq("communication_id", communicationId).single();
  if (row) await saveNormalizedGroups(supabase, userId, deduplicateRawTransactions([row as TransactionRaw]));
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// The window is centred on the transaction just extracted, not on now. Anchored
// on now, anything processed more than a day after it happened - every
// backfill and reprocess - fell outside the window and was never normalized:
// 135 transactions were missing from the finance tab.
async function runDedup(supabase: any, userId: string, anchor: string, orderIds: (string | null | undefined)[] = []) {
  const at = new Date(anchor).getTime();
  const from = new Date(at - DEDUP_WINDOW_MS).toISOString();
  // Capped at now: extraction sometimes picks up a due or delivery date, and a
  // future-dated row would otherwise join every window.
  const to = new Date(Math.min(at + DEDUP_WINDOW_MS, Date.now())).toISOString();

  const { data: rawRows, error } = await supabase
    .from("transactions_raw")
    .select("*")
    .eq("user_id", userId)
    .eq("is_financial_email", true)
    .eq("needs_review", false)
    .eq("event_kind", "completed")
    .gte("transaction_datetime", from)
    .lte("transaction_datetime", to);
  if (error) throw new Error(`[dedup] raw scan failed: ${error.message}`);

  // The window misses an order's earlier emails - "delivered" arrives days
  // after "placed" - so also fetch rows sharing this transaction's order IDs.
  const ids = [...new Set(orderIds.map((v) => v?.trim()).filter((v): v is string => !!v && v.length >= 6))];
  let orderRows: any[] = [];
  if (ids.length) {
    const quoted = ids.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",");
    const { data, error: orderErr } = await supabase
      .from("transactions_raw")
      .select("*")
      .eq("user_id", userId)
      .eq("is_financial_email", true)
      .eq("needs_review", false)
      .eq("event_kind", "completed")
      .or(`transaction_id.in.(${quoted}),reference_id.in.(${quoted})`);
    if (orderErr) throw new Error(`[dedup] order scan failed: ${orderErr.message}`);
    orderRows = data ?? [];
  }

  const rows = [...new Map([...(rawRows ?? []), ...orderRows].map((r) => [r.id, r])).values()];
  if (!rows.length) return;
  await saveNormalizedGroups(supabase, userId, deduplicateRawTransactions(rows as TransactionRaw[]));
}
