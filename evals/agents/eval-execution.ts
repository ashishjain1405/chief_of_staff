/**
 * AGENT 3 — AI Eval Execution Agent
 *
 * For each EVAL_### case from eval-cases.json:
 *   Stage 1: Generate a synthetic SCENARIO (emails, meetings, transactions, tasks,
 *            commitments, operational_insights) tailored to the eval case
 *   Stage 2: Seed the scenario into Supabase for the eval user (L2–L5 only —
 *            data is seeded as pre-processed structured rows, not raw emails)
 *   Stage 3: Execute the eval case against /api/ask?eval=true
 *   Stage 4: Run all 9 deterministic scorer checks, then extended AI validation
 *
 * Usage:
 *   npx tsx --env-file=.env.local evals/agents/eval-execution.ts
 *   npx tsx --env-file=.env.local evals/agents/eval-execution.ts --id EVAL_001
 *   npx tsx --env-file=.env.local evals/agents/eval-execution.ts --skip-generate   # reuse existing scenarios
 *
 * Scope: L2–L5 only. L1 (raw email extraction workers) is out of scope.
 */

import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import type { EvalCase, EvalResult, RetrievalTrace } from "../lib/types";
import { score } from "../lib/scorer";
import { printReport, saveResults } from "../lib/report";

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const EVAL_CASES_PATH = path.join(__dirname, "../fixtures/eval-cases.json");
const EVAL_METADATA_PATH = path.join(__dirname, "../fixtures/eval-metadata.json");
const SCENARIOS_DIR = path.join(__dirname, "../fixtures/scenarios");

// ─── Types ────────────────────────────────────────────────────────────────────

type ScenarioEmail = {
  external_id: string;
  subject: string;
  body_summary: string;
  occurred_at: string;
  email_category: string;
  requires_action: boolean;
  sentiment?: string;
  channel_metadata: { sender: string; sender_name?: string };
  embedding_null?: boolean;
};

type ScenarioMeeting = {
  external_id: string;
  title: string;
  start_time: string;
  end_time: string;
  transcript_summary: string;
  attendees: { email: string; name: string }[];
  description?: string;
};

type ScenarioTransaction = {
  merchant_normalized: string;
  amount: number;
  currency: string;
  category: string;
  transaction_type: "debit" | "credit" | "refund";
  transaction_datetime: string;
};

type ScenarioTask = {
  title: string;
  status: "pending" | "done" | "snoozed";
  priority: "high" | "medium" | "low";
  due_date?: string;
  source_type: string;
};

type ScenarioCommitment = {
  description: string;
  due_date?: string;
  status: "pending" | "done" | "overdue";
  ai_confidence: number;
};

type ScenarioInsight = {
  state_key: string;
  category: string;
  insight_type: string;
  title: string;
  summary: string;
  urgency: "critical" | "high" | "medium" | "low";
  priority_score: number;
  recommended_action?: string;
  explanation: string;
  status?: string;
};

type ScenarioPerson = {
  name: string;
  email: string;
  relationship_type?: string;
};

type Scenario = {
  scenario_id: string;
  eval_id: string;
  theme: string;
  entities: {
    people: ScenarioPerson[];
    companies: string[];
    projects: string[];
    merchants: string[];
  };
  emails: ScenarioEmail[];
  meetings: ScenarioMeeting[];
  transactions: ScenarioTransaction[];
  tasks: ScenarioTask[];
  commitments: ScenarioCommitment[];
  operational_insights: ScenarioInsight[];
  hidden_ground_truth: {
    actual_relationships: string[];
    actual_intent: string[];
    expected_answer_facts: string[];
  };
};

type RawEvalCase = {
  eval_id: string;
  query: string;
  difficulty: string;
  hallucination_risk: string;
  expected_entities: { people?: string[]; merchants?: string[]; categories?: string[]; topics?: string[] };
  expected_retrieval_sources: string[];
  expected_intents: { required: string[]; forbidden?: string[] };
  likely_failure_modes: string[];
  conversation_context: { role: string; text: string }[];
};

