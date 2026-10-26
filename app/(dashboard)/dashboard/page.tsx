export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CalendarDays, Handshake, Inbox, ListChecks, Newspaper, Sparkles, Compass } from "lucide-react";
import { FEATURES } from "@/lib/features";
import { SectionCard, EmptyState } from "@/components/dashboard/section-card";
import { StatLink } from "@/components/dashboard/stat-link";
import { TaskList, MeetingList, EmailList, CommitmentList } from "@/components/dashboard/lists";
import { Brief } from "@/components/dashboard/brief";
import { BriefSections } from "@/components/dashboard/brief-sections";
import type { Brief as BriefContent } from "@/lib/brief/build";
import { Explore } from "@/components/dashboard/explore";

const IST = "Asia/Kolkata";

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

  const [briefRes, overdueRes, upcomingRes, undatedRes, dueSoonCountRes, meetingsRes, actionEmailsRes, googleRes, latestEmailRes] = await Promise.all([
    supabase
      .from("daily_briefs")
      .select("raw_markdown, brief_date, content")
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

    supabase
      .from("integrations")
      .select("is_active, metadata")
      .eq("user_id", user.id)
      .eq("provider", "google")
      .maybeSingle(),

    // created_at, not occurred_at: what matters is when ingestion last wrote.
    supabase
      .from("communications")
      .select("created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // Ingestion has failed silently twice with every job reporting success, so
  // the dashboard says so: a rejected token marks Google inactive, and a day
  // with no new mail is flagged even when the cause is something else.
  const google = googleRes.data;
  const lastEmailAt = latestEmailRes.data?.created_at ? new Date(latestEmailRes.data.created_at) : null;
  const hoursSinceEmail = lastEmailAt ? Math.floor((Date.now() - lastEmailAt.getTime()) / 3_600_000) : null;
  const ingestionWarning = !google
    ? null
    : !google.is_active
      ? `Google is disconnected${google.metadata?.auth_error?.at ? ` since ${new Date(google.metadata.auth_error.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST })}` : ""} — Gmail and Calendar have stopped syncing.`
      : hoursSinceEmail !== null && hoursSinceEmail >= 24
        ? `No new email in ${hoursSinceEmail} hours — Gmail sync may have stopped.`
        : null;

  const brief = briefRes.data;
  // Briefs saved before the structured content (version 2) fall back to markdown.
  const sections = (brief?.content as BriefContent | null)?.version === 2 ? (brief!.content as BriefContent) : null;
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

  // Presentation only below. The needs-action query is capped at 5 rows, so a
  // full list means "at least five", not five.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: IST });
  const dateLine = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: IST });
  const actionCount = actionEmails.length >= 5 ? "5+" : String(actionEmails.length);

  return (
    <div className="min-h-full bg-slate-50/70 dark:bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        {ingestionWarning && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {ingestionWarning}
            </span>
            <a href="/api/auth/google" className="shrink-0 font-semibold underline underline-offset-2">Reconnect Google</a>
          </div>
        )}

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Good {greeting()}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{dateLine} · here is what needs you today.</p>
          </div>
          <Link
            href="/ask"
            className="inline-flex items-center gap-2 rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-sky-700"
          >
            <Sparkles className="size-4" aria-hidden />
            Ask AI
          </Link>
        </header>

        <section aria-label="At a glance" className={`grid grid-cols-1 gap-3 sm:gap-4 ${FEATURES.commitments ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
          <StatLink icon={Inbox} label="Needs your action" value={actionCount} caption="Review inbox" href="/inbox?cat=important" />
          <StatLink icon={ListChecks} label="Due soon or overdue" value={String(dueSoonCountRes.count ?? 0)} caption="View tasks" href="/tasks" />
          <StatLink icon={CalendarDays} label="Meetings today" value={String(meetings.length)} caption="See schedule" href="/meetings" />
          {FEATURES.commitments && (
            <StatLink icon={Handshake} label="Pending commitments" value={String(commitments.length)} caption="Check commitments" href="/commitments" />
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <SectionCard icon={ListChecks} title="Priorities" description="Overdue first, then what is due soonest" href="/tasks" linkLabel="All tasks" className="lg:col-span-3">
            <TaskList tasks={tasks} today={today} />
          </SectionCard>
          <SectionCard icon={CalendarDays} title="Today's schedule" description="Meetings in the next 24 hours" href="/meetings" linkLabel="Calendar" className="lg:col-span-2">
            <MeetingList meetings={meetings} />
          </SectionCard>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <SectionCard icon={Inbox} title="Needs your action" description="Emails waiting on a reply or a decision" href="/inbox?cat=important" linkLabel="Inbox" className="lg:col-span-3">
            <EmailList emails={actionEmails} />
          </SectionCard>
          <SectionCard icon={Compass} title="Explore" description="Every area, one click away" className="lg:col-span-2">
            <Explore />
          </SectionCard>
        </div>

        {FEATURES.commitments && (
          <SectionCard icon={Handshake} title="Commitments due" description="Promises due in the next 7 days" href="/commitments" linkLabel="All commitments">
            <CommitmentList commitments={commitments} />
          </SectionCard>
        )}

        <SectionCard
          icon={Newspaper}
          title="Daily brief"
          description={brief ? `Prepared ${new Date(brief.brief_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", timeZone: IST })}${sections ? ` · ${sections.summary}` : ""}` : "Prepared every morning at 8:00"}
        >
          {sections ? (
            <BriefSections brief={sections} />
          ) : brief?.raw_markdown ? (
            <div className="lg:columns-2 lg:gap-10 [&_h3]:break-after-avoid">
              <Brief markdown={brief.raw_markdown} />
            </div>
          ) : (
            <EmptyState>Your brief is prepared every morning at 8:00.</EmptyState>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// The server runs in UTC, so its clock said "morning" until 17:30 IST.
function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: IST }));
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
