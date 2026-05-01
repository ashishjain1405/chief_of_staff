import { createClient } from "@supabase/supabase-js";
import { classifySender, shouldRunStage1 } from "@/lib/finance/senders";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { normalizeMerchant, getCategoryForMerchant } from "@/lib/finance/normalize";
import { deduplicateRawTransactions, type TransactionRaw } from "@/lib/finance/dedup";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let offset = 0;
  let processed = 0;
  const BATCH = 50;

  while (true) {
    const { data: rows } = await supabase
      .from("communications")
      .select("id, user_id, subject, body, occurred_at, email_category, contacts(name, email)")
      .order("occurred_at", { ascending: false })
      .range(offset, offset + BATCH - 1);

    if (!rows || rows.length === 0) break;

    for (const comm of rows) {
      const senderEmail = (comm.contacts as any)?.email ?? "";
      const bodySnippet = (comm.body ?? "").substring(0, 500);

      if (!shouldRunStage1(comm.email_category, senderEmail, comm.subject ?? "", bodySnippet)) {
        continue;
      }

      // Skip if already extracted
      const { data: existing } = await supabase
        .from("transactions_raw")
        .select("id")
        .eq("communication_id", comm.id)
        .maybeSingle();

      if (existing) continue;

      try {
        const senderType = classifySender(senderEmail);
        const extraction = await extractFinancialTransaction(
          senderEmail,
          senderType,
          comm.subject ?? "",
          comm.body ?? ""
        );

        if (!extraction.is_financial_email && extraction.transaction?.amount == null) {
          processed++;
          console.log(`[${processed}] skip (not financial): ${comm.subject}`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        const raw = extraction.transaction;
        const needsReview =
          (!extraction.is_financial_email && raw?.amount != null) ||
          (extraction.is_financial_email && extraction.confidence < 0.5) ||
          (extraction.is_financial_email && extraction.confidence >= 0.5 && raw?.amount == null);

        const merchantRaw = raw?.merchant_name ?? null;
        const merchantNormalized = merchantRaw ? normalizeMerchant(merchantRaw) : null;
        const category = merchantNormalized
          ? (getCategoryForMerchant(merchantNormalized) ?? raw?.category ?? null)
          : (raw?.category ?? null);

        const txDatetime = raw?.transaction_datetime ?? comm.occurred_at;

        await supabase.from("transactions_raw").upsert(
          {
            user_id: comm.user_id,
            communication_id: comm.id,
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
            transaction_datetime: txDatetime,
            due_date: raw?.due_date ?? null,
            transaction_id: raw?.transaction_id ?? null,
            reference_id: raw?.reference_id ?? null,
            upi_id: raw?.upi_id ?? null,
            masked_account: raw?.masked_account ?? null,
            is_recurring: raw?.is_recurring ?? false,
            recurring_frequency: raw?.recurring_frequency ?? null,
            status: raw?.status ?? null,
            sender_type: senderType,
            raw_sender: senderEmail,
            needs_review: needsReview,
            extracted_at: new Date().toISOString(),
          },
          { onConflict: "communication_id" }
        );

        processed++;
        console.log(`[${processed}] extracted (${senderType}): ${comm.subject} → ${merchantNormalized ?? "unknown"} ${raw?.amount ?? ""}`);
      } catch (err: any) {
        console.error(`Failed ${comm.id}:`, err.message);
      }

      await new Promise((r) => setTimeout(r, 1500));
    }

    offset += BATCH;
  }

  // Run dedup per user after all extraction
  console.log("\nRunning dedup...");
  const { data: userRows } = await supabase
    .from("transactions_raw")
    .select("user_id")
    .eq("is_financial_email", true)
    .eq("needs_review", false);

  const userIds = [...new Set((userRows ?? []).map((r) => r.user_id))];

  for (const userId of userIds) {
    const { data: rawRows } = await supabase
      .from("transactions_raw")
      .select("*")
      .eq("user_id", userId)
      .eq("is_financial_email", true)
      .eq("needs_review", false);

    if (!rawRows?.length) continue;

    const normalized = deduplicateRawTransactions(rawRows as TransactionRaw[]);

    for (const norm of normalized) {
      const { data: existing } = await supabase
        .from("transactions_normalized")
        .select("id")
        .eq("user_id", userId)
        .contains("communication_ids", norm.communication_ids)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("transactions_normalized")
          .update({ ...norm, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await supabase.from("transactions_normalized").insert({
          ...norm,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    console.log(`Deduped ${normalized.length} transactions for user ${userId}`);
  }

  console.log(`\nDone. Processed ${processed} emails.`);
  process.exit(0);
}

main();
