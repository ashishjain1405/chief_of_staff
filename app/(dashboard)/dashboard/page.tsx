export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURES } from "@/lib/features";

// Slots in the Top Priorities card.
const TASK_SLOTS = 5;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const now = new Date().toISOString();
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const in7d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const in3d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  // "Top Priorities" was a single due_date ASC query, which is oldest-first, so
  // the stalest item held slot 1 permanently - a task due 2024-06-30 sat above
  // everything due this week, and with every task at priority "medium" the
  // badge broke no ties. Reserve slots by bucket instead, the same way Ask
  // retrieval does: the most recently missed first, then what is due soonest,
  // then undated tasks only to fill the remaining space.
  const pendingTasks = () =>
    supabase
      .from("tasks")
      .select("id, title, priority, due_date")
      .eq("user_id", user.id)
      .eq("status", "pending");

  const [briefRes, overdueRes, upcomingRes, undatedRes, dueSoonCountRes, meetingsRes, actionEmailsRes] = await Promise.all([
    supabase
      .from("daily_briefs")
      .select("raw_markdown, brief_date")
      .eq("user_id", user.id)
      .order("brief_date", { ascending: false })
      .limit(1)
      .single(),

    pendingTasks().lt("due_date", now).order("due_date", { ascending: false }).limit(TASK_SLOTS),
    pendingTasks().gte("due_date", now).order("due_date", { ascending: true }).limit(TASK_SLOTS),
    pendingTasks().is("due_date", null).order("created_at", { ascending: false }).limit(TASK_SLOTS),

    // The stat below read tasks.length - the card's own row count, capped at
    // TASK_SLOTS - so it showed "5" while 46 tasks were pending, and counted
    // undated ones as "due soon". This is the real number.
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "pending")
      .not("due_date", "is", null)
      .lte("due_date", in3d),

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
      .select("id, subject, body_summary, importance_score, occurred_at")
      .eq("user_id", user.id)
      .eq("requires_action", true)
      .eq("action_taken", false)
      .order("importance_score", { ascending: false })
      .limit(5),
  ]);

  const brief = briefRes.data;
  // Which five to show: reserve two slots for the most recently missed so a
  // long backlog cannot crowd out the week ahead, fill the rest with what is
  // due soonest, then fall back to older overdue items and undated tasks.
  const recentlyOverdue = overdueRes.data ?? [];
  const selected = [
    ...recentlyOverdue.slice(0, 2),
    ...(upcomingRes.data ?? []),
    ...recentlyOverdue.slice(2),
    ...(undatedRes.data ?? []),
  ].slice(0, TASK_SLOTS);

  // What order to show them in, which is a separate question from selection:
  // everything overdue first (most recently missed at the top), then upcoming
  // soonest-first, then undated. Without this the card interleaved overdue and
  // future items and read as unsorted.
  const bucketOf = (due: string | null) =>
    due === null ? 2 : new Date(due) < new Date(now) ? 0 : 1;

  const tasks = [...selected].sort((a, b) => {
    const bucketDiff = bucketOf(a.due_date) - bucketOf(b.due_date);
    if (bucketDiff !== 0) return bucketDiff;
    if (a.due_date === null || b.due_date === null) return 0;
    const diff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    return bucketOf(a.due_date) === 0 ? -diff : diff;
  });
  const meetings = meetingsRes.data ?? [];
  const actionEmails = actionEmailsRes.data ?? [];
  const commitments = FEATURES.commitments
    ? (
        await supabase
          .from("commitments")
          .select("id, description, due_date, status")
          .eq("user_id", user.id)
          .in("status", ["pending", "overdue"])
          .lte("due_date", in7d)
          .order("due_date")
          .limit(5)
      ).data ?? []
    : [];

  const priorityColor = (p: string) =>
    p === "high" ? "destructive" : p === "medium" ? "secondary" : "outline";

  const stats = [
    {
      label: "Action needed",
      value: actionEmails.length,
      href: "/inbox?cat=important",
      cta: "Review inbox",
      border: "border-l-red-400",
      dot: "bg-red-400",
    },
    {
      label: "Due soon or overdue",
      value: dueSoonCountRes.count ?? 0,
      href: "/tasks",
      cta: "View tasks",
      border: "border-l-amber-400",
      dot: "bg-amber-400",
    },
    {
      label: "Meetings today",
      value: meetings.length,
      href: "/meetings",
      cta: "See schedule",
      border: "border-l-blue-400",
      dot: "bg-blue-400",
    },
    ...(FEATURES.commitments
      ? [{
          label: "Pending commitments",
          value: commitments.length,
          href: "/commitments",
          cta: "Check commitments",
          border: "border-l-violet-400",
          dot: "bg-violet-400",
        }]
      : []),
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Good {greeting()}</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <Link
          href="/ask"
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
        >
          Ask AI
        </Link>
      </div>

      {/* Stats row */}
      <div className={`grid grid-cols-2 gap-4 ${FEATURES.commitments ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <div className={`border ${stat.border} border-l-4 rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors cursor-pointer space-y-2`}>
              <div className="text-3xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500">{stat.label}</div>
              <div className="text-xs font-medium text-blue-600">{stat.cta} →</div>
            </div>
          </Link>
        ))}
      </div>

      <div className={`grid gap-6 ${FEATURES.commitments ? "grid-cols-2" : "grid-cols-1"}`}>
        {/* Top Tasks */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-900">Top Priorities</CardTitle>
              <Link href="/tasks" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Open →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400 mb-2">No pending tasks</p>
                <Link href="/tasks" className="text-xs font-medium text-blue-600 hover:text-blue-700">Add a task →</Link>
              </div>
            ) : (
              tasks.map((task) => (
                <Link key={task.id} href="/tasks" className="flex items-start gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors group">
                  <Badge variant={priorityColor(task.priority) as any} className="mt-0.5 shrink-0 text-xs">
                    {task.priority}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{task.title}</p>
                    {task.due_date && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Due {new Date(task.due_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className="text-gray-300 group-hover:text-gray-500 text-xs shrink-0 mt-0.5">→</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Today's Meetings */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-900">Today&apos;s Meetings</CardTitle>
              <Link href="/meetings" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Open →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {meetings.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400">No meetings today</p>
              </div>
            ) : (
              meetings.map((m) => (
                <div key={m.id} className="py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors space-y-0.5">
                  <p className="text-sm font-medium text-gray-900">{m.title}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(m.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" — "}
                    {new Date(m.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" · "}
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
              <CardTitle className="text-sm font-semibold text-gray-900">Needs Action</CardTitle>
              <Link href="/inbox?cat=important" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Open →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {actionEmails.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400">All clear! 🎉</p>
              </div>
            ) : (
              actionEmails.map((email) => (
                <Link
                  key={email.id}
                  href={`/inbox/${email.id}`}
                  className="flex items-start gap-2 py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{email.subject}</p>
                    {email.body_summary && (
                      <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{email.body_summary}</p>
                    )}
                  </div>
                  <span className="text-gray-300 group-hover:text-gray-500 text-xs shrink-0 mt-0.5">→</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Upcoming Commitments */}
        {FEATURES.commitments && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-900">Commitments Due</CardTitle>
              <Link href="/commitments" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Open →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {commitments.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-400">No commitments due soon</p>
              </div>
            ) : (
              commitments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 py-1.5 px-2 -mx-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <p className="text-sm text-gray-900 flex-1 leading-snug">{c.description}</p>
                  {c.due_date && (
                    <span className={`text-xs shrink-0 font-medium ${c.status === "overdue" ? "text-red-500" : "text-gray-400"}`}>
                      {c.status === "overdue" ? "Overdue" : new Date(c.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Daily Brief */}
      {brief && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-900">
              Daily Brief — {new Date(brief.brief_date).toLocaleDateString("en-US", { month: "long", day: "numeric" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-gray-500 whitespace-pre-wrap leading-relaxed">
              {brief.raw_markdown?.substring(0, 800)}
              {(brief.raw_markdown?.length ?? 0) > 800 && "…"}
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
