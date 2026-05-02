/**
 * Automated retrieval test harness.
 * Runs each test case through the full pipeline (no HTTP) and evaluates assertions.
 *
 * Run: npx tsx --env-file=.env.local scripts/run-retrieval-tests.ts
 *      npx tsx --env-file=.env.local scripts/run-retrieval-tests.ts --layer L1
 *      npx tsx --env-file=.env.local scripts/run-retrieval-tests.ts --id L1-C1
 */
import { createClient } from "@supabase/supabase-js";
import { classifyIntent } from "@/lib/ai/intent/classify";
import { resolveEntities } from "@/lib/ai/retrieval/resolve";
import { buildRetrievalPlan } from "@/lib/ai/retrieval/plan";
import { executeRetrievalPlan } from "@/lib/ai/retrieval/execute";
import { aggregateTransactions } from "@/lib/ai/retrieval/aggregate";
import { unifiedRank, getRankingProfile } from "@/lib/ai/retrieval/rank";
import { buildTrace } from "@/lib/ai/retrieval/trace";
import type { RetrievalTrace } from "@/lib/ai/retrieval/types";
import { TEST_CASES, type Assertion, type TestCase } from "./retrieval-test-cases";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getUserId(): Promise<string> {
  const { data, error } = await supabase.from("users").select("id").limit(1).single();
  if (error || !data) throw new Error("No users found in DB: " + error?.message);
  return data.id;
}

async function runPipeline(query: string, userId: string): Promise<RetrievalTrace> {
  const startTime = Date.now();
  const intent = await classifyIntent(query, null);
  const resolved = await resolveEntities(intent.entities, intent.temporal, userId, supabase);
  const plan = buildRetrievalPlan(intent, resolved, query);
  const { rawResults, sourceStatuses, budgetExhausted } = await executeRetrievalPlan(
    plan, userId, query, supabase
  );

  const needsAggregation = plan.some((s) => s.source === "aggregated_finance");
  const aggregated = needsAggregation
    ? await aggregateTransactions(userId, {
        dateRange: resolved.resolvedDateRange,
        categories: intent.entities.categories,
        merchantNames: resolved.merchantNames,
      }, supabase).catch(() => null)
    : null;

  if (needsAggregation) {
    const idx = sourceStatuses.findIndex((s) => s.source === "aggregated_finance");
    if (idx !== -1) sourceStatuses.splice(idx, 1);
    sourceStatuses.push({
      source: "aggregated_finance",
      count: aggregated?.transaction_count ?? 0,
      success: aggregated !== null,
    });
  }

  const profile = getRankingProfile(intent.primary);
  const rankedItems = unifiedRank(rawResults, aggregated, query, intent.entities, intent.temporal, profile);
  return buildTrace(query, intent, plan, sourceStatuses, rankedItems, startTime, budgetExhausted);
}

