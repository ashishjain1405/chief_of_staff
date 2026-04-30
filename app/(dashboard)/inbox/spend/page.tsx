import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

const SUB_CAT_COLORS: Record<string, string> = {
  groceries: "bg-green-500",
  subscriptions: "bg-purple-500",
  transport: "bg-blue-500",
  dining: "bg-orange-500",
  flight: "bg-sky-500",
  hotel: "bg-teal-500",
  shopping: "bg-pink-500",
  utilities: "bg-yellow-500",
  banking: "bg-indigo-500",
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
    .from("communications")
    .select("id, subject, occurred_at, channel_metadata, email_category")
    .eq("user_id", user.id)
    .in("email_category", ["finance_bills", "transactions"])
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(200);

  const all = (rows ?? []).filter((r) => (r.channel_metadata as any)?.fin_amount != null);
  const total = all.reduce((s, r) => s + ((r.channel_metadata as any).fin_amount ?? 0), 0);

  const bySubCat: Record<string, number> = {};
  for (const r of all) {
    const meta = r.channel_metadata as any;
    const s = meta.fin_sub_category ?? "other";
    bySubCat[s] = (bySubCat[s] ?? 0) + (meta.fin_amount ?? 0);
  }

  const maxSubCat = Math.max(...Object.values(bySubCat), 1);
  const sortedSubCats = Object.entries(bySubCat).sort((a, b) => b[1] - a[1]);

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
          <p className="text-xl font-semibold">{sortedSubCats.length}</p>
        </div>
      </div>

      {sortedSubCats.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">By Category</h2>
          <div className="space-y-2.5">
            {sortedSubCats.map(([subCat, amount]) => (
              <div key={subCat} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-24 shrink-0 capitalize">
                  {subCat}
                </span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${SUB_CAT_COLORS[subCat] ?? "bg-muted-foreground"}`}
                    style={{ width: `${(amount / maxSubCat) * 100}%` }}
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
              const meta = r.channel_metadata as any;
              return (
                <Link
                  key={r.id}
                  href={`/inbox/${r.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm truncate">{meta.fin_merchant ?? r.subject ?? "—"}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {meta.fin_sub_category ?? "—"} ·{" "}
                      {new Date(r.occurred_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular-nums shrink-0 ml-4">
                    {meta.fin_currency ?? "INR"} {fmt(meta.fin_amount ?? 0)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
