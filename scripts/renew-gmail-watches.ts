import { createClient } from "@supabase/supabase-js";
import { watchGmailInbox } from "@/lib/integrations/gmail";

async function main() {
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
  if (!integrations?.length) {
    console.log("No active Google integrations found.");
    process.exit(0);
  }

  for (const integration of integrations) {
    const { user_id, external_account_id } = integration;
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
      console.log(`✓ ${external_account_id} — watch set, expires ${new Date(Number(expiration)).toDateString()}`);
    } catch (err: any) {
      console.error(`✗ ${external_account_id}:`, err.message);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main();
