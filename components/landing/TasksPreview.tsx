import { AlertCircle } from "lucide-react";

// Sample tasks with the Tasks page's due chips and buttons.
const DUE = {
  overdue: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  today: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  tomorrow: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  later: "bg-muted text-muted-foreground",
};
const TASKS: { title: string; due: string; when: keyof typeof DUE; high?: boolean; from?: string; thread?: number }[] = [
  { title: "Submit the travel reimbursement claim", due: "Overdue · 22 Oct", when: "overdue", from: "Finance team" },
  { title: "Pay the electricity bill", due: "Today", when: "today", high: true },
  { title: "Reply to Priya about the lease", due: "Tomorrow", when: "tomorrow", high: true, from: "Priya", thread: 2 },
  { title: "Renew car insurance", due: "30 Oct", when: "later" },
  { title: "RSVP to Ananya's wedding", due: "7 Nov", when: "later", from: "Ananya" },
];
const pill = "rounded-full px-2 py-0.5 text-[11px] font-medium";

export function TasksPreview() {
  return (
    <figure aria-label="Example task list with due dates" className="flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Tasks</p>
        <p className="text-xs text-muted-foreground">1 overdue · 3 due this week</p>
      </div>
      <ul className="mt-3 divide-y divide-border/60">
        {TASKS.map((t) => (
          <li key={t.title} className="flex items-start gap-3 py-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 ${pill} ${DUE[t.when]}`}>
                  {t.when === "overdue" && <AlertCircle className="size-3" aria-hidden />}
                  {t.due}
                </span>
                {t.high && <span className={`${pill} bg-foreground/[0.06] font-semibold text-foreground`}>High priority</span>}
                {t.from && <span className="text-xs text-muted-foreground">{t.from}</span>}
              </div>
              {t.thread && <p className="mt-1.5 text-xs font-medium text-sky-700 dark:text-sky-300">+{t.thread} more from this conversation</p>}
            </div>
            <div className="flex shrink-0 gap-2" aria-hidden>
              <span className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground shadow-sm">Done</span>
              <span className="hidden rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground sm:inline">Dismiss</span>
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
