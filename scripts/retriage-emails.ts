/**
 * Re-runs triage over already-ingested mail with the current pipeline.
 *
 * Existing categories came from triage as it was before: no requires_action
 * guidance, temperature 1.0, and the whole quoted thread in the prompt. So mail
 * was misfiled in both directions - Kamal's "how do you plan to differentiate?"
 * landed in "transactions" because of the wire-transfer history quoted beneath
 * it, and never produced a task.
 *
 * Deliberately NOT worker/jobs/backfill-categories.ts, which passes
 * body_summary to triage rather than the body. Classifying a one-line summary
 * cannot exercise the quote-stripping fix, and it only writes email_category -
 * it never revisits requires_action or creates the tasks that were missed.
 *
 * Mirrors the worker: same triageEmail call with recipients, the same shared
 * gate, the same deadline resolver, the same per-email and per-thread
 * suppression. body_summary is left alone on purpose - the memory_chunks
 * embeddings are built from it, and rewriting summaries here would strand them.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/retriage-emails.ts
 *   ...                                                                      --apply
 *   ...                                                            --limit 50 --apply
 */

import { createClient } from "@supabase/supabase-js";
import { triageEmail } from "@/lib/ai/claude";
import { getSenderHint, isKnownFinancialDomain } from "@/lib/finance/senders";
import { LOW_SIGNAL_CATEGORIES } from "@/lib/inbox/categories";
import { shouldCreateTask } from "@/lib/tasks/gate";
import { resolveFollowUpDeadline } from "@/lib/tasks/deadline";

const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;

const PAGE = 200;

// gpt-4o-mini is capped at 200k tokens/min on this account and each triage call
// costs ~3.5k, so the ceiling is roughly 57 emails/min. Concurrency 5 pushed
// ~150/min and 64 of 200 emails came back 429 - silently skipped, because the
// loop below only logged them. Two in flight lands under the cap with room for
// the retries to breathe.
const CONCURRENCY = 2;


