export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CATEGORIES = ["investor", "customer", "hire", "partner"] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, { label: string; icon: string }> = {
  investor: { label: "Investors", icon: "💼" },
  customer: { label: "Customers", icon: "🏢" },
  hire: { label: "Hires", icon: "👤" },
  partner: { label: "Partners", icon: "🤝" },
};

function HealthBadge({ score }: { score: number }) {
  if (score >= 0.7) return <Badge variant="outline" className="text-green-600 border-green-300">Active</Badge>;
  if (score >= 0.4) return <Badge variant="secondary">Cooling</Badge>;
  return <Badge variant="destructive">Cold</Badge>;
}

export default async function RelationshipsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: Category }>;
}) {
  const { tab = "investor" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: relationships } = await supabase
    .from("relationships")
    .select(`
      id, category, health_score, follow_up_due, metadata,
      contacts(id, name, email, organization, title, last_interaction_at, interaction_count)
    `)
    .eq("user_id", user.id)
    .eq("category", tab)
    .order("health_score", { ascending: false });

  const counts: Record<string, number> = {};
  await Promise.all(
    CATEGORIES.map(async (cat) => {
      const { count } = await supabase
        .from("relationships")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("category", cat);
      counts[cat] = count ?? 0;
    })
  );

  const list = relationships ?? [];

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Relationships</h1>
      </div>

      <Tabs defaultValue={tab}>
        <TabsList>
          {CATEGORIES.map((cat) => (
            <TabsTrigger key={cat} value={cat}>
              <Link href={`/relationships?tab=${cat}`} className="flex items-center gap-1">
                {CATEGORY_LABELS[cat].icon} {CATEGORY_LABELS[cat].label} ({counts[cat] ?? 0})
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {list.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              No {CATEGORY_LABELS[tab].label.toLowerCase()} tracked yet.
              <br />
              <span className="text-xs">They&apos;ll appear automatically as you exchange emails.</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {list.map((rel) => {
                const contact = rel.contacts as any;
                const meta = rel.metadata as any ?? {};
                const isOverdue =
                  rel.follow_up_due && new Date(rel.follow_up_due) < new Date();

                return (
                  <Card key={rel.id} className="hover:shadow-sm transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm font-semibold">
                            {contact?.name ?? contact?.email}
                          </CardTitle>
                          {contact?.organization && (
                            <p className="text-xs text-muted-foreground">{contact.organization}</p>
                          )}
                          {contact?.title && (
                            <p className="text-xs text-muted-foreground">{contact.title}</p>
                          )}
                        </div>
                        <HealthBadge score={rel.health_score ?? 0.5} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {/* Category-specific metadata */}
                      {tab === "investor" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {meta.fund && <div><span className="text-muted-foreground">Fund: </span>{meta.fund}</div>}
                          {meta.stage && <div><span className="text-muted-foreground">Stage: </span>{meta.stage}</div>}
                          {meta.check_size && <div><span className="text-muted-foreground">Check: </span>{meta.check_size}</div>}
                        </div>
                      )}
                      {tab === "customer" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {meta.arr && <div><span className="text-muted-foreground">ARR: </span>{meta.arr}</div>}
                          {meta.renewal_date && <div><span className="text-muted-foreground">Renewal: </span>{new Date(meta.renewal_date).toLocaleDateString()}</div>}
                        </div>
                      )}
                      {tab === "hire" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {meta.role && <div><span className="text-muted-foreground">Role: </span>{meta.role}</div>}
                          {meta.pipeline_stage && <div><span className="text-muted-foreground">Stage: </span>{meta.pipeline_stage}</div>}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {contact?.interaction_count ?? 0} interactions
                          {contact?.last_interaction_at &&
                            ` · Last ${new Date(contact.last_interaction_at).toLocaleDateString()}`}
                        </span>
                        {rel.follow_up_due && (
                          <span className={isOverdue ? "text-red-500 font-medium" : ""}>
                            {isOverdue ? "Follow-up overdue" : `Follow up ${new Date(rel.follow_up_due).toLocaleDateString()}`}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
