import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

export default async function InboxSpendPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period = "month" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since = period === "week" ? weekAgo : monthAgo;

  const { data: rows } = await supabase
    .from("transactions_normalized")
    .select("*")
    .eq("user_id", user.id)
    .neq("status", "failed")
    .gte("transaction_datetime", since)
    .order("transaction_datetime", { ascending: false })
    .limit(200);

  const all = rows ?? [];
  const total = all.reduce((s, r) => s + (r.amount ?? 0), 0);

  const byCat: Record<string, number> = {};
  for (const r of all) {
    const cat = r.category ?? "other";
    byCat[cat] = (byCat[cat] ?? 0) + (r.amount ?? 0);
  }

  const maxCat = Math.max(...Object.values(byCat), 1);
  const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-3xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/inbox?cat=finance_bills" className="text-xs text-muted-foreground hover:text-foreground">
              ← Inbox
            </Link>
          </div>
          <h1 className="text-base font-semibold mt-1">Spend Summary</h1>
        </div>
        <div className="flex items-center gap-1 border rounded-md overflow-hidden text-xs">
          {(["week", "month"] as const).map((p) => (
            <Link
              key={p}
              href={`/inbox/spend?period=${p}`}
              className={`px-3 py-1.5 capitalize transition-colors ${
                period === p ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {p === "week" ? "7 days" : "30 days"}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Total Spent</p>
          <p className="text-xl font-semibold tabular-nums">₹{fmt(total)}</p>
        </div>
        <div className="border rounded-lg p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Transactions</p>
          <p className="text-xl font-semibold">{all.length}</p>
        </div>
        <div className="border rounded-lg p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Categories</p>
          <p className="text-xl font-semibold">{sortedCats.length}</p>
        </div>
      </div>

      {sortedCats.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">By Category</h2>
          <div className="space-y-2.5">
            {sortedCats.map(([cat, amount]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-28 shrink-0 capitalize">
                  {cat.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${CAT_COLORS[cat] ?? "bg-muted-foreground"}`}
                    style={{ width: `${(amount / maxCat) * 100}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground w-20 text-right shrink-0">
                  ₹{fmt(amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Transactions ({all.length})</h2>
        <div className="border rounded-lg overflow-hidden">
          <div className="divide-y">
            {all.map((r) => {
              const primaryCommId = r.communication_ids?.[0] ?? null;
              const inner = (
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm truncate">{r.merchant_normalized ?? "—"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {(r.category ?? "—").replace(/_/g, " ")} ·{" "}
                      {new Date(r.transaction_datetime).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums shrink-0 ml-4">
                    {r.currency ?? "INR"} {fmt(r.amount ?? 0)}
                  </span>
                </div>
              );
              return primaryCommId ? (
                <Link
                  key={r.id}
                  href={`/inbox/${primaryCommId}`}
                  className="block hover:bg-muted/40 transition-colors"
                >
                  {inner}
                </Link>
              ) : (
                <div key={r.id}>{inner}</div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
