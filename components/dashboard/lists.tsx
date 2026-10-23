import Link from "next/link";
import { AlertCircle, ChevronRight } from "lucide-react";
import { EmptyState } from "./section-card";

const IST = "Asia/Kolkata";
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });

// Due dates as the founder reads them - "Overdue", "Today", "Tomorrow" - on
// IST calendar days rather than the server's UTC clock.
export function dueChip(due: string | null, today: string) {
  if (!due) return { text: "No date", className: "bg-muted text-muted-foreground" };
  const day = istDay(new Date(due));
  const tomorrow = istDay(new Date(Date.parse(`${today}T12:00:00+05:30`) + 864e5));
  if (day < today) return { text: `Overdue · ${shortDate(due)}`, className: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300", overdue: true };
  if (day === today) return { text: "Today", className: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" };
  if (day === tomorrow) return { text: "Tomorrow", className: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" };
  return { text: shortDate(due), className: "bg-muted text-muted-foreground" };
}

type Task = { id: string; title: string; priority: string | null; due_date: string | null };

export function TaskList({ tasks, today }: { tasks: Task[]; today: string }) {
  if (tasks.length === 0) return <EmptyState>Nothing pending - you are all caught up.</EmptyState>;
  return (
    <ul className="-mx-2 space-y-0.5">
      {tasks.map((t) => {
        const chip = dueChip(t.due_date, today);
        return (
          <li key={t.id}>
            <Link href="/tasks" className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/50">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{t.title}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}>
                    {chip.overdue && <AlertCircle className="size-3" aria-hidden />}
                    {chip.text}
                  </span>
                  {t.priority === "high" && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">High priority</span>
                  )}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Meeting = { id: string; title: string; start_time: string; end_time: string; attendees: unknown };

export function MeetingList({ meetings }: { meetings: Meeting[] }) {
  if (meetings.length === 0) return <EmptyState>No meetings in the next 24 hours.</EmptyState>;
  return (
    <ol className="space-y-3">
      {meetings.map((m) => {
        const attendees = Array.isArray(m.attendees) ? m.attendees.length : 0;
        return (
          <li key={m.id} className="flex gap-3">
            <span className="w-16 shrink-0 pt-0.5 text-right text-xs font-medium tabular-nums text-foreground">{time(m.start_time)}</span>
            <span className="min-w-0 flex-1 border-l-2 border-sky-200 pl-3 dark:border-sky-500/40">
              <span className="block truncate text-sm font-medium text-foreground">{m.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Until {time(m.end_time)} · {attendees} {attendees === 1 ? "attendee" : "attendees"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type Email = { id: string; subject: string | null; body_summary: string | null; occurred_at: string | null };

export function EmailList({ emails }: { emails: Email[] }) {
  if (emails.length === 0) return <EmptyState>No emails waiting on you.</EmptyState>;
  return (
    <ul className="-mx-2 divide-y divide-border/60">
      {emails.map((e) => (
        <li key={e.id}>
          <Link href={`/inbox/${e.id}`} className="group flex items-start gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-muted/50">
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-foreground">{e.subject || "(no subject)"}</span>
                {e.occurred_at && <span className="shrink-0 text-xs text-muted-foreground">{shortDate(e.occurred_at)}</span>}
              </span>
              {e.body_summary && <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{e.body_summary}</span>}
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Commitment = { id: string; description: string; due_date: string | null; status: string | null };

export function CommitmentList({ commitments }: { commitments: Commitment[] }) {
  if (commitments.length === 0) return <EmptyState>No commitments due this week.</EmptyState>;
  return (
    <ul className="space-y-2">
      {commitments.map((c) => (
        <li key={c.id} className="flex items-start justify-between gap-3 text-sm">
          <span className="text-foreground">{c.description}</span>
          {c.due_date && (
            <span className={`shrink-0 text-xs font-medium ${c.status === "overdue" ? "text-rose-700 dark:text-rose-300" : "text-muted-foreground"}`}>
              {c.status === "overdue" ? "Overdue" : shortDate(c.due_date)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
