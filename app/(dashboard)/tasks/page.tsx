export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function updateTaskStatus(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  const status = formData.get("status") as string;
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = await createServiceClient();
  await supabase.from("tasks").update({ status }).eq("id", id);
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: tasks } = await supabase
    .from("tasks")
    .select(`id, title, description, priority, status, due_date, ai_reasoning, source_type, contacts(name, email)`)
    .eq("user_id", user.id)
    .neq("status", "dismissed")
    .order("due_date", { ascending: true })
    .order("priority", { ascending: false });

  const all = tasks ?? [];

  const now = new Date();
  const in3d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  // "Due Soon" used to mean due_date <= in3d with no lower bound, so a task
  // overdue by months was filed under it, and "This Week & Later" caught
  // !due_date, so 40 undated tasks were labelled as due this week. Something
  // overdue, something due tomorrow and something with no date at all are
  // three different states and each gets its own section.
  const pending = all.filter((t) => t.status === "pending");
  const overdue = pending.filter((t) => t.due_date && new Date(t.due_date) < now);
  const dueSoon = pending.filter(
    (t) => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= in3d
  );
  const later = pending.filter((t) => t.due_date && new Date(t.due_date) > in3d);
  const undated = pending.filter((t) => !t.due_date);
  const done = all.filter((t) => t.status === "done");

  const priorityColor = (p: string) =>
    p === "high" ? "destructive" : p === "medium" ? "secondary" : "outline";

  function TaskRow({ task }: { task: any }) {
    const contact = task.contacts as any;
    const isOverdue = task.due_date && new Date(task.due_date) < now;

    return (
      <div className="flex items-start gap-4 p-4 border-b last:border-0">
        <div className="flex-1 space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={priorityColor(task.priority) as any} className="text-xs">
              {task.priority}
            </Badge>
            {task.source_type && (
              <Badge variant="outline" className="text-xs">{task.source_type}</Badge>
            )}
            <p className="text-sm font-medium">{task.title}</p>
          </div>
          {contact?.name && (
            <p className="text-xs text-muted-foreground">Contact: {contact.name}</p>
          )}
          {task.ai_reasoning && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              AI: {task.ai_reasoning}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.due_date && (
            <span className={`text-xs ${isOverdue && task.status === "pending" ? "text-red-500" : "text-muted-foreground"}`}>
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
          {task.status === "pending" && (
            <form action={updateTaskStatus}>
              <input type="hidden" name="id" value={task.id} />
              <input type="hidden" name="status" value="done" />
              <Button type="submit" variant="outline" size="sm">Done</Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Tasks</h1>

      {([
        { label: "Overdue", rows: overdue },
        { label: "Due Soon", rows: dueSoon },
        { label: "Later", rows: later },
        { label: "No Due Date", rows: undated },
      ] as const).map(({ label, rows }) =>
        rows.length === 0 ? null : (
          <div key={label}>
            <h2 className="text-sm font-semibold mb-2">{label} ({rows.length})</h2>
            <div className="rounded-lg border overflow-hidden">
              {rows.map((t) => <TaskRow key={t.id} task={t} />)}
            </div>
          </div>
        )
      )}

      {done.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Completed ({done.length})</h2>
          <div className="rounded-lg border overflow-hidden opacity-60">
            {done.slice(0, 10).map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No tasks yet — they&apos;ll be extracted from emails and meetings automatically.
        </div>
      )}
    </div>
  );
}
