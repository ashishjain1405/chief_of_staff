/**
 * Re-derives priority for open email tasks with lib/tasks/priority.ts.
 *
 * Every task was created as "medium" unless importance reached 0.85, so all 70
 * open tasks read medium. Importance comes from the "Importance: 0.40." prefix
 * the worker writes into ai_reasoning, falling back to the email's score.
 * Meeting tasks are left alone.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/backfill-task-priority.ts
 *   ...                                                                       --apply
 */

import { createClient } from "@supabase/supabase-js";
import { isKnownFinancialDomain } from "@/lib/finance/senders";
import { taskPriority } from "@/lib/tasks/priority";

const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Row = { id: string; title: string; priority: string | null; ai_reasoning: string | null; source_id: string | null; contacts: { email: string | null } | { email: string | null }[] | null };

async function main() {
  const { data: tasks, error } = await db.from("tasks")
    .select("id, title, priority, ai_reasoning, source_id, contacts(email)")
    .eq("source_type", "email").in("status", ["pending", "snoozed"]);
  if (error) throw error;
  const rows = (tasks ?? []) as Row[];
  const { data: comms } = await db.from("communications").select("id, importance_score, channel_metadata")
    .in("id", rows.map((t) => t.source_id).filter((id): id is string => !!id));
  const comm = new Map((comms ?? []).map((c) => [c.id, c]));

  const changes: { id: string; from: string | null; to: string; title: string }[] = [];
  const totals: Record<string, number> = {};
  for (const t of rows) {
    const c = t.source_id ? comm.get(t.source_id) : undefined;
    const contact = Array.isArray(t.contacts) ? t.contacts[0] : t.contacts;
    const senderEmail = contact?.email ?? "";
    const stated = /Importance: (\d+(?:\.\d+)?)/.exec(t.ai_reasoning ?? "")?.[1];
    const importance = stated ? Number(stated) : Number(c?.importance_score ?? 0.5);
    const to = taskPriority({
      title: t.title, importance, senderEmail,
      isBulk: !!(c?.channel_metadata as { list_unsubscribe?: unknown } | null)?.list_unsubscribe,
      isFinancialDomain: isKnownFinancialDomain(senderEmail),
    });
    totals[to] = (totals[to] ?? 0) + 1;
    if (to !== t.priority) changes.push({ id: t.id, from: t.priority, to, title: t.title });
  }

  console.log(`${rows.length} open email tasks -> ${JSON.stringify(totals)}; ${changes.length} change.\n`);
  for (const p of ["high", "medium", "low"]) {
    const list = changes.filter((c) => c.to === p);
    if (list.length) console.log(`${p.toUpperCase()} (${list.length})\n${list.map((c) => `  ${c.title.slice(0, 90)}`).join("\n")}\n`);
  }
  if (!APPLY) return console.log("Dry run - nothing written. Re-run with --apply.");

  for (const c of changes) {
    const { error: updateError } = await db.from("tasks").update({ priority: c.to }).eq("id", c.id).eq("priority", c.from ?? "medium");
    if (updateError) throw new Error(`${c.id}: ${updateError.message}`);
  }
  console.log(`Updated ${changes.length} tasks.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
