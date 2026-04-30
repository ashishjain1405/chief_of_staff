import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = req.nextUrl.searchParams.get("period") ?? "month";

  const now = new Date();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const since = period === "week" ? weekAgo : period === "all" ? sixMonthsAgo : monthAgo;

  const { data: rows } = await supabase
    .from("communications")
    .select("id, subject, occurred_at, channel_metadata, email_category")
    .eq("user_id", user.id)
    .in("email_category", ["finance_bills", "transactions"])
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(500);

  const all = (rows ?? []).filter((r) => (r.channel_metadata as any)?.fin_amount != null);

  const weeklyRows = all.filter((r) => r.occurred_at >= weekAgo);
  const monthlyRows = all.filter((r) => r.occurred_at >= monthAgo);

  const weekly_total = weeklyRows.reduce((s, r) => s + ((r.channel_metadata as any).fin_amount ?? 0), 0);
  const monthly_total = monthlyRows.reduce((s, r) => s + ((r.channel_metadata as any).fin_amount ?? 0), 0);

  // Group by sub_category
  const bySubCat: Record<string, number> = {};
  for (const r of monthlyRows) {
    const meta = r.channel_metadata as any;
    const sub = meta.fin_sub_category ?? "other";
    bySubCat[sub] = (bySubCat[sub] ?? 0) + (meta.fin_amount ?? 0);
  }

  // Month-over-month: last 6 months
  const monthly: Record<string, number> = {};
  for (const r of all) {
    const month = r.occurred_at.substring(0, 7); // "YYYY-MM"
    const meta = r.channel_metadata as any;
    monthly[month] = (monthly[month] ?? 0) + (meta.fin_amount ?? 0);
  }

  const transactions = all.slice(0, 200).map((r) => {
    const meta = r.channel_metadata as any;
    return {
      id: r.id,
      subject: r.subject,
      occurred_at: r.occurred_at,
      category: r.email_category,
      merchant: meta.fin_merchant,
      amount: meta.fin_amount,
      currency: meta.fin_currency ?? "INR",
      sub_category: meta.fin_sub_category,
    };
  });

  return NextResponse.json({
    weekly_total,
    monthly_total,
    by_subcategory: bySubCat,
    monthly_trend: monthly,
    transactions,
  });
}
