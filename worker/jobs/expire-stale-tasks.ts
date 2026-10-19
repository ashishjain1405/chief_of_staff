import { createClient } from "@supabase/supabase-js";
import { isAutomatedMail } from "@/lib/tasks/gate";
import { isKnownFinancialDomain } from "@/lib/finance/senders";

const GRACE_DAYS = 3;

// A task raised by an automated sender is tied to its date: the vote closed,
// the webinar ended, the gift card lapsed, the delivery came. Once the date has
// passed it can no longer be done, yet it sat at the top of Overdue - 17 of 80
// open tasks were like that. A person's ask can still be answered late, so
// tasks from people, meetings and undated tasks are left alone.
//
// Closed as "dismissed" because that is the status every list already hides.
export async function expireStaleTasks({ apply = true } = {}): Promise<string[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, source_id")
    .eq("status", "pending")
    .eq("source_type", "email")
    .lt("due_date", cutoff);
  if (error) throw error;
  if (!tasks?.length) return [];

  const { data: comms, error: commsError } = await supabase
    .from("communications")
    .select("id, channel_metadata, contacts(email)")
    .in("id", tasks.map((t) => t.source_id));
  if (commsError) throw commsError;

  const automated = new Set(
    (comms ?? [])
      .filter((c: any) => {
        const senderEmail = c.contacts?.email ?? "";
        return isAutomatedMail({
          senderEmail,
          isBulk: !!c.channel_metadata?.list_unsubscribe,
          isFinancialDomain: isKnownFinancialDomain(senderEmail),
        });
      })
      .map((c) => c.id)
  );

  const expired = tasks.filter((t) => automated.has(t.source_id));
  if (apply && expired.length > 0) {
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status: "dismissed" })
      .in("id", expired.map((t) => t.id));
    if (updateError) throw updateError;
  }

  console.log(`[expire-stale-tasks] ${apply ? "closed" : "would close"} ${expired.length} of ${tasks.length} overdue task(s)`);
  return expired.map((t) => t.title);
}
