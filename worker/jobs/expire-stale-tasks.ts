import { createClient } from "@supabase/supabase-js";
import { isAutomatedMail, isPersonalSender } from "@/lib/tasks/gate";
import { isKnownFinancialDomain } from "@/lib/finance/senders";
import { owesMoney, reviewReason } from "@/lib/tasks/priority";
import { syncEmailsWithTasks } from "@/lib/tasks/email-flags";

const GRACE_DAYS = 3;
const AGE_OUT_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

// Runs daily at 07:00 IST and closes what can no longer be done or was never
// worth doing. Closed as "expired", not "dismissed": every list shows only
// pending and snoozed, the Tasks page lists expired tasks under Dismissed with
// Restore, and learning from dismissals counts only the founder's own clicks.
//
// 1. Overdue past the grace period, from an automated sender: the vote closed,
//    the webinar ended, the delivery came - 17 of 80 open tasks were like that.
// 2. Date-bound and past its date, from any company: the gift card from
//    expirynotification@qwikcilver.com was not recognised as automated and sat
//    at the top of Overdue ten days after it lapsed.
// 3. Low priority, no date, from a company, open for AGE_OUT_DAYS: a reminder
//    nobody acted on in two weeks will not be acted on.
// A person's ask can still be answered late, and money owed is never closed.
export async function expireStaleTasks({ apply = true } = {}): Promise<string[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const graceCutoff = new Date(Date.now() - GRACE_DAYS * DAY).toISOString();
  const ageCutoff = new Date(Date.now() - AGE_OUT_DAYS * DAY).toISOString();
  const [overdue, aged] = await Promise.all([
    supabase.from("tasks").select("id, title, priority, source_id")
      .eq("status", "pending").eq("source_type", "email").lt("due_date", graceCutoff),
    supabase.from("tasks").select("id, title, priority, source_id")
      .eq("status", "pending").eq("source_type", "email").eq("priority", "low").is("due_date", null).lt("created_at", ageCutoff),
  ]);
  if (overdue.error) throw overdue.error;
  if (aged.error) throw aged.error;
  const candidates = [...(overdue.data ?? []), ...(aged.data ?? [])];
  if (!candidates.length) return [];

  const { data: comms, error: commsError } = await supabase
    .from("communications")
    .select("id, channel_metadata, contacts(email)")
    .in("id", [...new Set(candidates.map((t) => t.source_id))]);
  if (commsError) throw commsError;
  const sender = new Map((comms ?? []).map((c: any) => [c.id, { email: (c.contacts?.email ?? "") as string, bulk: !!c.channel_metadata?.list_unsubscribe }]));

  const reasons = new Map<string, { title: string; why: string }>();
  for (const t of overdue.data ?? []) {
    const s = sender.get(t.source_id);
    if (!s || owesMoney(t.title)) continue;
    if (isAutomatedMail({ senderEmail: s.email, isBulk: s.bulk, isFinancialDomain: isKnownFinancialDomain(s.email) })) reasons.set(t.id, { title: t.title, why: "overdue, automated sender" });
    else if (!isPersonalSender(s.email) && reviewReason(t.title, -1) === "lapsed") reasons.set(t.id, { title: t.title, why: "date passed, company sender" });
  }
  for (const t of aged.data ?? []) {
    const s = sender.get(t.source_id);
    if (!s || isPersonalSender(s.email) || owesMoney(t.title) || reasons.has(t.id)) continue;
    reasons.set(t.id, { title: t.title, why: `low priority, open ${AGE_OUT_DAYS}+ days` });
  }

  if (apply && reasons.size > 0) {
    const { error: updateError } = await supabase.from("tasks").update({ status: "expired" }).in("id", [...reasons.keys()]);
    if (updateError) throw updateError;
    await syncEmailsWithTasks(supabase, [...reasons.keys()], "expired");
  }
  for (const r of reasons.values()) console.log(`[expire-stale-tasks] ${apply ? "closed" : "would close"} (${r.why}): ${r.title}`);
  console.log(`[expire-stale-tasks] ${apply ? "closed" : "would close"} ${reasons.size} of ${candidates.length} candidate task(s)`);
  return [...reasons.values()].map((r) => r.title);
}
