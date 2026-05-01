import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const CAT_COLORS: Record<string, string> = {
  groceries: "bg-green-500",
  subscriptions: "bg-purple-500",
  transport: "bg-blue-500",
  food_delivery: "bg-orange-500",
  travel: "bg-sky-500",
  shopping: "bg-pink-500",
  utilities: "bg-yellow-500",
  banking: "bg-indigo-500",
  telecom: "bg-cyan-500",
  investments: "bg-emerald-500",
  healthcare: "bg-red-500",
  ecommerce: "bg-violet-500",
  restaurants: "bg-amber-500",
  other: "bg-muted-foreground",
};

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows } = await supabase
    .from("transactions_normalized")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "failed")
    .gte("transaction_datetime", sixMonthsAgo)
    .order("transaction_datetime", { ascending: false })
    .limit(500);

  const all = rows ?? [];

  const weekly_total = all
    .filter((r) => r.transaction_datetime >= weekAgo)
    .reduce((s, r) => s + (r.amount ?? 0), 0);

  const monthly_total = all
    .filter((r) => r.transaction_datetime >= monthAgo)
    .reduce((s, r) => s + (r.amount ?? 0), 0);

  const byCat: Record<string, number> = {};
  for (const r of all.filter((r) => r.transaction_datetime >= monthAgo)) {
    const c = r.category ?? "other";
    byCat[c] = (byCat[c] ?? 0) + (r.amount ?? 0);
  }

  const monthlyTrend: Record<string, number> = {};
  for (const r of all) {
    const month = (r.transaction_datetime as string).substring(0, 7);
    monthlyTrend[month] = (monthlyTrend[month] ?? 0) + (r.amount ?? 0);
  }

  const largestSpend = all.reduce((max, r) => Math.max(max, r.amount ?? 0), 0);
  const maxCat = Math.max(...Object.values(byCat), 1);
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const sortedMonths = Object.entries(monthlyTrend).sort((a, b) => a[0].localeCompare(b[0]));
  const maxMonth = Math.max(...Object.values(monthlyTrend), 1);

  const filtered = cat ? all.filter((r) => r.category === cat) : all;

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">Finance</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Last 6 months</p>
        </div>
        <Link
          href="/inbox?cat=finance_bills"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View in inbox →
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "This Month", value: `₹${fmt(monthly_total)}` },
          { label: "This Week", value: `₹${fmt(weekly_total)}` },
          { label: "Transactions", value: all.length.toString() },
          { label: "Largest Spend", value: `₹${fmt(largestSpend)}` },
        ].map((card) => (
          <div key={card.label} className="border rounded-lg p-4 space-y-1">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p className="text-xl font-semibold tabular-nums">{card.value}</p>
          </div>
        ))}
      </div>

      {sortedCats.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Spend by Category (this month)</h2>
          <div className="space-y-2.5">
            {sortedCats.map(([c, amount]) => (
              <Link
                key={c}
                href={`/finance?cat=${c}`}
                className="flex items-center gap-3 group"
              >
                <span className="text-xs text-muted-foreground w-28 shrink-0 capitalize group-hover:text-foreground transition-colors">
                  {c.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${CAT_COLORS[c] ?? "bg-muted-foreground"}`}
                    style={{ width: `${(amount / maxCat) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right shrink-0">
                  ₹{fmt(amount)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {sortedMonths.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Monthly Trend</h2>
          <div className="flex items-end gap-2" style={{ height: "96px" }}>
            {sortedMonths.map(([month, amount]) => (
              <div key={month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex items-end justify-center" style={{ height: "72px" }}>
                  <div
                    className="w-full bg-foreground/20 rounded-t"
                    style={{ height: `${(amount / maxMonth) * 72}px` }}
                    title={`₹${fmt(amount)}`}
                  />
                </div>
                <span className="text-xs text-muted-foreground truncate w-full text-center">
                  {month.substring(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Transactions
            {cat && (
              <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                — {cat.replace(/_/g, " ")}
                <Link href="/finance" className="ml-2 hover:text-foreground">×</Link>
              </span>
            )}
          </h2>
          <span className="text-xs text-muted-foreground">{filtered.length} total</span>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_auto_auto] text-xs text-muted-foreground px-4 py-2 border-b bg-muted/30">
            <span>Merchant</span>
            <span className="px-4">Category</span>
            <span className="px-4">Date</span>
            <span className="text-right">Amount</span>
          </div>
          <div className="divide-y">
            {filtered.slice(0, 100).map((r) => {
              const primaryCommId = r.communication_ids?.[0] ?? null;
              const inner = (
                <>
                  <span className="text-sm truncate">{r.merchant_normalized ?? "—"}</span>
                  <span className="px-4 text-xs text-muted-foreground capitalize">
                    {(r.category ?? "—").replace(/_/g, " ")}
                  </span>
                  <span className="px-4 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.transaction_datetime).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-right whitespace-nowrap">
                    {r.currency ?? "INR"} {fmt(r.amount ?? 0)}
                  </span>
                </>
              );
              return primaryCommId ? (
                <Link
                  key={r.id}
                  href={`/inbox/${primaryCommId}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={r.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center px-4 py-3"
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