type EvalExecutionResult = EvalResult & {
  scenario_id: string;
  extended_checks: { check: string; passed: boolean; reason: string }[];
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SCENARIO_SYSTEM_PROMPT = `You are an AI Evaluation Execution Agent responsible for:

generating synthetic memory environments
executing evaluation scenarios
validating retrieval correctness
validating evidence grounding
identifying hallucinations
identifying ranking failures
identifying conversational memory failures
generating execution reports

You are also a synthetic data generation specialist for AI memory systems.

You generate realistic synthetic personal operating system data for evaluation purposes.

Your generated environments must feel:

realistic
messy
ambiguous
incomplete
naturally inconsistent
human

You are generating memory data for an AI Chief of Staff system.

The system ingests:

emails
meetings
tasks
commitments
financial transactions
operational insights
vector memories

You should simulate:

real executive workflows
startup operations
finance tracking
relationships
vendors
travel
recruiting
family coordination
subscriptions
project management
strategic planning

Your generated data should intentionally include:

duplicate names
inconsistent aliases
missing context
contradictory statements
delayed updates
stale insights
partial records
noisy retrieval candidates
overlapping meetings
ambiguous merchants
ambiguous references
multiple simultaneous projects
changing priorities
vague commitments
conflicting timelines

Requirements:

Emails:
realistic timestamps (ISO 8601)
realistic subject lines
realistic ambiguity
realistic tone
realistic references to prior conversations
partial information

Transactions:
recurring merchants
similar merchants
refunds where appropriate

Operational insights:
some stale (created days ago, not reflecting fresh transactions)
some contradicting raw data — this is intentional for adversarial evals`;

// ─── Scenario generation ──────────────────────────────────────────────────────

function buildScenarioPrompt(
  evalCase: RawEvalCase,
  metadata: { why_this_eval_exists?: string; expected_evidence_requirements?: string[] }
): string {
  const now = new Date().toISOString();
  return [
    `Generate a synthetic memory environment for this evaluation case.`,
    ``,
    `Eval case:`,
    `  eval_id: ${evalCase.eval_id}`,
    `  query: "${evalCase.query}"`,
    `  difficulty: ${evalCase.difficulty}`,
    `  hallucination_risk: ${evalCase.hallucination_risk}`,
    `  expected_intents: ${JSON.stringify(evalCase.expected_intents)}`,
    `  expected_entities: ${JSON.stringify(evalCase.expected_entities)}`,
    `  expected_retrieval_sources: ${JSON.stringify(evalCase.expected_retrieval_sources)}`,
    `  likely_failure_modes: ${JSON.stringify(evalCase.likely_failure_modes)}`,
    metadata.why_this_eval_exists ? `  why_this_eval_exists: "${metadata.why_this_eval_exists}"` : "",
    metadata.expected_evidence_requirements?.length
      ? `  expected_evidence_requirements: ${JSON.stringify(metadata.expected_evidence_requirements)}`
      : "",
    ``,
    `Current time: ${now}`,
    ``,
    `Rules:`,
    `- emails[].occurred_at must be ISO 8601 strings (e.g. "${new Date(Date.now() - 86400000 * 3).toISOString()}")`,
    `- meetings[].start_time and end_time must be ISO 8601`,
    `- transactions[].transaction_datetime must be ISO 8601`,
    `- transactions[].transaction_type must be exactly "debit", "credit", or "refund"`,
    `- operational_insights[].urgency must be exactly "critical", "high", "medium", or "low"`,
    `- operational_insights[].state_key must be unique snake_case strings`,
    `- hidden_ground_truth.expected_answer_facts must list the specific facts the correct answer should contain`,
    `- Introduce at least one noisy/adversarial element from likely_failure_modes`,
    `- Include a stale operational_insight that contradicts a fresher transaction where relevant`,
    ``,
    `Output a JSON object with key "scenario" containing exactly:`,
    `{ scenario_id, eval_id, theme, entities: { people: [{name, email, relationship_type}], companies, projects, merchants },`,
    `  emails: [{external_id, subject, body_summary, occurred_at, email_category, requires_action, sentiment, channel_metadata: {sender, sender_name}, embedding_null}],`,
    `  meetings: [{external_id, title, start_time, end_time, transcript_summary, attendees: [{email, name}], description}],`,
    `  transactions: [{merchant_normalized, amount, currency, category, transaction_type, transaction_datetime}],`,
    `  tasks: [{title, status, priority, due_date, source_type}],`,
    `  commitments: [{description, due_date, status, ai_confidence}],`,
    `  operational_insights: [{state_key, category, insight_type, title, summary, urgency, priority_score, recommended_action, explanation, status}],`,
    `  hidden_ground_truth: { actual_relationships, actual_intent, expected_answer_facts } }`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateScenario(
  client: OpenAI,
  evalCase: RawEvalCase,
  metadata: { why_this_eval_exists?: string; expected_evidence_requirements?: string[] }
): Promise<Scenario> {
  const message = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 8000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SCENARIO_SYSTEM_PROMPT },
      { role: "user", content: buildScenarioPrompt(evalCase, metadata) },
    ],
  });

  const raw = message.choices[0].message.content ?? "";
  const wrapper = JSON.parse(raw) as { scenario?: Scenario };
  const scenario = wrapper.scenario;
  if (!scenario) throw new Error(`No scenario returned for ${evalCase.eval_id}`);
  return { ...scenario, eval_id: evalCase.eval_id };
}

