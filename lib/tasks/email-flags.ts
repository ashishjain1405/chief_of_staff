import type { SupabaseClient } from "@supabase/supabase-js";

type Status = "pending" | "snoozed" | "done" | "dismissed" | "expired";

// A task stands for the email that raised it and the rest of that
// conversation, so closing it answers them too: Done marks them handled,
// Dismiss or expiry drops the "needs action" flag. Without this the
// dashboard's "Needs your action" showed 5+ with every task closed - 115
// emails still flagged. Restoring a task flags its own email again.
export async function syncEmailsWithTasks(db: SupabaseClient, taskIds: string[], status: Status) {
  if (!taskIds.length || status === "snoozed") return;
  const { data: tasks } = await db.from("tasks").select("source_id").in("id", taskIds).eq("source_type", "email");
  const sourceIds = (tasks ?? []).map((t) => t.source_id as string | null).filter((id): id is string => !!id);
  if (!sourceIds.length) return;

  if (status === "pending") {
    const { error } = await db.from("communications").update({ requires_action: true, action_taken: false }).in("id", sourceIds);
    if (error) throw new Error(`communications: ${error.message}`);
    return;
  }

  const values = status === "done" ? { action_taken: true } : { requires_action: false };
  const { data: sources } = await db.from("communications").select("user_id, thread_id").in("id", sourceIds);
  const { error } = await db.from("communications").update(values).in("id", sourceIds);
  if (error) throw new Error(`communications: ${error.message}`);
  // The worker runs this across users, and Gmail thread ids are per mailbox.
  const threadsByUser = new Map<string, Set<string>>();
  for (const s of sources ?? []) {
    if (!s.thread_id) continue;
    threadsByUser.set(s.user_id, (threadsByUser.get(s.user_id) ?? new Set()).add(s.thread_id));
  }
  for (const [userId, threads] of threadsByUser) {
    const { error: threadError } = await db.from("communications").update(values)
      .eq("user_id", userId).in("thread_id", [...threads]).eq("requires_action", true).eq("action_taken", false);
    if (threadError) throw new Error(`communications: ${threadError.message}`);
  }
}
