export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { countsAsSpend, isCredit, isFailedTransaction, spendAmount } from "@/lib/finance/spend";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Tag, TrendingUp, Wallet } from "lucide-react";
import { StatTile } from "@/components/finance/stat-tile";
import { ColumnChart, ChartTable, type Column } from "@/components/finance/column-chart";
import { TransactionsTable } from "@/components/finance/transactions-table";
import { FilterBar } from "@/components/finance/filter-bar";
import type { TransactionRow } from "@/components/finance/types";
import { categoryLabel, inr, istDate, merchantLabel } from "@/components/finance/labels";
import { matchesFor, type Rule, type UserCategory } from "@/lib/finance/rules";
import {
  HISTORY_DAYS, addMonths, filtersHref, firstFullMonth, istDay, parseFilters, periodOptions, requestTime, resolvePeriod, toggleCategory, type Filters,
} from "@/lib/finance/periods";

// Columns past these fold into "Other" (fewer on phones, where seven labels
// clip); the table view under the chart keeps every category.
const CATEGORY_COLUMNS = { phone: 3, wide: 6 };
const DAY = 864e5;

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

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
// A transaction with no category is Uncategorised, in the chart and the filter alike.
const categoryOf = (r: TransactionRow) => r.category ?? "unknown";
const total = (list: TransactionRow[]) => list.reduce((s, r) => s + spendAmount(r), 0);

