import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { watchGmailInbox } from "@/lib/integrations/gmail";

export async function renewGmailWatches(_job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("user_id, external_account_id")
    .eq("provider", "google")
    .eq("is_active", true);

  if (error) throw error;
  if (!integrations?.length) return;

  for (const { user_id, external_account_id } of integrations) {
    try {
      const { historyId, expiration } = await watchGmailInbox(user_id);
      await supabase
        .from("integrations")
        .update({
          metadata: {
            last_history_id: historyId,
            watch_expires_at: new Date(Number(expiration)).toISOString(),
          },
        })
        .eq("user_id", user_id)
        .eq("provider", "google");
      console.log(`[renew-gmail-watches] ✓ ${external_account_id}`);
    } catch (err: any) {
      console.error(`[renew-gmail-watches] ✗ ${external_account_id}:`, err.message);
    }
  }
}
