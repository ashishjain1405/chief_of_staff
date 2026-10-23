import Link from "next/link";
import { AlertCircle, ArrowUpRight } from "lucide-react";
import { dueChip } from "@/components/dashboard/lists";
import type { TaskRowData, TaskStatus } from "@/lib/tasks/view";

// "Redeem the gift card before the expiry date." reads as a sentence; the list
// shows it as a title.
const title = (t: string) => t.trim().replace(/\.$/, "");
// ai_reasoning is "Importance: 0.40. <the email's summary>"; the score is for ranking, not reading.
const summary = (r: string | null) => (r ?? "").replace(/^Importance:\s*\d+(?:\.\d+)?\.\s*/, "").trim();
// Contacts saved as "piyush tyagi" are shown as "Piyush Tyagi", as in the brief.
const proper = (name: string) => (name === name.toLowerCase() && !name.includes("@") ? name.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase()) : name);
function sender(c: TaskRowData["contacts"]) {
  if (c?.name) return proper(c.name);
  const domain = c?.email?.split("@")[1];
  return domain ? domain.replace(/^(mail|email|alerts?|info|services?|inform|mailers?)\./, "") : null;
}

const button = "rounded-full px-3 py-1.5 text-xs font-medium transition-colors";

export function TaskRow({ task, today, onStatus }: { task: TaskRowData; today: string; onStatus: (id: string, status: TaskStatus) => void }) {
  const closed = task.status === "done" || task.status === "dismissed" || task.status === "expired";
  const chip = task.due_date && !task.note && !closed ? dueChip(task.due_date, today) : null;
  const from = sender(task.contacts);
  const detail = summary(task.ai_reasoning);

  return (
    <li id={`task-${task.id}`} className="flex scroll-mt-24 flex-col gap-3 py-3.5 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${closed ? "text-muted-foreground" : "text-foreground"} ${task.status === "done" ? "line-through" : ""}`}>{title(task.title)}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {chip && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.className}`}>
              {chip.overdue && <AlertCircle className="size-3" aria-hidden />}
              {chip.text}
            </span>
          )}
          {task.note && !closed && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{task.note}</span>
          )}
          {task.status === "expired" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Closed automatically</span>
          )}
          {task.priority === "high" && !closed && (
            <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-semibold text-foreground">High priority</span>
          )}
          {from && <span className="text-xs text-muted-foreground">{from}</span>}
          {task.source_type === "email" && task.source_id && (
            <Link href={`/inbox/${task.source_id}`} className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300">
              Open email
              <ArrowUpRight className="size-3" aria-hidden />
            </Link>
          )}
        </div>
        {detail && !closed && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:line-clamp-1">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {closed ? (
          <button type="button" onClick={() => onStatus(task.id, "pending")} className={`${button} text-muted-foreground hover:bg-muted hover:text-foreground`}>
            Restore
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onStatus(task.id, "done")} className={`${button} border border-border bg-background px-3.5 text-foreground shadow-sm hover:bg-muted`}>
              Done
            </button>
            <button type="button" onClick={() => onStatus(task.id, "dismissed")} className={`${button} text-muted-foreground hover:bg-muted hover:text-foreground`}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </li>
  );
}