// ─── Supabase seeding ─────────────────────────────────────────────────────────

async function seedScenario(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  scenario: Scenario
): Promise<void> {
  const prefix = `scenario-${scenario.scenario_id}-`;

  // Wipe existing scenario data for this user
  await supabase.from("transactions_normalized").delete().eq("user_id", userId);
  await supabase.from("communications").delete().eq("user_id", userId).like("external_id", `${prefix}%`);
  await supabase.from("meetings").delete().eq("user_id", userId).like("external_id", `${prefix}%`);
  await supabase.from("tasks").delete().eq("user_id", userId).like("source_id", `${prefix}%`);
  await supabase.from("commitments").delete().eq("user_id", userId).like("source_id", `${prefix}%`);
  await supabase.from("operational_insights").delete().eq("user_id", userId).like("state_key", `${prefix}%`);

  // Contacts
  if (scenario.entities.people.length) {
    const contactRows = scenario.entities.people.map(p => ({
      user_id: userId,
      name: p.name,
      email: p.email,
      relationship_type: p.relationship_type ?? "other",
      importance_score: 0.7,
      interaction_count: 1,
    }));
    await supabase.from("contacts").upsert(contactRows, { onConflict: "user_id,email", ignoreDuplicates: true });
  }

  // Emails (communications)
  if (scenario.emails.length) {
    const emailRows = scenario.emails.map(e => ({
      user_id: userId,
      source: "gmail",
      external_id: `${prefix}${e.external_id}`,
      subject: e.subject,
      body_summary: e.body_summary,
      occurred_at: e.occurred_at,
      email_category: e.email_category,
      requires_action: e.requires_action,
      action_taken: false,
      sentiment: e.sentiment ?? null,
      channel_metadata: e.channel_metadata,
      embedding: null,
    }));
    const { error } = await supabase.from("communications").insert(emailRows);
    if (error) throw new Error(`communications insert: ${error.message}`);

    // Null embeddings for emails marked embedding_null
    for (const e of scenario.emails.filter(e => e.embedding_null)) {
      await supabase.from("communications")
        .update({ embedding: null })
        .eq("user_id", userId)
        .eq("external_id", `${prefix}${e.external_id}`);
    }
  }

  // Meetings
  if (scenario.meetings.length) {
    const meetingRows = scenario.meetings.map(m => ({
      user_id: userId,
      source: "google_calendar",
      external_id: `${prefix}${m.external_id}`,
      title: m.title,
      start_time: m.start_time,
      end_time: m.end_time,
      transcript_summary: m.transcript_summary,
      attendees: m.attendees,
      description: m.description ?? null,
    }));
    const { error } = await supabase.from("meetings").insert(meetingRows);
    if (error) throw new Error(`meetings insert: ${error.message}`);
  }

  // Transactions
  if (scenario.transactions.length) {
    const txRows = scenario.transactions.map(t => ({
      user_id: userId,
      merchant_normalized: t.merchant_normalized,
      amount: t.amount,
      currency: t.currency,
      category: t.category,
      transaction_type: t.transaction_type,
      transaction_datetime: t.transaction_datetime,
    }));
    const { error } = await supabase.from("transactions_normalized").insert(txRows);
    if (error) throw new Error(`transactions insert: ${error.message}`);
  }

  // Tasks
  if (scenario.tasks.length) {
    const taskRows = scenario.tasks.map(t => ({
      user_id: userId,
      title: t.title,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date ?? null,
      source_type: t.source_type,
      source_id: null,
    }));
    const { error } = await supabase.from("tasks").insert(taskRows);
    if (error) throw new Error(`tasks insert: ${error.message}`);
  }

  // Commitments
  if (scenario.commitments.length) {
    const commitRows = scenario.commitments.map(c => ({
      user_id: userId,
      description: c.description,
      due_date: c.due_date ?? null,
      status: c.status,
      ai_confidence: c.ai_confidence,
      source_type: "email",
      source_id: null,
    }));
    const { error } = await supabase.from("commitments").insert(commitRows);
    if (error) throw new Error(`commitments insert: ${error.message}`);
  }

  // Operational insights
  if (scenario.operational_insights.length) {
    const insightRows = scenario.operational_insights.map(i => ({
      user_id: userId,
      state_key: `${prefix}${i.state_key}`,
      category: i.category,
      insight_type: i.insight_type,
      title: i.title,
      summary: i.summary,
      urgency: i.urgency,
      priority_score: i.priority_score,
      recommended_action: i.recommended_action ?? null,
      explanation: i.explanation,
      status: i.status ?? "active",
      confidence: 0.8,
      source_count: 1,
      entities: [],
      source_refs: [],
      generated_by: "eval-execution-agent",
    }));
    const { error } = await supabase.from("operational_insights").insert(insightRows);
    if (error) throw new Error(`operational_insights insert: ${error.message}`);
  }
}

