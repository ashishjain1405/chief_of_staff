import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = req.nextUrl.searchParams.get("period") ?? "month";

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const since = period === "week" ? weekAgo : period === "all" ? sixMonthsAgo : monthAgo;

  const { data: rows } = await supabase
    .from("transactions_normalized")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "failed")
    .gte("transaction_datetime", since)
    .order("transaction_datetime", { ascending: false })
    .limit(500);

  const all = rows ?? [];

  const weeklyRows = all.filter((r) => r.transaction_datetime >= weekAgo);
  const monthlyRows = all.filter((r) => r.transaction_datetime >= monthAgo);

  const weekly_total = weeklyRows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const monthly_total = monthlyRows.reduce((s, r) => s + (r.amount ?? 0), 0);

  const bySubCat: Record<string, number> = {};
  for (const r of monthlyRows) {
    const cat = r.category ?? "other";
    bySubCat[cat] = (bySubCat[cat] ?? 0) + (r.amount ?? 0);
  }

  const monthly: Record<string, number> = {};
  for (const r of all) {
    const month = (r.transaction_datetime as string).substring(0, 7);
    monthly[month] = (monthly[month] ?? 0) + (r.amount ?? 0);
  }

  const transactions = all.slice(0, 200).map((r) => ({
    id: r.id,
    communication_ids: r.communication_ids,
    occurred_at: r.transaction_datetime,
    merchant: r.merchant_normalized,
    amount: r.amount,
    currency: r.currency ?? "INR",
    category: r.category,
  }));

  return NextResponse.json({
    weekly_total,
    monthly_total,
    by_subcategory: bySubCat,
    monthly_trend: monthly,
    transactions,
  });
}
