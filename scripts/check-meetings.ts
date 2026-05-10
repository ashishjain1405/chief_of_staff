import { createClient } from "@supabase/supabase-js";

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const TARGET_USER = "2ef78607-fad8-433b-ac0f-42688e0b02d5";

  const { data, error } = await s.from("meetings").select("title, start_time").eq("user_id", TARGET_USER).order("start_time", { ascending: false });
  console.log(`IIMCal user meetings: ${data?.length ?? 0}`, error?.message ?? "");
  console.log(JSON.stringify(data?.slice(0, 5), null, 2));

  // Try a test upsert to see if schema rejects it
  const { error: upsertError } = await s.from("meetings").upsert({
    user_id: TARGET_USER,
    source: "google_calendar",
    external_id: "test-schema-check",
    title: "Test",
    start_time: new Date().toISOString(),
    end_time: new Date().toISOString(),
    attendees: [],
    status: "scheduled",
  }, { onConflict: "user_id,source,external_id" });
  console.log("\nTest upsert:", upsertError?.message ?? "OK");

  // Clean up
  await s.from("meetings").delete().eq("external_id", "test-schema-check").eq("user_id", TARGET_USER);
}

main();
