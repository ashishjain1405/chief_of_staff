/**
 * One-time clear of open tasks that the current rules would never have created.
 *
 * 43 of 70 open tasks dated from the September backfill, before the task gate,
 * the same-sender duplicate check and auto-expiry existed - those apply only
 * to new mail. This runs the same shared rules over what is already open:
 *   - not a task (lib/tasks/gate noiseReason): one-time codes; votes, events,
 *     courses, surveys, donations and offers from companies; conditional notices
 *   - date passed on a date-bound task from a company (reviewReason "lapsed")
 *   - the same ask restated (isSimilarTaskTitle, same sender, or any sender for
 *     a company): the newest is kept
 *   - low priority, no date, from a company, open 14+ days
 * Shareholder-vote emails (AGM, EGM, postal ballot, proxy vote) from companies
 * also lose their "needs your action" flag, so they leave the inbox's action
 * list and the daily brief - the founder decided these are not tasks.
 * Tasks from people and money owed are never closed, except as a duplicate of
 * the same sender's identical ask. Closed as "expired": listed under Dismissed
 * on the Tasks page with Restore, and not counted as the founder's dismissals.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/clean-task-noise.ts
 *   ...                                                                    --apply
 */

import { createClient } from "@supabase/supabase-js";
import { isPersonalSender, isShareholderVote, noiseReason } from "@/lib/tasks/gate";
import { owesMoney, reviewReason } from "@/lib/tasks/priority";
import { isSimilarTaskTitle } from "@/lib/tasks/similar";

const APPLY = process.argv.includes("--apply");
const AGE_OUT_DAYS = 14;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Contact = { email: string | null } | { email: string | null }[] | null;
type Row = { id: string; title: string; priority: string | null; due_date: string | null; created_at: string; contact_id: string | null; source_id: string | null; contacts: Contact };
const emailOf = (c: Contact) => (Array.isArray(c) ? c[0]?.email : c?.email) ?? "";

async function main() {
  const { data, error } = await db.from("tasks")
    .select("id, title, priority, due_date, created_at, contact_id, source_id, contacts(email)")
    .eq("source_type", "email").in("status", ["pending", "snoozed"]).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const email = (t: Row) => emailOf(t.contacts);
  const { data: sources } = await db.from("communications").select("id, subject").in("id", rows.map((t) => t.source_id).filter((id): id is string => !!id));
  const subject = new Map((sources ?? []).map((c) => [c.id, (c.subject ?? "") as string]));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const daysUntil = (t: Row) => (t.due_date ? Math.round((Date.parse(new Date(t.due_date).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })) - Date.parse(today)) / 864e5) : null);

  const close = new Map<string, string>();
  for (const t of rows) {
    const from = email(t);
    const person = isPersonalSender(from);
    const noise = noiseReason(t.title, from, subject.get(t.source_id ?? "") ?? "");
    if (noise) close.set(t.id, noise);
    else if (!person && !owesMoney(t.title) && reviewReason(t.title, daysUntil(t)) === "lapsed") close.set(t.id, "date passed");
  }

  // Newest first, so the kept copy of a restated ask is the latest one.
  const kept: Row[] = [];
  for (const t of rows) {
    if (close.has(t.id)) continue;
    const company = !isPersonalSender(email(t));
    const twin = kept.find((k) => (k.contact_id === t.contact_id || (company && !isPersonalSender(email(k)))) && isSimilarTaskTitle(k.title, t.title));
    if (twin) close.set(t.id, `duplicate of "${twin.title.slice(0, 50)}"`);
    else kept.push(t);
  }

  const ageCutoff = Date.now() - AGE_OUT_DAYS * 864e5;
  for (const t of kept) {
    if (t.priority === "low" && !t.due_date && !isPersonalSender(email(t)) && !owesMoney(t.title) && Date.parse(t.created_at) < ageCutoff) {
      close.set(t.id, `low priority, open ${AGE_OUT_DAYS}+ days`);
    }
  }

  const groups: Record<string, string[]> = {};
  for (const t of rows) {
    const why = close.get(t.id);
    if (!why) continue;
    const key = why.startsWith("duplicate") ? "same ask restated" : why;
    (groups[key] ??= []).push(`${t.title.slice(0, 80)}${why.startsWith("duplicate") ? `  <- ${why}` : ""}`);
  }
  console.log(`${rows.length} open email tasks: close ${close.size}, keep ${rows.length - close.size}\n`);
  for (const [why, list] of Object.entries(groups)) console.log(`${why.toUpperCase()} (${list.length})\n${list.map((l) => `  ${l}`).join("\n")}\n`);
  const { data: flagged } = await db.from("communications").select("id, subject, contacts(email)").eq("requires_action", true).eq("action_taken", false);
  const votes = (flagged ?? []).filter((c) => !isPersonalSender(emailOf(c.contacts as Contact)) && isShareholderVote(c.subject ?? ""));
  console.log(`SHAREHOLDER-VOTE EMAILS no longer "needs your action" (${votes.length})\n${votes.map((c) => `  ${(c.subject ?? "").slice(0, 80)}`).join("\n")}\n`);
  console.log(`KEPT (${rows.length - close.size})\n${rows.filter((t) => !close.has(t.id)).map((t) => `  ${(t.priority ?? "").padEnd(6)} ${t.title.slice(0, 80)}`).join("\n")}\n`);
  if (!APPLY) return console.log("Dry run - nothing written. Re-run with --apply.");

  const { error: updateError } = await db.from("tasks").update({ status: "expired" }).in("id", [...close.keys()]).in("status", ["pending", "snoozed"]);
  if (updateError) throw updateError;
  if (votes.length) {
    const { error: flagError } = await db.from("communications").update({ requires_action: false }).in("id", votes.map((c) => c.id));
    if (flagError) throw flagError;
  }
  console.log(`Closed ${close.size} tasks as expired; cleared "needs your action" on ${votes.length} vote emails.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
