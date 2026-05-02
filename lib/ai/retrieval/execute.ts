import { searchMemory } from "@/lib/memory/search";
import type { RetrievalStep } from "./types";

const MAX_QUERY_BUDGET_MS = 1200;

export type RawResults = {
  sql_transactions?: any[];
  sql_communications?: any[];
  sql_meetings?: any[];
  sql_commitments?: any[];
  sql_tasks?: any[];
  vector_search?: any[];
  operational_insights?: any[];
};

export interface ExecuteResult {
  rawResults: RawResults;
  sourceStatuses: { source: string; count: number; success: boolean }[];
  budgetExhausted: boolean;
}

export async function executeRetrievalPlan(
  plan: RetrievalStep[],
  userId: string,
  query: string,
  supabase: any
): Promise<ExecuteResult> {
  // Sort by priority (1=highest), then enforce budget
  const sorted = [...plan].sort((a, b) => a.priority - b.priority);

  const budgeted: RetrievalStep[] = [];
  let accumulated = 0;
  let budgetExhausted = false;

  for (const s of sorted) {
    if (accumulated + s.estimated_cost_ms > MAX_QUERY_BUDGET_MS) {
      budgetExhausted = true;
      break;
    }
    budgeted.push(s);
    accumulated += s.estimated_cost_ms;
  }

  // Execute all budgeted steps with allSettled — partial failure is OK
  const settled = await Promise.allSettled(
    budgeted.map((s) => executeStep(s, userId, query, supabase))
  );

  const rawResults: RawResults = {};
  const sourceStatuses: { source: string; count: number; success: boolean }[] = [];

  for (let i = 0; i < budgeted.length; i++) {
    const step = budgeted[i];
    const result = settled[i];
    if (result.status === "fulfilled") {
      const rows = result.value ?? [];
      (rawResults as any)[step.source] = rows;
      sourceStatuses.push({ source: step.source, count: rows.length, success: true });
    } else {
      (rawResults as any)[step.source] = [];
      sourceStatuses.push({ source: step.source, count: 0, success: false });
    }
  }

  return { rawResults, sourceStatuses, budgetExhausted };
}

async function executeStep(
  step: RetrievalStep,
  userId: string,
  query: string,
  supabase: any
): Promise<any[]> {
  const f = step.filters;

  switch (step.source) {
    case "sql_transactions": {
      let q = supabase
        .from("transactions_normalized")
        .select("id, merchant_normalized, amount, currency, category, transaction_datetime, transaction_type, bank_name, payment_method")
        .eq("user_id", userId)
        .order("transaction_datetime", { ascending: false })
        .limit(step.max_results);

      if (f.merchants?.length) q = q.in("merchant_normalized", f.merchants);
      if (f.transactionTypes?.length) q = q.in("transaction_type", f.transactionTypes);
      if (f.dateRange) {
        q = q.gte("transaction_datetime", f.dateRange.from).lte("transaction_datetime", f.dateRange.to);
      }
      if (f.amount) q = q.eq("amount", f.amount);

      const { data } = await q;
      return data ?? [];
    }

    case "sql_communications": {
      let q = supabase
        .from("communications")
        .select("id, subject, body_summary, occurred_at, sentiment, email_category, requires_action, contact_id, contacts(name)")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(step.max_results);

      if (f.contactIds?.length) q = q.in("contact_id", f.contactIds);
      if (f.emailCategory?.length) q = q.in("email_category", f.emailCategory);
      if (f.dateRange) {
        q = q.gte("occurred_at", f.dateRange.from).lte("occurred_at", f.dateRange.to);
      }
      // Topic filtering across subject + body_summary (case-insensitive)
      if (f.topics?.length) {
        const topicFilter = (f.topics as string[]).flatMap((t: string) => [
          `subject.ilike.%${t}%`,
          `body_summary.ilike.%${t}%`,
        ]).join(",");
        q = q.or(topicFilter);
      }

      const { data } = await q;
      return (data ?? []).map((row: any) => ({
        ...row,
        contact_name: row.contacts?.name ?? null,
      }));
    }

    case "sql_meetings": {
      let q = supabase
        .from("meetings")
        .select("id, title, start_time, executive_summary, attendees")
        .eq("user_id", userId)
        .order("start_time", { ascending: false })
        .limit(step.max_results);

      if (f.dateRange) {
        q = q.gte("start_time", f.dateRange.from).lte("start_time", f.dateRange.to);
      }

      const { data } = await q;
      return data ?? [];
    }

    case "sql_commitments": {
      let q = supabase
        .from("commitments")
        .select("id, description, due_date, status, to_contact_id, contacts(name)")
        .eq("user_id", userId)
        .not("status", "eq", "done")
        .order("due_date", { ascending: true })
        .limit(step.max_results);

      if (f.contactIds?.length) q = q.in("to_contact_id", f.contactIds);
      if (f.dateRange) {
        q = q.lte("due_date", f.dateRange.to);
      }

      const { data } = await q;
      return (data ?? []).map((row: any) => ({
        ...row,
        to_contact_name: row.contacts?.name ?? null,
      }));
    }

    case "sql_tasks": {
      let q = supabase
        .from("tasks")
        .select("id, title, status, priority, due_date, created_at")
        .eq("user_id", userId)
        .not("status", "eq", "done")
        .order("due_date", { ascending: true })
        .limit(step.max_results);

      if (f.dateRange) {
        q = q.lte("due_date", f.dateRange.to);
      }

      const { data } = await q;
      return data ?? [];
    }

    case "vector_search": {
      const chunks = await searchMemory({
        userId,
        query: (f.query as string) || query,
        matchCount: step.max_results,
        daysBack: 90,
      });
      return chunks;
    }

    case "operational_insights": {
      let q = supabase
        .from("operational_insights")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
        .order("priority_score", { ascending: false })
        .limit(step.max_results);

      if (Array.isArray(f.category) && f.category.length > 0) {
        q = q.in("category", f.category);
      }

      const { data } = await q;
      return data ?? [];
    }

    // aggregated_finance is handled separately in the route (receives raw rows from sql_transactions)
    default:
      return [];
  }
}