const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Comm = {
  id: string;
  user_id: string;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  thread_id: string | null;
  contact_id: string | null;
  email_category: string | null;
  channel_metadata: Record<string, unknown> | null;
  contacts: { name?: string; email?: string } | null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

async function main() {
  const { data: users } = await supabase.from("users").select("id, email, business_context");
  const user = users?.[0];
  if (!user) throw new Error("no user");

  // Threads that already hold an open task, so this run does not add a second.
  const { data: openTasks } = await supabase
    .from("tasks")
    .select("source_id")
    .eq("user_id", user.id)
    .eq("source_type", "email")
    .in("status", ["pending", "snoozed"]);

  const openThreads = new Set<string>();
  for (const t of openTasks ?? []) {
    const { data: c } = await supabase
      .from("communications")
      .select("thread_id")
      .eq("id", t.source_id)
      .maybeSingle();
    if (c?.thread_id) openThreads.add(c.thread_id);
  }

  // Any task at all for an email, so a re-run cannot duplicate it.
  const { data: allTasks } = await supabase
    .from("tasks")
    .select("source_id")
    .eq("user_id", user.id)
    .eq("source_type", "email");
  const emailsWithTask = new Set((allTasks ?? []).map((t) => t.source_id));

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} - ${openThreads.size} thread(s) already hold an open task\n`);

  const migrations: Record<string, number> = {};
  const newTasks: string[] = [];
  let scanned = 0;
  let categoryChanged = 0;
  let failed = 0;
  let cursor = "9999-12-31T00:00:00Z";

  while (scanned < LIMIT) {
    // Cursor paginated: range() past 1000 rows silently truncates in PostgREST.
    const { data: page } = await supabase
      .from("communications")
      .select("id, user_id, subject, body, occurred_at, thread_id, contact_id, email_category, channel_metadata, contacts(name, email)")
      .eq("user_id", user.id)
      .not("body", "is", null)
      .lt("occurred_at", cursor)
      .order("occurred_at", { ascending: false })
      .limit(Math.min(PAGE, LIMIT - scanned));

    const rows = (page ?? []) as unknown as Comm[];
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].occurred_at;

    const results = await mapLimit(rows, CONCURRENCY, async (comm) => {
      const senderEmail = comm.contacts?.email ?? "";
      const senderInfo = `${comm.contacts?.name ?? ""} <${senderEmail}>${getSenderHint(senderEmail)}`;
      const to = String((comm.channel_metadata as any)?.to ?? "").trim();
      const recipientInfo = `the founder's own address is ${user.email}; this email's To: ${to || "unknown"}`;

      try {
        // triageEmail strips the quoted thread internally.
        // triageEmail retries 429s internally via withAiRetry.
        const triage = await triageEmail(user.business_context ?? {}, senderInfo, comm.body ?? "", recipientInfo);
        return { comm, senderEmail, triage, error: null as string | null };
      } catch (err: any) {
        return { comm, senderEmail, triage: null, error: err.message as string };
      }
    });

    for (const { comm, senderEmail, triage, error } of results) {
      scanned++;
      if (error || !triage) {
        failed++;
        console.error(`  failed ${comm.id}: ${error}`);
        continue;
      }

      const capped = LOW_SIGNAL_CATEGORIES.has(triage.email_category)
        ? Math.min(triage.importance_score, 0.3)
        : triage.importance_score;

      if (triage.email_category !== comm.email_category) {
        categoryChanged++;
        const key = `${comm.email_category} -> ${triage.email_category}`;
        migrations[key] = (migrations[key] ?? 0) + 1;
      }

      if (APPLY) {
        await supabase
          .from("communications")
          .update({
            email_category: triage.email_category,
            importance_score: capped,
            requires_action: triage.requires_action,
            category_processed: true,
            // Keep the old category so this run is reversible. Overwriting it
            // outright would leave no way back if the new classification reads
            // worse across the inbox.
            channel_metadata: {
              ...((comm.channel_metadata as Record<string, unknown>) ?? {}),
              retriage_previous_category: comm.email_category,
              retriaged_at: new Date().toISOString(),
            },
          })
          .eq("id", comm.id);
      }

      const allowed = shouldCreateTask({
        category: triage.email_category,
        requiresAction: triage.requires_action,
        senderEmail,
        founderEmail: user.email,
        isFinancialDomain: isKnownFinancialDomain(senderEmail),
      });

      const threadKey = comm.thread_id ?? comm.id;
      if (!allowed || emailsWithTask.has(comm.id) || openThreads.has(threadKey)) continue;

      newTasks.push(`[${triage.email_category}] ${triage.action_description ?? comm.subject}`);
      openThreads.add(threadKey);
      emailsWithTask.add(comm.id);

      if (APPLY) {
        await supabase.from("tasks").insert({
          user_id: comm.user_id,
          title: triage.action_description ?? `Reply to: ${comm.subject}`,
          source_type: "email",
          source_id: comm.id,
          contact_id: comm.contact_id,
          due_date: resolveFollowUpDeadline(triage.follow_up_deadline, comm.occurred_at),
          priority: capped >= 0.85 ? "high" : "medium",
          ai_reasoning: `Importance: ${capped.toFixed(2)}. ${triage.summary}`,
        });
      }
    }

    console.log(`  ${scanned} scanned, ${categoryChanged} recategorised, ${newTasks.length} task(s) to add`);
  }

  console.log(`\n=== CATEGORY CHANGES (${categoryChanged} of ${scanned}) ===`);
  for (const [k, v] of Object.entries(migrations).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  console.log(`\n=== TASKS ${APPLY ? "CREATED" : "THAT WOULD BE CREATED"} (${newTasks.length}) ===`);
  for (const t of newTasks) console.log(`  ${t.slice(0, 96)}`);

  if (failed > 0) {
    // Loud on purpose. A partially applied run leaves rows carrying stale
    // categories from the old triage, and the totals above would otherwise
    // read as a clean pass.
    console.error(`\n${failed} of ${scanned} email(s) could not be triaged and were left untouched.`);
    console.error(`Re-run to pick them up - already-updated rows simply get the same answer again.`);
  }

  if (!APPLY) console.log(`\nDRY RUN - nothing written. Re-run with --apply.`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
