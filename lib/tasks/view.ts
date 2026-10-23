import { reviewReason } from "@/lib/tasks/priority";

// Shared by the Tasks page (server) and its interactive view (client), so it
// lives in a plain module: a "use client" file cannot export to a server one.

// "expired" is closed by the daily job or a clean-up, "dismissed" by the founder.
export type TaskStatus = "pending" | "snoozed" | "done" | "dismissed" | "expired";
export type TaskRowData = {
  id: string;
  title: string;
  priority: string | null;
  status: TaskStatus;
  due_date: string | null;
  ai_reasoning: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string | null;
  contacts: { name: string | null; email: string | null } | null;
  note?: string;
};

const IST = "Asia/Kolkata";
const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
const changedAt = (t: TaskRowData) => Date.parse(t.updated_at ?? t.created_at);

// Each open task lands in one place. Lapsed and long-overdue tasks go to Clean
// up rather than Overdue - a gift card that expired on 12 Oct cannot be
// redeemed - and low-priority ones are folded away, so the sections above them
// are what actually needs the founder. Days are IST calendar days, as in the
// daily brief.
export function groupTasks(rows: TaskRowData[], today: string) {
  const daysUntil = (t: TaskRowData) => (t.due_date ? Math.round((Date.parse(istDay(t.due_date)) - Date.parse(today)) / 864e5) : null);
  const byPriority = (a: TaskRowData, b: TaskRowData) =>
    (RANK[a.priority ?? "medium"] ?? 1) - (RANK[b.priority ?? "medium"] ?? 1) ||
    (a.due_date && b.due_date ? Date.parse(a.due_date) - Date.parse(b.due_date) : Date.parse(b.created_at) - Date.parse(a.created_at));

  const g = { overdue: [] as TaskRowData[], week: [] as TaskRowData[], later: [] as TaskRowData[], undated: [] as TaskRowData[], review: [] as TaskRowData[], low: [] as TaskRowData[] };
  for (const t of rows) {
    if (t.status !== "pending" && t.status !== "snoozed") continue;
    const d = daysUntil(t);
    const review = reviewReason(t.title, d);
    if (review) g.review.push({ ...t, note: review === "lapsed" ? `Date passed ${shortDate(istDay(t.due_date!))}` : `${-d!} days overdue` });
    else if (t.priority === "low") g.low.push(t);
    else if (d === null) g.undated.push(t);
    else if (d < 0) g.overdue.push(t);
    else if (d <= 7) g.week.push(t);
    else g.later.push(t);
  }
  Object.values(g).forEach((list) => list.sort(byPriority));
  const latest = (...statuses: TaskStatus[]) => rows.filter((t) => statuses.includes(t.status)).sort((a, b) => changedAt(b) - changedAt(a));
  const open = rows.filter((t) => t.status === "pending" || t.status === "snoozed");
  return {
    ...g,
    done: latest("done").slice(0, 10),
    dismissed: latest("dismissed", "expired").slice(0, 20),
    open: open.length,
    high: open.filter((t) => t.priority === "high" && !g.review.some((r) => r.id === t.id)).length,
  };
}
