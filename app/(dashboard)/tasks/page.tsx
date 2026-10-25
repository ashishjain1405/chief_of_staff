export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TasksView } from "@/components/tasks/tasks-view";
import type { TaskRowData } from "@/lib/tasks/view";
import { isPersonalSender } from "@/lib/tasks/gate";
import { conversationSubject } from "@/lib/tasks/similar";
import { syncEmailsWithTasks } from "@/lib/tasks/email-flags";

const TASK_STATUSES = new Set(["pending", "snoozed", "done", "dismissed"]);
const SELECT = "id, title, priority, status, due_date, ai_reasoning, source_type, source_id, contact_id, created_at, updated_at, contacts(name, email)";

// Server actions are public POST endpoints. The session client keeps this
// behind RLS, so a caller can only ever touch their own rows; the service-role
// client used here before updated any task by id. updated_at is set here so
// Recently completed and Dismissed are ordered by when the founder acted.
// Several ids close a whole conversation at once.
async function updateTaskStatus(formData: FormData) {
  "use server";
  const ids = formData.getAll("id").filter((v): v is string => typeof v === "string");
  const status = formData.get("status");
  if (!ids.length || typeof status !== "string" || !TASK_STATUSES.has(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) throw new Error("Could not update the task");
  await syncEmailsWithTasks(supabase, ids, status as "pending" | "snoozed" | "done" | "dismissed");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const closed = (statuses: string[], limit: number) =>
    supabase.from("tasks").select(SELECT).eq("user_id", user.id).in("status", statuses).order("updated_at", { ascending: false }).limit(limit);
  const [open, done, dismissed] = await Promise.all([
    supabase.from("tasks").select(SELECT).eq("user_id", user.id).in("status", ["pending", "snoozed"]),
    closed(["done"], 10),
    closed(["dismissed", "expired"], 20),
  ]);
  // Conversation of each open task: the Gmail thread, and for a person also
  // the subject without "Re:" or "- Doc 2", since they often start a new
  // thread for the same conversation. A company reuses one subject for every
  // alert, so it is grouped by thread only.
  const sourceIds = (open.data ?? []).map((t) => t.source_id).filter((id): id is string => !!id);
  const { data: sources } = sourceIds.length
    ? await supabase.from("communications").select("id, thread_id, subject").in("id", sourceIds)
    : { data: [] };
  const source = new Map((sources ?? []).map((c) => [c.id, c]));
  const groupOf = (t: { id: string; source_id: string | null; contact_id?: string | null; email: string }) => {
    const c = t.source_id ? source.get(t.source_id) : undefined;
    if (!c) return t.id;
    if (isPersonalSender(t.email) && t.contact_id && c.subject) return `person:${t.contact_id}:${conversationSubject(c.subject)}`;
    return c.thread_id ? `thread:${c.thread_id}` : t.id;
  };

  const rows = [...(open.data ?? []), ...(done.data ?? []), ...(dismissed.data ?? [])].map((t) => {
    const contacts = Array.isArray(t.contacts) ? t.contacts[0] ?? null : t.contacts;
    const isOpen = t.status === "pending" || t.status === "snoozed";
    return { ...t, contacts, group: isOpen ? groupOf({ ...t, email: contacts?.email ?? "" }) : undefined };
  }) as TaskRowData[];

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return <TasksView rows={rows} today={today} action={updateTaskStatus} />;
}
