"use client";

import { useOptimistic, useTransition } from "react";
import { AlertCircle, Archive, CalendarClock, CalendarDays, CheckCircle2, Clock, Flag, Inbox, Sparkles } from "lucide-react";
import { SectionCard, EmptyState } from "@/components/dashboard/section-card";
import { StatLink } from "@/components/dashboard/stat-link";
import { TaskRow } from "@/components/tasks/task-row";
import { groupTasks, type TaskRowData, type TaskStatus } from "@/lib/tasks/view";

type Change = { ids: string[]; status: TaskStatus; at: string };

// Done and Dismiss move a task at once: the change is applied to the list
// before the server confirms it, and the save runs in a transition. When the
// action returns, the page re-renders with the saved rows; if the save failed
// the task reappears where it was.
export function TasksView({ rows, today, action }: { rows: TaskRowData[]; today: string; action: (formData: FormData) => Promise<void> }) {
  const [tasks, applyChange] = useOptimistic(rows, (state: TaskRowData[], c: Change) =>
    state.map((t) => (c.ids.includes(t.id) ? { ...t, status: c.status, updated_at: c.at } : t))
  );
  const [, startTransition] = useTransition();
  const setStatus = (ids: string[], status: TaskStatus) => {
    const at = new Date().toISOString();
    startTransition(async () => {
      applyChange({ ids, status, at });
      const form = new FormData();
      ids.forEach((id) => form.append("id", id));
      form.set("status", status);
      await action(form);
    });
  };

  const g = groupTasks(tasks, today);
  const list = (items: TaskRowData[]) => (
    <ul className="-my-1 divide-y divide-border/60">
      {items.map((t) => <TaskRow key={t.id} task={t} today={today} onStatus={setStatus} />)}
    </ul>
  );
  const sections = [
    { id: "overdue", icon: AlertCircle, title: "Overdue", description: "Past their due date - do these first", rows: g.overdue },
    { id: "week", icon: CalendarClock, title: "Due this week", description: "Due in the next 7 days", rows: g.week },
    { id: "undated", icon: Inbox, title: "No due date", description: "Asks without a deadline, most important first", rows: g.undated },
    { id: "later", icon: CalendarDays, title: "Later", description: "Due after this week", rows: g.later },
  ];
  const firstHigh = sections.find((s) => s.rows.some((t) => t.priority === "high"))?.id ?? "overdue";
  const folded = (label: string, items: TaskRowData[]) => (
    <details className="group">
      <summary className="cursor-pointer list-none text-sm font-medium text-sky-700 hover:underline dark:text-sky-300">
        <span className="group-open:hidden">Show {items.length} {label}</span>
        <span className="hidden group-open:inline">Hide</span>
      </summary>
      <div className="mt-3">{list(items)}</div>
    </details>
  );

  return (
    <div className="min-h-full bg-slate-50/70 dark:bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {g.open} open · {g.high} high priority · {g.review.length + g.low.length} set aside for review or low priority
          </p>
        </header>

        <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatLink icon={AlertCircle} label="Overdue" value={String(g.overdue.length)} caption="Do these first" href="#overdue" />
          <StatLink icon={CalendarClock} label="Due this week" value={String(g.week.length)} caption="Next 7 days" href="#week" />
          <StatLink icon={Flag} label="High priority" value={String(g.high)} caption="People and money" href={`#${firstHigh}`} />
          <StatLink icon={Sparkles} label="To clean up" value={String(g.review.length)} caption="Lapsed or stale" href="#review" />
        </section>

        {/* Stacked, not side by side: 23 undated tasks next to 2 later ones left
            half the page empty. An empty section is left out; its tile still shows 0. */}
        {sections.filter((s) => s.rows.length).map((s) => (
          <div key={s.id} id={s.id} className="min-w-0 scroll-mt-6">
            <SectionCard icon={s.icon} title={`${s.title} (${s.rows.length})`} description={s.description}>
              {list(s.rows)}
            </SectionCard>
          </div>
        ))}

        {g.review.length > 0 && (
          <div id="review" className="scroll-mt-6">
            <SectionCard icon={Sparkles} title={`Clean up (${g.review.length})`} description="Their date has passed or they are long overdue - close them or mark them done">
              {list(g.review)}
            </SectionCard>
          </div>
        )}

        {g.low.length > 0 && (
          <SectionCard icon={Clock} title={`Low priority (${g.low.length})`} description="Optional or automated: offers, renewals with a discount, surveys, votes, codes">
            {folded("tasks", g.low)}
          </SectionCard>
        )}

        {g.done.length > 0 && (
          <SectionCard icon={CheckCircle2} title="Recently completed" description="The last 10 you marked done">
            {list(g.done)}
          </SectionCard>
        )}

        {g.dismissed.length > 0 && (
          <SectionCard icon={Archive} title={`Dismissed (${g.dismissed.length})`} description="Closed without doing, by you or automatically - restore one if it still matters">
            {folded("dismissed", g.dismissed)}
          </SectionCard>
        )}

        {tasks.length === 0 && (
          <EmptyState>No tasks yet - they are created from your emails and meetings automatically.</EmptyState>
        )}
      </div>
    </div>
  );
}