// ─── Extended AI validation ───────────────────────────────────────────────────

async function runExtendedChecks(
  client: OpenAI,
  query: string,
  response: string,
  trace: RetrievalTrace,
  groundTruth: Scenario["hidden_ground_truth"]
): Promise<{ check: string; passed: boolean; reason: string }[]> {
  const topItems = trace.top_ranked_items
    .map(i => `${i.source}: ${i.title ?? "(no title)"}${i.snippet ? ` — ${i.snippet}` : ""} (score: ${i.score})`)
    .join("\n");

  const scores = trace.top_ranked_items.map(i => i.score);
  const sources = trace.top_ranked_items.map(i => i.source);
  const uniqueSources = new Set(sources).size;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 600,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are an eval judge. For each check answer with {passed: boolean, reason: string}. Be strict.",
      },
      {
        role: "user",
        content: [
          `Query: ${query}`,
          ``,
          `Top retrieved items:`,
          topItems,
          ``,
          `Response:`,
          response,
          ``,
          `Expected answer facts (ground truth):`,
          groundTruth.expected_answer_facts.map((f, i) => `${i + 1}. ${f}`).join("\n"),
          ``,
          `Budget exhausted: ${trace.budget_exhausted}`,
          `Unique sources in top items: ${uniqueSources}`,
          `Item scores: [${scores.join(", ")}]`,
          ``,
          `Answer these checks as a JSON object with keys: evidence_coverage, ranking_coherence, source_diversity, budget_impact.`,
          `evidence_coverage: Does the response cite at least one of the expected_answer_facts? yes=passed`,
          `ranking_coherence: Are scores distributed (not all identical or all near-zero, i.e. variance > 0.01)? yes=passed`,
          `source_diversity: Do top items come from at least 2 different sources? yes=passed`,
          `budget_impact: If budget_exhausted=true, does the response acknowledge possible missing data? If budget not exhausted, auto-pass.`,
        ].join("\n"),
      },
    ],
  });

  const raw = completion.choices[0].message.content ?? "{}";
  const checks = JSON.parse(raw) as Record<string, { passed: boolean; reason: string }>;

  return Object.entries(checks).map(([check, result]) => ({
    check,
    passed: result.passed ?? false,
    reason: result.reason ?? "",
  }));
}

// ─── Execute a single eval case ───────────────────────────────────────────────

function buildMessages(evalCase: RawEvalCase) {
  type Msg = { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[] };
  const msgs: Msg[] = [];
  for (const [i, m] of evalCase.conversation_context.entries()) {
    msgs.push({ id: `ctx-${i}`, role: m.role as "user" | "assistant", parts: [{ type: "text", text: m.text }] });
  }
  msgs.push({ id: "eval-query", role: "user", parts: [{ type: "text", text: evalCase.query }] });
  return msgs;
}

