import { createClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/lib/ai/intent/classify";
import { resolveEntities } from "@/lib/ai/retrieval/resolve";
import { buildRetrievalPlan } from "@/lib/ai/retrieval/plan";
import { executeRetrievalPlan } from "@/lib/ai/retrieval/execute";

const QUERY = process.argv[2] ?? "meetings in last 30 days";
const USER_ID = "2ef78607-fad8-433b-ac0f-42688e0b02d5";

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log(`Query: "${QUERY}"\n`);

  const intent = await classifyIntent(QUERY, null);
  console.log("Intent:", JSON.stringify({ primary: intent.primary, weights: intent.retrieval_weights, temporal: intent.temporal }, null, 2));

  const resolved = await resolveEntities(intent.entities, intent.temporal, USER_ID, supabase as any);
  console.log("\nResolved dateRange:", resolved.resolvedDateRange);

  const plan = buildRetrievalPlan(intent, resolved, QUERY);
  console.log("\nPlan sources:", plan.map(s => s.source));
  console.log("Plan:", JSON.stringify(plan.map(s => ({ source: s.source, dateRange: (s.filters as any)?.dateRange })), null, 2));

  const { rawResults, sourceStatuses } = await executeRetrievalPlan(plan, USER_ID, QUERY, supabase);
  console.log("\nSource statuses:", JSON.stringify(sourceStatuses, null, 2));
  console.log("\nMeetings count:", (rawResults.sql_meetings as any[])?.length ?? 0);
  console.log("Meetings:", JSON.stringify(rawResults.sql_meetings, null, 2));
}

main();