// One period and one set of categories drive the whole page: the tiles, the
// category chart and the list all describe the same transactions, and the
// trend keeps six months of context for the categories chosen.
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; cat?: string; show?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const now = requestTime();
  const defaultPeriod = resolvePeriod(undefined, now).key;
  const parsed = parseFilters(params);
  const p = resolvePeriod(parsed.period, now);
  const filters: Filters = { ...parsed, period: p.key === defaultPeriod ? undefined : p.key };
  const windowStart = new Date(now - HISTORY_DAYS * DAY).toISOString();

  const [rows, { data: ruleRows }, { data: categoryRows }, { data: firstEmail }] = await Promise.all([
    loadSince(supabase, user.id, windowStart),
    supabase.from("transaction_rules").select("id, match_type, match_key, label, category, counted").eq("user_id", user.id).order("created_at"),
    supabase.from("user_categories").select("id, key, label").eq("user_id", user.id),
    // Mail is what the data is read from, so the first email is where it starts.
    supabase.from("communications").select("occurred_at").eq("user_id", user.id).order("occurred_at").limit(1).maybeSingle(),
  ]);
  const rules = (ruleRows ?? []) as Rule[];
  const categories = (categoryRows ?? []) as UserCategory[];
  const names = Object.fromEntries(categories.map((c) => [c.key, c.label]));
  const coverage = (firstEmail?.occurred_at as string | undefined) ?? null;
  const coverageMs = coverage ? Date.parse(coverage) : null;

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
  const between = (start: number, end: number) => all.filter((r) => { const t = Date.parse(r.transaction_datetime); return t >= start && t < end; });
  const chosen = new Set(filters.cats);
  const inCats = (r: TransactionRow) => !chosen.size || chosen.has(categoryOf(r));

  const inPeriod = between(p.start, p.end);
  const periodSpend = inPeriod.filter(countsAsSpend);
  const selectedSpend = periodSpend.filter(inCats);
  const listed = inPeriod.filter(inCats).filter((r) => filters.show === "all" || countsAsSpend(r));
  const hidden = filters.show === "spend" ? inPeriod.filter(inCats).filter((r) => !countsAsSpend(r)).length : 0;

  // From the first email, so "Last 6 months" does not claim months before it.
  const from = Math.max(p.start, coverageMs ?? p.start);
  const spent = total(selectedSpend);
  // Refunds are already netted out of spent; the list says by how much.
  const refunded = -selectedSpend.filter(isCredit).reduce((s, r) => s + spendAmount(r), 0);
  const largest = selectedSpend.reduce((max, r) => Math.max(max, spendAmount(r)), 0);
  // Compared only when the data reaches back over the whole previous period.
  const prevSpent = p.prev && coverageMs !== null && coverageMs <= p.prev.start ? total(between(p.prev.start, p.prev.end).filter(countsAsSpend).filter(inCats)) : null;
  const diff = prevSpent === null ? null : spent - prevSpent;
  const range = `${istDate(new Date(from).toISOString())} – ${istDate(new Date(Math.min(p.end, now) - 1).toISOString())}`;
  const spentCaption = diff === null ? range : diff === 0 ? `Same as ${p.prev!.label}` : `${inr(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than ${p.prev!.label}`;

  const byCat: Record<string, number> = {};
  for (const r of periodSpend) byCat[categoryOf(r)] = (byCat[categoryOf(r)] ?? 0) + spendAmount(r);
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  // The biggest of the chosen categories, or of all of them.
  // With categories chosen, the tile names the selection - "Other" for the
  // categories its column holds - and its share of all spending; without, the
  // biggest category. It used to show the biggest of the chosen, so choosing
  // Other with Entertainment still read "Entertainment".
  const periodTotal = total(periodSpend);
  const share = (v: number) => (periodTotal > 0 ? ` · ${Math.round((v / periodTotal) * 100)}% of all spending` : "");
  const topCat = sortedCats[0];
  const tailKeys = sortedCats.slice(CATEGORY_COLUMNS.wide).map(([c]) => c);
  const otherChosen = tailKeys.length > 0 && tailKeys.every((c) => chosen.has(c));
  const selectionParts = [
    ...sortedCats.filter(([c]) => chosen.has(c) && !(otherChosen && tailKeys.includes(c))).map(([c]) => categoryLabel(c, names)),
    ...filters.cats.filter((c) => !byCat[c]).map((c) => categoryLabel(c, names)),
    ...(otherChosen ? ["Other"] : []),
  ];
  const categoryTile = chosen.size
    ? {
        label: selectionParts.length > 1 ? "Selected categories" : "Selected category",
        value: selectionParts.length <= 2 ? selectionParts.join(" + ") : plural(chosen.size, "category", "categories"),
        caption: `${inr(spent)}${share(spent)}`,
      }
    : topCat
      ? { label: "Highest spend category", value: categoryLabel(topCat[0], names), caption: `${inr(topCat[1])}${share(topCat[1])}` }
      : { label: "Highest spend category", value: "—", caption: "No spending in this period" };
  const categoryOptions = [
    ...sortedCats.map(([c, v]) => ({ key: c, label: categoryLabel(c, names), total: inr(v) })),
    ...filters.cats.filter((c) => !byCat[c]).map((c) => ({ key: c, label: categoryLabel(c, names), total: inr(0) })),
  ];

  // Presentation only: shape the computed totals into chart columns. A bar
  // adds its category to the filter or takes it out; Other adds all it holds.
  const hrefWith = (next: Partial<Filters>) => filtersHref({ ...filters, ...next });
  const tone = (on: boolean) => (chosen.size ? (on ? ("accent" as const) : ("soft" as const)) : ("default" as const));
  // The columns stay the biggest categories whatever is chosen, so Other always
  // holds the same ones: one click filters to exactly those, a second clears
  // them. Pinning chosen categories as columns moved them out of Other, so
  // each click on it meant something different.
  const categoryColumns = (count: number): Column[] => {
    const head = sortedCats.slice(0, count);
    const tailKeys = sortedCats.slice(count).map(([c]) => c);
    const tail = sortedCats.slice(count).reduce((sum, [, v]) => sum + v, 0);
    const otherAll = tailKeys.length > 0 && tailKeys.every((c) => chosen.has(c));
    return [
      ...head.map(([c, value]) => ({ key: c, label: categoryLabel(c, names), value, href: hrefWith({ cats: toggleCategory(filters.cats, c) }), tone: tone(chosen.has(c)) })),
      ...(tail > 0 ? [{
        key: "__other", label: "Other", value: tail, tone: tone(tailKeys.some((c) => chosen.has(c))),
        href: hrefWith({ cats: otherAll ? filters.cats.filter((c) => !tailKeys.includes(c)) : [...new Set([...filters.cats, ...tailKeys])] }),
      }] : []),
    ];
  };
  const allCategoryRows: Column[] = sortedCats.map(([c, value]) => ({ key: c, label: categoryLabel(c, names), value }));

  // From the first month the mail covers from its 1st, within what is loaded.
  const thisMonth = istDay(new Date(now)).slice(0, 7);
  const trendFrom = [firstFullMonth(coverage), firstFullMonth(windowStart)].filter((m): m is string => !!m).sort().pop() ?? thisMonth;
  const byMonth: Record<string, number> = {};
  for (const r of all.filter(countsAsSpend).filter(inCats)) {
    const m = istDay(new Date(r.transaction_datetime)).slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + spendAmount(r);
  }
  const trendColumns: Column[] = [];
  for (let m = trendFrom; m <= thisMonth; m = addMonths(m, 1)) {
    trendColumns.push({
      key: m,
      label: new Date(`${m}-01T12:00:00+05:30`).toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" }),
      value: byMonth[m] ?? 0,
      href: hrefWith({ period: m === defaultPeriod ? undefined : m }),
      tone: p.month ? (m === p.month ? "accent" : "soft") : "default",
    });
  }

  const periodText = p.label.toLowerCase().startsWith("last") || p.label === "This month" ? p.label.toLowerCase() : p.label;
  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/70 dark:bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finance</h1>
            <p className="mt-1 text-sm text-muted-foreground">Pick a period and categories; everything below follows.</p>
          </div>
          <Link
            href="/inbox?cat=finance_bills"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            View in inbox
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </header>

        <FilterBar filters={filters} period={p.key} defaultPeriod={defaultPeriod} options={periodOptions(coverage, now)} categories={categoryOptions} />

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4" aria-label={`${p.label} at a glance`}>
          <div className="col-span-2 sm:col-span-1 [&>*]:h-full">
            <StatTile icon={Wallet} label="Spent" value={inr(spent)} caption={spentCaption} />
          </div>
          <StatTile icon={Tag} value={categoryTile.value} caption={categoryTile.caption}
            label={chosen.size ? categoryTile.label : <><span className="sm:hidden">Top category</span><span className="hidden sm:inline">{categoryTile.label}</span></>} />
          <StatTile icon={TrendingUp} label="Largest spend" value={inr(largest)} caption="Single transaction" />
        </section>

        <div className="grid gap-4 lg:grid-cols-5">
          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm lg:col-span-3">
            <h2 className="text-base font-semibold text-foreground">Spend by category</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{p.label} · select a column to filter by it</p>
            <div className="mt-6">
              {sortedCats.length > 0 ? (
                <>
                  <div className="sm:hidden">
                    <ColumnChart columns={categoryColumns(CATEGORY_COLUMNS.phone)} label={`Spending by category, ${periodText}`} />
                  </div>
                  <div className="hidden sm:block">
                    <ColumnChart columns={categoryColumns(CATEGORY_COLUMNS.wide)} label={`Spending by category, ${periodText}`} />
                  </div>
                  <ChartTable columns={allCategoryRows} valueHeader={`Spending by category, ${periodText}`} />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No spending in this period.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm lg:col-span-2">
            <h2 className="text-base font-semibold text-foreground">Monthly trend</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {chosen.size ? `${plural(chosen.size, "category", "categories")} chosen` : "Spending per month"} · select a month to see it
            </p>
            <div className="mt-6">
              {trendColumns.some((c) => c.value > 0) ? (
                <>
                  <ColumnChart columns={trendColumns} label="Spending per month" />
                  <ChartTable columns={trendColumns} valueHeader="Spending per month" />
                </>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">No history yet.</p>
              )}
            </div>
          </section>
        </div>

        <TransactionsTable
          rows={listed}
          summary={`${plural(listed.length, "transaction")} · ${inr(spent)} spent${refunded > 0 ? ` after ${inr(refunded)} refunded` : ""}`}
          hidden={hidden ? { count: hidden, href: hrefWith({ show: "all" }) } : undefined}
          rules={rules}
          categories={categories}
          counts={counts}
        />
      </div>
    </div>
  );
}
