export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TasksView } from "@/components/tasks/tasks-view";
import type { TaskRowData } from "@/lib/tasks/view";

const TASK_STATUSES = new Set(["pending", "snoozed", "done", "dismissed"]);
const SELECT = "id, title, priority, status, due_date, ai_reasoning, source_type, source_id, created_at, updated_at, contacts(name, email)";

// Server actions are public POST endpoints. The session client keeps this
// behind RLS, so a caller can only ever touch their own rows; the service-role
// client used here before updated any task by id. updated_at is set here so
// Recently completed and Dismissed are ordered by when the founder acted.
async function updateTaskStatus(formData: FormData) {
  "use server";
  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || typeof status !== "string" || !TASK_STATUSES.has(status)) return;
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Could not update the task");
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

export default async function TasksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const closed = (status: string, limit: number) =>
    supabase.from("tasks").select(SELECT).eq("user_id", user.id).eq("status", status).order("updated_at", { ascending: false }).limit(limit);
  const [open, done, dismissed] = await Promise.all([
    supabase.from("tasks").select(SELECT).eq("user_id", user.id).in("status", ["pending", "snoozed"]),
    closed("done", 10),
    closed("dismissed", 20),
  ]);
  const rows = [...(open.data ?? []), ...(done.data ?? []), ...(dismissed.data ?? [])].map((t) => ({
    ...t,
    contacts: Array.isArray(t.contacts) ? t.contacts[0] ?? null : t.contacts,
  })) as TaskRowData[];

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return <TasksView rows={rows} today={today} action={updateTaskStatus} />;
}
