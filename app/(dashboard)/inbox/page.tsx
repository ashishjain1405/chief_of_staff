import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ImportanceDot({ score }: { score: number }) {
  const color =
    score >= 0.8 ? "bg-red-500" : score >= 0.6 ? "bg-amber-500" : "bg-muted-foreground/40";
  return <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${color}`} />;
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const map: Record<string, string> = {
    urgent: "destructive",
    negative: "secondary",
    positive: "outline",
    neutral: "outline",
  };
  return <Badge variant={(map[sentiment] ?? "outline") as any} className="text-xs">{sentiment}</Badge>;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab = "action" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [actionRes, allRes, doneRes] = await Promise.all([
    supabase
      .from("communications")
      .select("id, subject, body_summary, importance_score, sentiment, occurred_at, requires_action, action_taken, contact_id, contacts(name, email)")
      .eq("user_id", user.id)
      .eq("requires_action", true)
      .eq("action_taken", false)
      .order("importance_score", { ascending: false })
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("communications")
      .select("id, subject, body_summary, importance_score, sentiment, occurred_at, requires_action, action_taken, contacts(name, email)")
      .eq("user_id", user.id)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("communications")
      .select("id, subject, body_summary, importance_score, sentiment, occurred_at, requires_action, action_taken, contact_id, contacts(name, email)")
      .eq("user_id", user.id)
      .eq("action_taken", true)
      .order("importance_score", { ascending: false })
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);

  const lists: Record<string, any[]> = {
    action: actionRes.data ?? [],
    all: allRes.data ?? [],
    done: doneRes.data ?? [],
  };

  const current = lists[tab] ?? lists.action;

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <h1 className="text-2xl font-bold">Inbox</h1>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="action">
            <Link href="/inbox?tab=action">Needs Action ({lists.action.length})</Link>
          </TabsTrigger>
          <TabsTrigger value="all">
            <Link href="/inbox?tab=all">All</Link>
          </TabsTrigger>
          <TabsTrigger value="done">
            <Link href="/inbox?tab=done">Done</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {current.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              {tab === "action" ? "All clear! No emails need action." : "No emails yet."}
            </div>
          ) : (
            <div className="divide-y rounded-lg border overflow-hidden">
              {current.map((email) => (
                <Link
                  key={email.id}
                  href={`/inbox/${email.id}`}
                  className="flex items-start gap-3 p-4 hover:bg-muted/50 transition-colors"
                >
                  <ImportanceDot score={email.importance_score ?? 0.5} />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{email.subject ?? "(no subject)"}</span>
                        {email.requires_action && !email.action_taken && (
                          <Badge variant="secondary" className="text-xs shrink-0">Action</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <SentimentBadge sentiment={email.sentiment} />
                        <span className="text-xs text-muted-foreground">
                          {new Date(email.occurred_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {email.body_summary && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{email.body_summary}</p>
                    )}
                    {(email.contacts as any)?.name && (
                      <p className="text-xs text-muted-foreground">
                        From: {(email.contacts as any).name}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