function evaluate(trace: RetrievalTrace, assertions: Assertion[]): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  const sources = trace.retrieval_plan.map((s) => s.source);
  const weights = trace.retrieval_weights;
  const entities = trace.entities;
  const temporal = trace.temporal;

  for (const a of assertions) {
    if (a.field === "no_crash") continue; // reaching here means no crash

    if (a.field === "intent.primary") {
      if ("eq" in a) {
        if (trace.intent.split("+")[0] !== a.eq) failures.push(`intent.primary: expected ${a.eq}, got ${trace.intent.split("+")[0]}`);
      } else if ("oneOf" in a) {
        if (!a.oneOf.includes(trace.intent.split("+")[0] as any)) failures.push(`intent.primary: expected one of [${a.oneOf}], got ${trace.intent.split("+")[0]}`);
      }
    } else if (a.field === "weights.operational") {
      if ("eq" in a && Math.abs(weights.operational_weight - a.eq) > 0.05) failures.push(`weights.operational: expected ${a.eq}, got ${weights.operational_weight.toFixed(2)}`);
      if ("gte" in a && weights.operational_weight < a.gte) failures.push(`weights.operational: expected >= ${a.gte}, got ${weights.operational_weight.toFixed(2)}`);
      if ("lte" in a && weights.operational_weight > a.lte) failures.push(`weights.operational: expected <= ${a.lte}, got ${weights.operational_weight.toFixed(2)}`);
    } else if (a.field === "weights.investigative") {
      if ("eq" in a && Math.abs(weights.investigative_weight - a.eq) > 0.05) failures.push(`weights.investigative: expected ${a.eq}, got ${weights.investigative_weight.toFixed(2)}`);
      if ("gte" in a && weights.investigative_weight < a.gte) failures.push(`weights.investigative: expected >= ${a.gte}, got ${weights.investigative_weight.toFixed(2)}`);
    } else if (a.field === "entities.merchants") {
      if ("includes" in a && !entities.merchants.includes(a.includes)) failures.push(`entities.merchants: expected to include "${a.includes}", got [${entities.merchants.join(", ")}]`);
      if ("isEmpty" in a && entities.merchants.length > 0) failures.push(`entities.merchants: expected empty, got [${entities.merchants.join(", ")}]`);
    } else if (a.field === "entities.categories") {
      if ("includes" in a && !entities.categories.includes(a.includes)) failures.push(`entities.categories: expected to include "${a.includes}", got [${entities.categories.join(", ")}]`);
      if ("allIn" in a) {
        const invalid = entities.categories.filter((c) => !a.allIn.includes(c));
        if (invalid.length > 0) failures.push(`entities.categories: invalid values [${invalid.join(", ")}]`);
      }
    } else if (a.field === "entities.people") {
      if ("includes" in a && !entities.people.some((p) => p.toLowerCase().includes(a.includes.toLowerCase()))) failures.push(`entities.people: expected to include "${a.includes}", got [${entities.people.join(", ")}]`);
      if ("isEmpty" in a && entities.people.length > 0) failures.push(`entities.people: expected empty, got [${entities.people.join(", ")}]`);
    } else if (a.field === "entities.topics") {
      if ("includes" in a && !entities.topics.some((t) => t.toLowerCase().includes(a.includes.toLowerCase()))) failures.push(`entities.topics: expected to include "${a.includes}", got [${entities.topics.join(", ")}]`);
    } else if (a.field === "temporal.relativePeriod") {
      if ("eq" in a) {
        if (!temporal || temporal.type !== "relative" || temporal.relativePeriod !== a.eq) {
          failures.push(`temporal.relativePeriod: expected ${a.eq}, got ${temporal ? JSON.stringify(temporal) : "null"}`);
        }
      }
    } else if (a.field === "temporal") {
      if ("isNull" in a && temporal !== null) failures.push(`temporal: expected null, got ${JSON.stringify(temporal)}`);
      if ("nonNull" in a && temporal === null) failures.push(`temporal: expected non-null, got null`);
    } else if (a.field === "plan.sources") {
      if ("includes" in a && !sources.includes(a.includes as any)) failures.push(`plan.sources: expected to include ${a.includes}, got [${sources.join(", ")}]`);
      if ("excludes" in a && sources.includes(a.excludes as any)) failures.push(`plan.sources: expected to exclude ${a.excludes}, but it was present`);
      if ("only" in a) {
        const extra = sources.filter((s) => !(a.only as string[]).includes(s));
        if (extra.length > 0) failures.push(`plan.sources: expected only [${a.only}], got extra [${extra.join(", ")}]`);
      }
    } else if (a.field.startsWith("retrieved.") && "gt" in a) {
      const src = a.field.replace("retrieved.", "").replace(".count", "");
      const entry = trace.retrieved_sources.find((s) => s.source === src);
      const count = entry?.count ?? 0;
      if (count <= a.gt) failures.push(`retrieved.${src}.count: expected > ${a.gt}, got ${count}`);
    } else if (a.field.startsWith("retrieved.") && "eq" in a) {
      const src = a.field.replace("retrieved.", "").replace(".count", "");
      const entry = trace.retrieved_sources.find((s) => s.source === src);
      const count = entry?.count ?? 0;
      if (count !== a.eq) failures.push(`retrieved.${src}.count: expected ${a.eq}, got ${count}`);
    } else if (a.field === "top_ranked[0].source") {
      const top = trace.top_ranked_items[0]?.source;
      if ("eq" in a && top !== a.eq) failures.push(`top_ranked[0].source: expected ${a.eq}, got ${top}`);
      if ("oneOf" in a && !a.oneOf.includes(top ?? "")) failures.push(`top_ranked[0].source: expected one of [${a.oneOf}], got ${top}`);
    }
  }

  return { pass: failures.length === 0, failures };
}

function parseArgs(): { layer?: string; id?: string } {
  const args = process.argv.slice(2);
  const result: { layer?: string; id?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--layer") result.layer = args[i + 1];
    if (args[i] === "--id") result.id = args[i + 1];
  }
  return result;
}

async function main() {
  const { layer, id } = parseArgs();
  const userId = await getUserId();

  let cases: TestCase[] = TEST_CASES;
  if (id) cases = cases.filter((c) => c.id === id);
  else if (layer) cases = cases.filter((c) => c.id.startsWith(layer));

  const automated = cases.filter((c) => c.type !== "manual");
  const manual = cases.filter((c) => c.type === "manual");

  console.log(`\nRunning ${automated.length} tests (${manual.length} manual-only skipped)\n${"─".repeat(60)}`);

  let passed = 0;
  let failed = 0;

  for (const tc of automated) {
    let trace: RetrievalTrace | null = null;
    let crashed = false;
    let crashMsg = "";

    try {
      trace = await runPipeline(tc.query, userId);
    } catch (e: any) {
      crashed = true;
      crashMsg = e?.message ?? String(e);
    }

    const hasCrashAssertion = tc.assert.some((a) => a.field === "no_crash");

    if (crashed) {
      if (hasCrashAssertion) {
        // no_crash assertion failed
        console.log(`[${tc.id}] ${tc.description}`);
        console.log(`  ✗ no_crash FAILED: ${crashMsg}`);
        failed++;
      } else {
        console.log(`[${tc.id}] ${tc.description}`);
        console.log(`  ✗ CRASHED: ${crashMsg}`);
        failed++;
      }
      continue;
    }

    const result = evaluate(trace!, tc.assert);

    if (result.pass) {
      console.log(`[${tc.id}] ${tc.description}  ✓`);
      passed++;
    } else {
      console.log(`[${tc.id}] ${tc.description}`);
      for (const f of result.failures) console.log(`  ✗ ${f}`);
      failed++;
    }
  }

  if (manual.length > 0 && !id) {
    console.log(`\nManual-only (skipped): ${manual.map((c) => c.id).join(", ")}`);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${manual.length} manual\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
