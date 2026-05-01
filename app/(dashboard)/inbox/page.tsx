import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import CategorySidebar from "@/components/inbox/category-sidebar";
import { CATEGORIES } from "@/components/inbox/categories";

function ImportanceDot({ score }: { score: number }) {
  const color =
    score >= 0.8 ? "bg-red-500" : score >= 0.6 ? "bg-amber-500" : "bg-muted-foreground/30";
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-2 ${color}`} />;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c.label])
);

const SUB_CAT_COLORS: Record<string, string> = {
  food_delivery: "bg-orange-100 text-orange-700",
  groceries: "bg-green-100 text-green-700",
  shopping: "bg-pink-100 text-pink-700",
  travel: "bg-sky-100 text-sky-700",
  transport: "bg-blue-100 text-blue-700",
  fuel: "bg-yellow-100 text-yellow-700",
  utilities: "bg-yellow-100 text-yellow-700",
  rent: "bg-stone-100 text-stone-700",
  subscriptions: "bg-purple-100 text-purple-700",
  insurance: "bg-teal-100 text-teal-700",
  healthcare: "bg-red-100 text-red-700",
  education: "bg-cyan-100 text-cyan-700",
  entertainment: "bg-violet-100 text-violet-700",
  investments: "bg-emerald-100 text-emerald-700",
  banking: "bg-indigo-100 text-indigo-700",
  salary: "bg-green-100 text-green-700",
  tax: "bg-rose-100 text-rose-700",
  emi: "bg-amber-100 text-amber-700",
  telecom: "bg-cyan-100 text-cyan-700",
  ecommerce: "bg-pink-100 text-pink-700",
  restaurants: "bg-orange-100 text-orange-700",
  other: "bg-muted text-muted-foreground",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat = "important" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [countsRes, emailsRes] = await Promise.all([
    supabase.rpc("get_category_counts", { p_user_id: user.id }),
    supabase
      .from("communications")
      .select("id, subject, body_summary, importance_score, sentiment, occurred_at, requires_action, action_taken, email_category, channel_metadata, contacts(name, email)")
      .eq("user_id", user.id)
      .eq("email_category", cat)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const counts: Record<string, number> = {};
  for (const row of countsRes.data ?? []) {
    counts[row.email_category] = Number(row.cnt);
  }

  const emails = emailsRes.data ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <Suspense>
        <CategorySidebar counts={counts} />
      </Suspense>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 border-b">
          <h1 className="text-base font-semibold">
            {CATEGORY_LABELS[cat] ?? cat}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {counts[cat] ?? 0} emails
          </p>
        </div>

        {emails.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            No emails in this category
          </div>
        ) : (
          <div className="divide-y">
            {emails.map((email) => {
              const meta = (email.channel_metadata as any) ?? {};
              const isFinancial =
                email.email_category === "finance_bills" ||
                email.email_category === "transactions";
              return (
                <Link
                  key={email.id}
                  href={`/inbox/${email.id}`}
                  className="flex items-start gap-3 px-6 py-4 hover:bg-muted/40 transition-colors"
                >
                  <ImportanceDot score={email.importance_score ?? 0.5} />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-medium text-sm leading-snug truncate">
                        {email.subject ?? "(no subject)"}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {isFinancial && meta.fin_amount != null && (
                          <span className="text-sm font-medium tabular-nums">
                            {meta.fin_currency ?? "INR"} {Number(meta.fin_amount).toLocaleString()}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(email.occurred_at).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {(email.contacts as any)?.name && (
                        <span className="text-xs text-muted-foreground">
                          {(email.contacts as any).name}
                        </span>
                      )}
                      {isFinancial && meta.fin_sub_category && (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            SUB_CAT_COLORS[meta.fin_sub_category] ?? SUB_CAT_COLORS.other
                          }`}
                        >
                          {meta.fin_sub_category}
                        </span>
                      )}
                      {isFinancial && meta.fin_merchant && (
                        <span className="text-xs text-muted-foreground">
                          {meta.fin_merchant}
                        </span>
                      )}
                    </div>

                    {email.body_summary && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {email.body_summary}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
