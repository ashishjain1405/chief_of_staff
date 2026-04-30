import { google } from "googleapis";
import { getAuthenticatedClient } from "../lib/integrations/google";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: user } = await sb.from("users").select("id").limit(1).single();
  const auth = await getAuthenticatedClient(user!.id);
  const gmail = google.gmail({ version: "v1", auth });
  const { data } = await gmail.users.messages.list({ userId: "me", maxResults: 5, labelIds: ["INBOX"] });
  console.log("Real Gmail message IDs:");
  data.messages?.forEach((m) => console.log(m.id));
  process.exit(0);
}

main();
