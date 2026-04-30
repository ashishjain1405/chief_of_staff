import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const now = new Date().toISOString();
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const in7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [briefRes, tasksRes, meetingsRes, actionEmailsRes, commitmentsRes] = await Promise.all([
    supabase
      .from("daily_briefs")
      .select("raw_markdown, brief_date")
      .eq("user_id", user.id)
      .order("brief_date", { ascending: false })
      .limit(1)
      .single(),

    supabase
      .from("tasks")
      .select("id, title, priority, due_date, ai_reasoning")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .limit(5),

    supabase
      .from("meetings")
      .select("id, title, start_time, end_time, attendees")
      .eq("user_id", user.id)
      .eq("status", "scheduled")
      .gte("start_time", now)
      .lte("start_time", in24h)
      .order("start_time"),

    supabase
      .from("communications")
      .select("id, subject, body_summary, importance_score, sentiment, occurred_at")
      .eq("user_id", user.id)
      .eq("requires_action", true)
      .eq("action_taken", false)
      .order("importance_score", { ascending: false })
      .limit(5),

    supabase
      .from("commitments")
      .select("id, description, due_date, status")
      .eq("user_id", user.id)
      .in("status", ["pending", "overdue"])
      .lte("due_date", in7d)
      .order("due_date")
      .limit(5),
  ]);

  const brief = briefRes.data;
  const tasks = tasksRes.data ?? [];
  const meetings = meetingsRes.data ?? [];
  const actionEmails = actionEmailsRes.data ?? [];
  const commitments = commitmentsRes.data ?? [];

  const priorityColor = (p: string) =>
    p === "high" ? "destructive" : p === "medium" ? "secondary" : "outline";

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Good {greeting()}</h1>
        <p className="text-muted-foreground text-sm">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Action needed", value: actionEmails.length, href: "/inbox" },
          { label: "Tasks due soon", value: tasks.length, href: "/tasks" },
          { label: "Meetings today", value: meetings.length, href: "/meetings" },
          { label: "Pending commitments", value: commitments.length, href: "/commitments" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="pt-4">
                <div className="text-3xl font-bold">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Top Tasks */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Top Priorities</CardTitle>
              <Link href="/tasks" className="text-xs text-muted-foreground hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending tasks</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3">
                  <Badge variant={priorityColor(task.priority) as any} className="mt-0.5 shrink-0">
                    {task.priority}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    {task.due_date && (
                      <p className="text-xs text-muted-foreground">
                        Due {new Date(task.due_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Today's Meetings */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Today&apos;s Meetings</CardTitle>
              <Link href="/meetings" className="text-xs text-muted-foreground hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings scheduled today</p>
            ) : (
              meetings.map((m) => (
                <div key={m.id} className="space-y-0.5">
                  <p className="text-sm font-medium">{m.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(m.start_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    —{" "}
                    {new Date(m.end_time).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(m.attendees as any[])?.length ?? 0} attendees
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Emails needing action */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Needs Action</CardTitle>
              <Link href="/inbox" className="text-xs text-muted-foreground hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {actionEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground">All clear!</p>
            ) : (
              actionEmails.map((email) => (
                <Link key={email.id} href={`/inbox/${email.id}`} className="block space-y-0.5 hover:bg-muted -mx-2 px-2 py-1 rounded">
                  <p className="text-sm font-medium truncate">{email.subject}</p>
                  {email.body_summary && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{email.body_summary}</p>
                  )}
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Upcoming Commitments */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Commitments Due</CardTitle>
              <Link href="/commitments" className="text-xs text-muted-foreground hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {commitments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commitments due soon</p>
            ) : (
              commitments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2">
                  <p className="text-sm flex-1">{c.description}</p>
                  {c.due_date && (
                    <span
                      className={`text-xs shrink-0 ${
                        c.status === "overdue" ? "text-red-500" : "text-muted-foreground"
                      }`}
                    >
                      {c.status === "overdue" ? "Overdue" : new Date(c.due_date).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Daily Brief */}
      {brief && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Daily Brief — {new Date(brief.brief_date).toLocaleDateString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-sm whitespace-pre-wrap text-muted-foreground">
              {brief.raw_markdown?.substring(0, 800)}
              {(brief.raw_markdown?.length ?? 0) > 800 && "..."}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