async function executeCase(
  client: OpenAI,
  supabase: ReturnType<typeof createClient<any>>,
  token: string,
  evalCase: RawEvalCase,
  scenario: Scenario,
  userId: string
): Promise<EvalExecutionResult> {
  const base = { scenario_id: scenario.scenario_id, extended_checks: [] as EvalExecutionResult["extended_checks"] };

  // Seed
  try {
    await seedScenario(supabase, userId, scenario);
  } catch (err) {
    return {
      ...base,
      caseId: evalCase.eval_id,
      query: evalCase.query,
      response: "",
      trace: {} as RetrievalTrace,
      passed: false,
      failedAt: "L1",
      reason: `Seed failed: ${(err as Error).message}`,
    };
  }

  // Execute
  const res = await fetch(`${BASE_URL}/api/ask?eval=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ messages: buildMessages(evalCase) }),
  });

  if (!res.ok) {
    return {
      ...base,
      caseId: evalCase.eval_id,
      query: evalCase.query,
      response: "",
      trace: {} as RetrievalTrace,
      passed: false,
      failedAt: "L5",
      reason: `HTTP ${res.status}: ${await res.text()}`,
    };
  }

  const { response, trace } = await res.json() as { response: string; trace: RetrievalTrace };

  // Build EvalCase shape for scorer (deterministic checks 1–9)
  const evalCaseForScorer: EvalCase = {
    id: evalCase.eval_id,
    query: evalCase.query,
    userId: () => userId,
    type: evalCase.hallucination_risk === "high" ? "llm-judge" : "trace-only",
    requiredSourcesUsed: evalCase.expected_retrieval_sources,
    expectedIntents: evalCase.expected_intents.required.length
      ? { required: evalCase.expected_intents.required, forbidden: evalCase.expected_intents.forbidden }
      : undefined,
    expectedEntities: Object.keys(evalCase.expected_entities).length
      ? evalCase.expected_entities
      : undefined,
    failConditions: evalCase.likely_failure_modes,
  };

  const scored = await score(evalCaseForScorer, response, trace);
  if (!scored.passed) {
    return { ...base, ...scored, scenario_id: scenario.scenario_id };
  }

  // Extended AI checks
  const extended = await runExtendedChecks(client, evalCase.query, response, trace, scenario.hidden_ground_truth);
  const extendedFail = extended.find(c => !c.passed);

  return {
    ...scored,
    scenario_id: scenario.scenario_id,
    extended_checks: extended,
    passed: !extendedFail,
    failedAt: extendedFail ? "L5" : scored.failedAt,
    reason: extendedFail ? `Extended check "${extendedFail.check}" failed: ${extendedFail.reason}` : scored.reason,
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getTokenAndUserId(): Promise<{ token: string; userId: string }> {
  const { createClient: createAnonClient } = await import("@supabase/supabase-js");
  const anon = createAnonClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data, error } = await anon.auth.signInWithPassword({
    email: "eval-a@test.local",
    password: "EvalPassword123!",
  });
  if (error || !data.session) throw new Error(`Auth failed: ${error?.message}`);
  return { token: data.session.access_token, userId: data.session.user.id };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const singleId = args.find((a, i) => args[i - 1] === "--id");
  const multiIds = args.find((a, i) => args[i - 1] === "--ids")?.split(",").map(s => s.trim());
  const skipGenerate = args.includes("--skip-generate");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const supabase = createClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Load eval cases
  let evalCases: RawEvalCase[] = JSON.parse(fs.readFileSync(EVAL_CASES_PATH, "utf-8"));
  if (singleId) evalCases = evalCases.filter(c => c.eval_id === singleId);
  else if (multiIds) evalCases = evalCases.filter(c => multiIds.includes(c.eval_id));
  if (!evalCases.length) {
    console.error(`No cases matched.`);
    process.exit(1);
  }

  const metadata: Record<string, { why_this_eval_exists?: string; expected_evidence_requirements?: string[] }> =
    fs.existsSync(EVAL_METADATA_PATH) ? JSON.parse(fs.readFileSync(EVAL_METADATA_PATH, "utf-8")) : {};

  fs.mkdirSync(SCENARIOS_DIR, { recursive: true });

  console.log(`Running ${evalCases.length} eval case(s) via Agent 3...\n`);
  process.stdout.write("Refreshing auth token... ");
  const { token, userId } = await getTokenAndUserId();
  console.log(`done (user: ${userId})\n`);

  const results: EvalResult[] = [];

  for (const evalCase of evalCases) {
    process.stdout.write(`  ${evalCase.eval_id} [${evalCase.difficulty}] ... `);

    const scenarioPath = path.join(SCENARIOS_DIR, `${evalCase.eval_id}.json`);

    let scenario: Scenario;
    if (skipGenerate && fs.existsSync(scenarioPath)) {
      scenario = JSON.parse(fs.readFileSync(scenarioPath, "utf-8"));
    } else {
      try {
        scenario = await generateScenario(client, evalCase, metadata[evalCase.eval_id] ?? {});
        fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2));
      } catch (err) {
        console.error(`\n  Scenario generation failed for ${evalCase.eval_id}: ${(err as Error).message}`);
        results.push({
          caseId: evalCase.eval_id,
          query: evalCase.query,
          response: "",
          trace: {} as RetrievalTrace,
          passed: false,
          failedAt: "L1",
          reason: `Scenario generation failed: ${(err as Error).message}`,
        });
        continue;
      }
    }

    const result = await executeCase(client, supabase, token, evalCase, scenario, userId);
    results.push(result);
    process.stdout.write(result.passed ? "PASS\n" : `FAIL (${result.failedAt})\n`);
  }

  console.log();
  printReport(results);
  saveResults(results);
}

main().catch(err => { console.error(err); process.exit(1); });
