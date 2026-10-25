/**
 * One-off repair: emails still flagged "needs action" although the task that
 * stood for them was closed before lib/tasks/email-flags existed. Applies the
 * same rule: Done marks the email handled; dismissed or expired drops the flag.
 * An email covers its conversation, so a closed task in the same thread
 * counts, as does one from the same sender when the email never got its own
 * task (it was skipped as a duplicate of that sender's open task).
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/clear-closed-task-flags.ts
 *   ...                                                                            --apply
 */

import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const OPEN = new Set(["pending", "snoozed"]);
type Task = { source_id: string | null; contact_id: string | null; status: string; updated_at: string };

async function main() {
  const { data: emails, error } = await db.from("communications")
    .select("id, user_id, thread_id, contact_id, subject, occurred_at").eq("requires_action", true).eq("action_taken", false);
  if (error) throw new Error(error.message);
  const flagged = emails ?? [];
  const users = [...new Set(flagged.map((e) => e.user_id))];
  const { data: taskRows } = await db.from("tasks").select("source_id, contact_id, status, updated_at").eq("source_type", "email").in("user_id", users);
  const tasks = (taskRows ?? []) as Task[];
  const threadOf = new Map<string, string>();
  const ids = tasks.map((t) => t.source_id).filter((id): id is string => !!id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("communications").select("id, thread_id").in("id", ids.slice(i, i + 200));
    for (const c of data ?? []) if (c.thread_id) threadOf.set(c.id, c.thread_id);
  }
  const latest = (list: Task[]) => list.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const plan = { done: [] as string[], cleared: [] as string[], kept: [] as string[] };
  const why = new Map<string, number>();
  for (const e of flagged) {
    const own = tasks.filter((t) => t.source_id === e.id);
    const thread = e.thread_id ? tasks.filter((t) => t.source_id && threadOf.get(t.source_id) === e.thread_id) : [];
    const sender = !own.length && e.contact_id ? tasks.filter((t) => t.contact_id === e.contact_id) : [];
    const [rule, cover] = own.length ? ["its own task", own] : thread.length ? ["a task in its thread", thread] : sender.length ? ["a task from the same sender", sender] : ["nothing", []];
    if (!cover.length || cover.some((t) => OPEN.has(t.status))) { plan.kept.push(e.id); why.set(`kept: covered by ${rule}`, (why.get(`kept: covered by ${rule}`) ?? 0) + 1); continue; }
    const status = latest(cover).status;
    (status === "done" ? plan.done : plan.cleared).push(e.id);
    why.set(`${status} via ${rule}`, (why.get(`${status} via ${rule}`) ?? 0) + 1);
  }
  console.log(`${flagged.length} flagged emails: ${plan.done.length} marked handled, ${plan.cleared.length} unflagged, ${plan.kept.length} left as they are`);
  for (const [k, n] of why) console.log(`  ${k}: ${n}`);
  for (const e of flagged.filter((x) => plan.kept.includes(x.id)).slice(0, 10)) console.log(`  kept: ${e.occurred_at.slice(0, 10)} ${(e.subject ?? "").slice(0, 70)}`);
  if (!APPLY) return console.log("\nDry run - nothing written. Re-run with --apply.");

  for (const [values, list] of [[{ action_taken: true }, plan.done], [{ requires_action: false }, plan.cleared]] as const) {
    for (let i = 0; i < list.length; i += 200) {
      const { error: e } = await db.from("communications").update(values).in("id", list.slice(i, i + 200));
      if (e) throw new Error(e.message);
    }
  }
  console.log("\nApplied.");
}

main().catch((e) => { console.error(e); process.exit(1); });
