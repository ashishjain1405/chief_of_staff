export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { countsAsSpend, isFailedTransaction, spendAmount } from "@/lib/finance/spend";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CalendarDays, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { StatTile } from "@/components/finance/stat-tile";
import { ColumnChart, ChartTable, type Column } from "@/components/finance/column-chart";
import { TransactionsTable } from "@/components/finance/transactions-table";
import type { TransactionRow } from "@/components/finance/types";
import { categoryLabel, inr, istDate, merchantLabel } from "@/components/finance/labels";
import { matchesFor, type Rule, type UserCategory } from "@/lib/finance/rules";

// Columns past these fold into "Other" (fewer on phones, where seven labels
// clip); the table view under the chart keeps every category.
const CATEGORY_COLUMNS = { phone: 3, wide: 6 };

const IST = "Asia/Kolkata";
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });

// "This Month" was the last 30 days and "This Week" the last 7, so on 21 Oct
// the month card showed Rs 2.56 lakh against Rs 1.16 lakh since 1 October, and
// Ask AI's "this month" (the calendar month) disagreed with it. Calendar
// periods in IST: the 1st of the month and Monday of this week, from midnight.
function periodStarts(now = new Date()) {
  const today = istDay(now);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 864e5).toISOString();
  const midnight = Date.parse(`${today}T00:00:00+05:30`);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return {
    month: new Date(Date.parse(`${today.slice(0, 8)}01T00:00:00+05:30`)).toISOString(),
    week: new Date(midnight - weekday * 864e5).toISOString(),
    sixMonthsAgo,
    monthKey: today.slice(0, 7),
  };
}

