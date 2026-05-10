/**
 * Run evals against the local Ask AI endpoint.
 *
 * Usage:
 *   npx tsx --env-file=.env.eval evals/scripts/run.ts            # full suite
 *   npx tsx --env-file=.env.eval evals/scripts/run.ts --smoke    # smoke set only
 *   npx tsx --env-file=.env.eval evals/scripts/run.ts --id F1    # single case
 */

import { createClient } from "@supabase/supabase-js";
import { allCases, smokeCases } from "../cases/index";
import { score } from "../lib/scorer";
import { printReport, saveResults } from "../lib/report";
import type { EvalCase, EvalResult, RetrievalTrace } from "../lib/types";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";

async function refreshTokens(): Promise<{ tokenA: string; tokenB: string }> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const USERS = [
    { email: "eval-a@test.local", password: "EvalPassword123!" },
    { email: "eval-b@test.local", password: "EvalPassword123!" },
  ];
  const tokens: string[] = [];
  for (const { email, password } of USERS) {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new Error(`Auth failed for ${email}: ${error?.message}`);
    tokens.push(data.session.access_token);
  }
  return { tokenA: tokens[0], tokenB: tokens[1] };
}
const CONCURRENCY = 1;

const args = process.argv.slice(2);
const smokeOnly = args.includes("--smoke");
const singleId = args.find((a, i) => args[i - 1] === "--id");

let cases = smokeOnly ? smokeCases : allCases;
if (singleId) cases = allCases.filter((c) => c.id === singleId);

if (cases.length === 0) {
  console.error(`No cases matched. Available: ${allCases.map(c => c.id).join(", ")}`);
  process.exit(1);
}

console.log(`Running ${cases.length} eval case(s)${smokeOnly ? " [smoke]" : ""}...\n`);

async function runCase(c: EvalCase, tokenA: string, tokenB: string): Promise<EvalResult> {
  const messages = buildMessages(c);
  const token = c.userId() === process.env.EVAL_USER_ID ? tokenA : tokenB;

  const res = await fetch(`${BASE_URL}/api/ask?eval=true`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    return {
      caseId: c.id,
      query: c.query,
      response: "",
      trace: {} as RetrievalTrace,
      passed: false,
      failedAt: "L5",
      reason: `HTTP ${res.status}: ${await res.text()}`,
    };
  }

  const { response, trace } = await res.json() as { response: string; trace: RetrievalTrace };
  return score(c, response, trace);
}

function buildMessages(c: EvalCase) {
  type Msg = { role: "user" | "assistant"; parts: { type: "text"; text: string }[] };
  const msgs: Msg[] = [];

  // Prior session messages (multi-turn context)
  for (const m of c.sessionMessages ?? []) {
    msgs.push({ role: m.role, parts: [{ type: "text", text: m.text }] });
  }

  // The actual query
  msgs.push({ role: "user", parts: [{ type: "text", text: c.query }] });
  return msgs;
}

async function runWithConcurrency(items: EvalCase[], limit: number, tokenA: string, tokenB: string): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(c => runCase(c, tokenA, tokenB)));
    results.push(...batchResults);
    for (const r of batchResults) {
      const mark = r.passed ? "." : "F";
      process.stdout.write(mark);
    }
  }
  process.stdout.write("\n");
  return results;
}

async function main() {
  process.stdout.write("Refreshing auth tokens... ");
  const { tokenA, tokenB } = await refreshTokens();
  console.log("done");

  const results = await runWithConcurrency(cases, CONCURRENCY, tokenA, tokenB);
  printReport(results);
  saveResults(results);

  const hardGateIds = new Set(["A3", "F2", "H1", "A1"]);
  const hardFail = results.some(r => !r.passed && hardGateIds.has(r.caseId));
  process.exit(hardFail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
