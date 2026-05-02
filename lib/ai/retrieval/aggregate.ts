import type { AggregatedFinance } from "./types";

export async function aggregateTransactions(
  userId: string,
  filters: {
    dateRange?: { from: string; to: string } | null;
    categories?: string[];
    merchantNames?: string[];
  },
  supabase: any
): Promise<AggregatedFinance> {
  let query = (supabase as any)
    .from("transactions_normalized")
    .select("amount, category, merchant_normalized, transaction_datetime")
    .eq("user_id", userId)
    .not("amount", "is", null);

  if (filters.dateRange) {
    query = query
      .gte("transaction_datetime", filters.dateRange.from)
      .lte("transaction_datetime", filters.dateRange.to);
  } else {
    // Default: last 30 days
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    query = query.gte("transaction_datetime", since);
  }

  if (filters.categories?.length) {
    query = query.in("category", filters.categories);
  }

  if (filters.merchantNames?.length) {
    query = query.in("merchant_normalized", filters.merchantNames);
  }

  let { data, error } = await query.limit(500);

  // Retry without category filter if over-specific filter returned nothing
  if (!error && !data?.length && filters.categories?.length) {
    let retryQuery = supabase
      .from("transactions_normalized")
      .select("amount, category, merchant_normalized, transaction_datetime")
      .eq("user_id", userId)
      .not("amount", "is", null);
    if (filters.dateRange) {
      retryQuery = retryQuery
        .gte("transaction_datetime", filters.dateRange.from)
        .lte("transaction_datetime", filters.dateRange.to);
    } else {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      retryQuery = retryQuery.gte("transaction_datetime", since);
    }
    if (filters.merchantNames?.length) {
      retryQuery = retryQuery.in("merchant_normalized", filters.merchantNames);
    }
    const { data: retryData, error: retryError } = await retryQuery.limit(500);
    if (!retryError) data = retryData;
  }

  const periodLabel = filters.dateRange
    ? `${filters.dateRange.from.slice(0, 10)} to ${filters.dateRange.to.slice(0, 10)}`
    : "last 30 days";

  if (error || !data?.length) {
    return { total: 0, by_category: {}, by_merchant: {}, weekly_trend: [], period: periodLabel, transaction_count: 0 };
  }

  const rows = data as { amount: number; category: string | null; merchant_normalized: string | null; transaction_datetime: string | null }[];

  const by_category: Record<string, number> = {};
  const by_merchant: Record<string, number> = {};
  const by_week: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    total += row.amount;

    const cat = row.category ?? "other";
    by_category[cat] = (by_category[cat] ?? 0) + row.amount;

    const merchant = row.merchant_normalized ?? "Unknown";
    by_merchant[merchant] = (by_merchant[merchant] ?? 0) + row.amount;

    if (row.transaction_datetime) {
      const d = new Date(row.transaction_datetime);
      // Week key: Monday of that week
      const day = d.getDay();
      const monday = new Date(d.getTime() - ((day === 0 ? 6 : day - 1) * 864e5));
      const weekKey = monday.toISOString().slice(0, 10);
      by_week[weekKey] = (by_week[weekKey] ?? 0) + row.amount;
    }
  }

  const weekly_trend = Object.entries(by_week)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, wTotal]) => ({ week, total: Math.round(wTotal) }));

  return {
    total: Math.round(total),
    by_category: Object.fromEntries(Object.entries(by_category).map(([k, v]) => [k, Math.round(v)])),
    by_merchant: Object.fromEntries(Object.entries(by_merchant).map(([k, v]) => [k, Math.round(v)])),
    weekly_trend,
    period: periodLabel,
    transaction_count: rows.length,
  };
}