// PostgREST returns at most 1,000 rows, and the page asked for 500 - at 498
// rows the oldest months were about to fall off the trend unannounced.
async function loadSince(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, since: string) {
  const PAGE = 1000;
  const rows: TransactionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions_normalized")
      .select("*")
      .eq("user_id", userId)
      .gte("transaction_datetime", since)
      .order("transaction_datetime", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    rows.push(...(data as TransactionRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; other?: string }>;
}) {
  const { cat, other } = await searchParams;
  // "Other" folds every category past the first N columns; ?other=N filters to those.
  const top = Object.values(CATEGORY_COLUMNS).find((n) => String(n) === other) ?? null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { month: monthStart, week: weekStart, sixMonthsAgo, monthKey: thisMonthKey } = periodStarts();
  const after = (r: TransactionRow, start: string) => Date.parse(r.transaction_datetime) >= Date.parse(start);

  const [rows, { data: ruleRows }, { data: categoryRows }] = await Promise.all([
    loadSince(supabase, user.id, sixMonthsAgo),
    supabase.from("transaction_rules").select("id, match_type, match_key, label, category, counted").eq("user_id", user.id).order("created_at"),
    supabase.from("user_categories").select("id, key, label").eq("user_id", user.id),
  ]);
  const rules = (ruleRows ?? []) as Rule[];
  const categories = (categoryRows ?? []) as UserCategory[];
  const names = Object.fromEntries(categories.map((c) => [c.key, c.label]));
  // How many transactions share each merchant or UPI payee, for "This and all
  // BookMyShow transactions (6 so far)", and are in each category.
  const counts: Record<string, number> = {};
  const add = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  for (const r of rows) {
    for (const m of matchesFor(r, merchantLabel)) add(`${m.type}:${m.key}`);
    if (r.category) add(`category:${r.category}`);
  }

  // Failed attempts are dropped here rather than in SQL, where != also drops NULL.
  const all = rows.filter((r) => !isFailedTransaction(r));
  // Totals and charts count spending only; the list below still shows every row.
  const spend = all.filter(countsAsSpend);

  const monthSpend = spend.filter((r) => after(r, monthStart));
  const weekly_total = spend
    .filter((r) => after(r, weekStart))
    .reduce((s, r) => s + spendAmount(r), 0);
  const monthly_total = monthSpend.reduce((s, r) => s + spendAmount(r), 0);
  const monthCount = all.filter((r) => after(r, monthStart)).length;

  // A transaction with no category is Uncategorised, in the chart and the filter alike.
  const categoryOf = (r: TransactionRow) => r.category ?? "unknown";
  const byCat: Record<string, number> = {};
  for (const r of monthSpend) {
    const c = categoryOf(r);
    byCat[c] = (byCat[c] ?? 0) + spendAmount(r);
  }

  const monthlyTrend: Record<string, number> = {};
  for (const r of spend) {
    const month = istDay(new Date(r.transaction_datetime)).substring(0, 7);
    monthlyTrend[month] = (monthlyTrend[month] ?? 0) + spendAmount(r);
  }

  const largestSpend = monthSpend.reduce((max, r) => Math.max(max, spendAmount(r)), 0);
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const sortedMonths = Object.entries(monthlyTrend).sort((a, b) => a[0].localeCompare(b[0]));

  const otherCats = top && sortedCats.length > top ? new Set(sortedCats.slice(top).map(([c]) => c)) : null;
  const filtered = otherCats ? all.filter((r) => otherCats.has(categoryOf(r)))
    : cat ? all.filter((r) => categoryOf(r) === cat) : all;
  const filtering = !!(otherCats || cat);
  const filterLabel = otherCats ? `Other · ${otherCats.size} ${otherCats.size === 1 ? "category" : "categories"}`
    : cat ? categoryLabel(cat, names) : undefined;

  // Presentation only: shape the computed totals into chart columns.
  const categoryColumns = (count: number): Column[] => {
    const head = sortedCats.slice(0, count);
    const tail = sortedCats.slice(count).reduce((sum, [, v]) => sum + v, 0);
    const otherActive = !!otherCats && top === count;
    return [
      ...head.map(([c, value]) => ({
        key: c,
        label: categoryLabel(c, names),
        value,
        href: cat === c ? "/finance" : `/finance?cat=${c}`,
        tone: filtering ? (cat === c ? ("accent" as const) : ("soft" as const)) : ("default" as const),
      })),
      ...(tail > 0 ? [{
        key: "__other",
        label: "Other",
        value: tail,
        href: otherActive ? "/finance" : `/finance?other=${count}`,
        tone: filtering ? (otherActive ? ("accent" as const) : ("soft" as const)) : ("default" as const),
      }] : []),
    ];
  };
  const allCategoryRows: Column[] = sortedCats.map(([c, value]) => ({ key: c, label: categoryLabel(c, names), value }));
  const trendColumns: Column[] = sortedMonths.map(([m, value]) => ({
    key: m,
    label: new Date(`${m}-01T00:00:00+05:30`).toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" }),
    value,
    tone: m === thisMonthKey ? "accent" : "soft",
  }));

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/70 dark:bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finance</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your spending this month, with six months of history.
            </p>
          </div>
          <Link
            href="/inbox?cat=finance_bills"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            View in inbox
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </header>

        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="This month at a glance">
          <StatTile icon={Wallet} label="This month" value={inr(monthly_total)} caption={`Since ${istDate(monthStart)}`} />
          <StatTile icon={CalendarDays} label="This week" value={inr(weekly_total)} caption={`Since ${istDate(weekStart, { weekday: "short", day: "numeric", month: "short" })}`} />
          <StatTile icon={ReceiptText} label="Transactions" value={monthCount.toLocaleString("en-IN")} caption="This month, including transfers and bills" />
          <StatTile icon={TrendingUp} label="Largest spend" value={inr(largestSpend)} caption="Single transaction this month" />
        </section>

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm lg:col-span-3">
            <h2 className="text-base font-semibold text-foreground">Spend by category</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">This month · select a column to filter the transactions below</p>
            <div className="mt-6">
              {sortedCats.length > 0 ? (
                <>
                  <div className="sm:hidden">
                    <ColumnChart columns={categoryColumns(CATEGORY_COLUMNS.phone)} label="Spending by category this month" />
                  </div>
                  <div className="hidden sm:block">
                    <ColumnChart columns={categoryColumns(CATEGORY_COLUMNS.wide)} label="Spending by category this month" />
                  </div>
                  <ChartTable columns={allCategoryRows} valueHeader="Spending by category this month" />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No spending recorded this month yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-semibold text-foreground">Monthly trend</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Spending per month, last 6 months</p>
            <div className="mt-6">
              {trendColumns.length > 0 ? (
                <>
                  <ColumnChart columns={trendColumns} label="Spending per month over the last six months" />
                  <ChartTable columns={trendColumns} valueHeader="Spending per month" />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No history yet.</p>
              )}
            </div>
          </section>
        </div>

        <TransactionsTable rows={filtered} filter={filterLabel} rules={rules} categories={categories} counts={counts} />
      </div>
    </div>
  );
}
