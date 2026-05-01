import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { addDays, subDays } from "date-fns";

import { processFinance } from "@/lib/ai/processors/finance";
import { processTasks } from "@/lib/ai/processors/tasks";
import { processFollowUps } from "@/lib/ai/processors/followup";
import { processCommitments } from "@/lib/ai/processors/commitments";
import { processScheduling } from "@/lib/ai/processors/scheduling";
import { processRelationships } from "@/lib/ai/processors/relationships";
import { processSubscriptions } from "@/lib/ai/processors/subscriptions";
import { processBills } from "@/lib/ai/processors/bills";
import { synthesizeInsights } from "@/lib/ai/processors/synthesis";
import { consolidateInsights } from "@/lib/ai/processors/consolidate";
import { rankInsights } from "@/lib/ai/processors/rank";
import type { ProcessorInsight } from "@/lib/ai/processors/types";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function computeOperationalState(job: Job) {
  const supabase = getSupabase();
  const { userId } = job.data as { userId: string };

  const now = new Date();
  const past30d = subDays(now, 30).toISOString();
  const past60d = subDays(now, 60).toISOString();
  const past7d = subDays(now, 7).toISOString();
  const past180d = subDays(now, 180).toISOString();
  const next14d = addDays(now, 14).toISOString();
  const next30d = addDays(now, 30).toISOString();

  // Fetch all raw data in parallel
  const [
    tasksRes,
    commitmentsRes,
    meetingsRes,
    relationshipsRes,
    contactsRes,
    transactionsRes,
    priorTransactionsRes,
    recurringTxnsRes,
    actionableEmailsRes,
    negativeEmailsRes,
    billEmailsRes,
    subscriptionEmailsRes,
    travelEmailsRes,
    billTxnsRes,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, description, due_date, priority, status, updated_at, ai_reasoning")
      .eq("user_id", userId)
      .in("status", ["pending", "snoozed"])
      .order("due_date", { nullsFirst: false }),

    supabase
      .from("commitments")
      .select("id, description, due_date, status, to_contact_id, contacts(name, email)")
      .eq("user_id", userId)
      .in("status", ["pending", "overdue"]),

    supabase
      .from("meetings")
      .select("id, title, start_time, end_time, attendees")
      .eq("user_id", userId)
      .gte("start_time", subDays(now, 7).toISOString())
      .lte("start_time", next14d)
      .order("start_time"),

    supabase
      .from("relationships")
      .select("id, category, health_score, follow_up_due, contacts(id, name, email)")
      .eq("user_id", userId)
      .order("follow_up_due"),

    supabase
      .from("contacts")
      .select("id, name, email, organization, importance_score, last_interaction_at, interaction_count")
      .eq("user_id", userId)
      .gte("importance_score", 0.5),

    supabase
      .from("transactions_normalized")
      .select("id, amount, currency, merchant_normalized, category, transaction_type, transaction_datetime, is_recurring, status")
      .eq("user_id", userId)
      .gte("transaction_datetime", past30d)
      .order("transaction_datetime", { ascending: false })
      .limit(150),

    supabase
      .from("transactions_normalized")
      .select("id, amount, currency, merchant_normalized, category, transaction_type, transaction_datetime, is_recurring, status")
      .eq("user_id", userId)
      .gte("transaction_datetime", past60d)
      .lt("transaction_datetime", past30d)
      .order("transaction_datetime", { ascending: false })
      .limit(150),

    supabase
      .from("transactions_normalized")
      .select("id, amount, currency, merchant_normalized, category, transaction_datetime, is_recurring, recurring_frequency")
      .eq("user_id", userId)
      .eq("is_recurring", true)
      .gte("transaction_datetime", past180d)
      .order("transaction_datetime", { ascending: false })
      .limit(200),

    supabase
      .from("communications")
      .select("id, subject, body_summary, occurred_at, sentiment, requires_action, action_taken, email_category, contact_id, contacts(name, email)")
      .eq("user_id", userId)
      .eq("requires_action", true)
      .eq("action_taken", false)
      .order("occurred_at", { ascending: false })
      .limit(50),

    supabase
      .from("communications")
      .select("id, subject, body_summary, occurred_at, sentiment, requires_action, action_taken, email_category, contact_id, contacts(name, email)")
      .eq("user_id", userId)
      .eq("sentiment", "negative")
      .gte("occurred_at", past30d)
      .order("occurred_at", { ascending: false })
      .limit(30),

    supabase
      .from("communications")
      .select("id, subject, body_summary, occurred_at, sentiment, requires_action, action_taken, email_category, contact_id, contacts(name, email)")
      .eq("user_id", userId)
      .eq("email_category", "finance_bills")
      .gte("occurred_at", subDays(now, 45).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(30),

    supabase
      .from("communications")
      .select("id, subject, body_summary, occurred_at, sentiment, requires_action, action_taken, email_category, contact_id")
      .eq("user_id", userId)
      .eq("email_category", "subscriptions_memberships")
      .gte("occurred_at", subDays(now, 30).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(20),

    supabase
      .from("communications")
      .select("id, subject, body_summary, occurred_at, sentiment, requires_action, action_taken, email_category, contact_id")
      .eq("user_id", userId)
      .eq("email_category", "travel")
      .gte("occurred_at", now.toISOString())
      .lte("occurred_at", next30d)
      .order("occurred_at")
      .limit(20),

    supabase
      .from("transactions_normalized")
      .select("id, amount, currency, merchant_normalized, transaction_type, transaction_datetime")
      .eq("user_id", userId)
      .in("transaction_type", ["bill_payment", "emi", "utility_payment"])
      .gte("transaction_datetime", past7d)
      .order("transaction_datetime", { ascending: false })
      .limit(20),
  ]);

  const tasks = tasksRes.data ?? [];
  const commitments = commitmentsRes.data ?? [];
  const meetings = meetingsRes.data ?? [];
  const relationships = relationshipsRes.data ?? [];
  const contacts = contactsRes.data ?? [];
  const transactions = transactionsRes.data ?? [];
  const priorTransactions = priorTransactionsRes.data ?? [];
  const recurringTxns = recurringTxnsRes.data ?? [];
  const actionableEmails = actionableEmailsRes.data ?? [];
  const negativeEmails = negativeEmailsRes.data ?? [];
  const billEmails = billEmailsRes.data ?? [];
  const subscriptionEmails = subscriptionEmailsRes.data ?? [];
  const billTxns = billTxnsRes.data ?? [];

  // Run all processors
  const allCommunications = [
    ...actionableEmails,
    ...negativeEmails,
  ].filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);

  const processorInsights: ProcessorInsight[][] = [
    processFinance(transactions as any, priorTransactions as any),
    processTasks(tasks as any),
    processCommitments(commitments as any),
    processFollowUps(relationships as any, allCommunications as any, contacts as any),
    processScheduling(meetings as any),
    processRelationships(relationships as any, contacts as any, allCommunications as any),
    processSubscriptions(recurringTxns as any, subscriptionEmails as any),
    processBills(billEmails as any, billTxns as any),
  ];

  const flat = processorInsights.flat();

  // Cross-processor synthesis
  const compound = synthesizeInsights(flat);
  const allInsights = [...flat, ...compound];

  // Deduplicate and consolidate
  const consolidated = consolidateInsights(allInsights);

  // Determine which state_keys are still active (current run produced them)
  const currentStateKeys = new Set(consolidated.map((i) => i.state_key));

  // Upsert active insights
  for (const insight of consolidated) {
    await supabase.from("operational_insights").upsert(
      {
        user_id: userId,
        state_key: insight.state_key,
        category: insight.category,
        insight_type: insight.insight_type,
        title: insight.title,
        summary: insight.summary,
        recommended_action: insight.recommended_action,
        entities: insight.entities,
        source_refs: insight.source_refs,
        priority_score: insight.priority_score,
        urgency: insight.urgency,
        status: "active",
        last_seen_at: now.toISOString(),
        expires_at: insight.expires_at,
        confidence: insight.confidence,
        source_count: insight.source_count,
        generated_by: insight.generated_by,
        explanation: insight.explanation,
        metadata: insight.metadata,
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,state_key" }
    );
  }

  // Resolve insights that are no longer relevant (were active but not produced this run)
  const { data: existingActive } = await supabase
    .from("operational_insights")
    .select("state_key")
    .eq("user_id", userId)
    .eq("status", "active");

  const toResolve = (existingActive ?? [])
    .filter((row) => !currentStateKeys.has(row.state_key))
    .map((row) => row.state_key);

  if (toResolve.length > 0) {
    await supabase
      .from("operational_insights")
      .update({ status: "resolved", resolved_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("user_id", userId)
      .in("state_key", toResolve);
  }

  // Expire stale insights
  await supabase
    .from("operational_insights")
    .update({ status: "resolved", resolved_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("status", "active")
    .lt("expires_at", now.toISOString());

  console.log(`[compute-operational-state] ${userId}: ${consolidated.length} insights upserted, ${toResolve.length} resolved`);
}
