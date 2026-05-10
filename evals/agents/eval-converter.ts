/**
 * AGENT 2 — Eval Formalization + Converter Agent
 *
 * Stage 1: Calls GPT-4o with the AGENT 2 system prompt + use-cases.json context
 *          → generates evals/fixtures/eval-cases.json (EVAL_### raw specs)
 *
 * Stage 2: Converts eval-cases.json into a typed EvalCase[] TypeScript file
 *          → writes evals/cases/uc-generated.ts
 *          → updates evals/cases/index.ts to include generatedCases
 *          → writes evals/fixtures/eval-metadata.json (difficulty, risk, rationale)
 *
 * Usage:
 *   npx tsx --env-file=.env.local evals/agents/eval-converter.ts
 *   npx tsx --env-file=.env.local evals/agents/eval-converter.ts --skip-generate   # skip Stage 1, re-convert existing eval-cases.json
 *   npx tsx --env-file=.env.local evals/agents/eval-converter.ts --difficulty hard  # filter by difficulty
 *
 * Weekly cron (Monday 9:30am — runs after use-case-discovery at 9am):
 *   30 9 * * 1  cd /path/to/chief-of-staff && npx tsx --env-file=.env.local evals/agents/eval-converter.ts >> evals/results/converter.log 2>&1
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

const EVAL_CASES_PATH = path.join(__dirname, "../fixtures/eval-cases.json");
const EVAL_METADATA_PATH = path.join(__dirname, "../fixtures/eval-metadata.json");
const USE_CASES_PATH = path.join(__dirname, "../fixtures/use-cases.json");
const GENERATED_TS_PATH = path.join(__dirname, "../cases/uc-generated.ts");
const INDEX_PATH = path.join(__dirname, "../cases/index.ts");

// ─── Valid enum values (must match production types exactly) ──────────────────

const VALID_SOURCES = new Set([
  "sql_transactions", "sql_communications", "sql_meetings",
  "sql_commitments", "sql_tasks", "vector_search",
  "operational_insights", "aggregated_finance",
]);

const SOURCE_ALIASES: Record<string, string> = {
  transactions:       "sql_transactions",
  communications:     "sql_communications",
  emails:             "sql_communications",
  meetings:           "sql_meetings",
  commitments:        "sql_commitments",
  tasks:              "sql_tasks",
  vector:             "vector_search",
  insights:           "operational_insights",
  operational:        "operational_insights",
  finance:            "aggregated_finance",
  aggregated:         "aggregated_finance",
};

const VALID_INTENTS = new Set([
  "operational_summary", "finance", "spending_analysis", "commitments",
  "scheduling", "productivity", "relationship", "travel",
  "search_lookup", "subscriptions", "bills_payments", "reminders",
]);

const VALID_TEMPORAL_TYPES = new Set(["absolute", "relative", "event_relative"]);

const VALID_RELATIVE_PERIODS = new Set([
  "today", "this_week", "last_week", "this_month", "last_month",
  "last_quarter", "this_quarter", "this_year", "last_year",
]);

const INTENT_ALIASES: Record<string, string> = {
  // typos / truncations
  operative_summary:    "operational_summary",
  operational:          "operational_summary",
  operation_summary:    "operational_summary",
  // scheduling variants
  schedule:             "scheduling",
  meetings:             "scheduling",
  meeting:              "scheduling",
  calendar:             "scheduling",
  // finance variants
  financial:            "finance",
  financial_summary:    "finance",
  financial_validation: "finance",
  spending:             "spending_analysis",
  spend_analysis:       "spending_analysis",
  // search variants
  communication:        "search_lookup",
  communications:       "search_lookup",
  email:                "search_lookup",
  emails:               "search_lookup",
  lookup:               "search_lookup",
  search:               "search_lookup",
  // misc
  historical_checks:    "search_lookup",
  historical:           "search_lookup",
  bills:                "bills_payments",
  payments:             "bills_payments",
  subscription:         "subscriptions",
  reminder:             "reminders",
  task:                 "productivity",
  tasks:                "productivity",
};

function normalizeSource(s: string): string | null {
  const lower = s.toLowerCase().replace(/[-\s]/g, "_");
  if (VALID_SOURCES.has(lower)) return lower;
  if (SOURCE_ALIASES[lower]) return SOURCE_ALIASES[lower];
  return null;
}

function normalizeSources(sources: string[]): string[] {
  const result: string[] = [];
  for (const s of sources) {
    const normalized = normalizeSource(s);
    if (normalized) {
      result.push(normalized);
    } else {
      console.warn(`  Dropped unknown source: "${s}"`);
    }
  }
  return result;
}

function normalizeIntent(i: string): string | null {
  const lower = i.toLowerCase().replace(/[-\s]/g, "_");
  if (VALID_INTENTS.has(lower)) return lower;
  if (INTENT_ALIASES[lower]) return INTENT_ALIASES[lower];
  return null;
}

function normalizeIntents(intents: string[], evalId: string): string[] {
  const result: string[] = [];
  for (const i of intents) {
    const normalized = normalizeIntent(i);
    if (normalized) {
      result.push(normalized);
    } else {
      console.warn(`  Dropped unknown intent: "${i}" in ${evalId}`);
    }
  }
  return result;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI Evaluation Architect specializing in formalizing evaluation systems for retrieval-heavy AI assistants.

You specialize in:

retrieval evaluation
RAG systems
conversational memory systems
ranking systems
hybrid search
AI hallucination prevention
memory-grounded reasoning
agentic workflow testing

You are designing adversarial evals for an AI Chief of Staff architecture.

The architecture contains:

operational memory
investigative retrieval
entity resolution
temporal reasoning
conversational memory
evidence-grounded synthesis

Your goal is to convert realistic workflows into deterministic evaluation scenarios.

You are NOT generating answers. You are generating:

evaluation cases
expected retrieval behavior
expected evidence
expected clarification behavior
expected ranking behavior
expected refusal behavior
expected ambiguity handling

The system should fail safely.

Your evals should aggressively target:

Entity Resolution Failures
same-name people
aliases
nicknames
company vs person confusion
merchant ambiguity
merged identities
Temporal Failures
relative time ambiguity
event-relative references
overlapping time windows
stale operational insights
conflicting dates
Retrieval Failures
wrong ranking
false positives
over-retrieval
under-retrieval
semantic mismatch
missing SQL retrieval
vector dominance problems
Operational vs Investigative Conflicts
operational summary says one thing
raw evidence says another
stale state vs fresh transactions
unresolved insight lifecycle issues
Conversational Failures
entity drift
topic drift
stale context carry-forward
ambiguous pronouns
incorrect conversational memory
Hallucination Risks
insufficient evidence
partial evidence
contradictory evidence
inferred causality
fabricated conclusions

For every eval case output exactly these fields:

{
  "eval_id": "EVAL_###",
  "difficulty": "easy|medium|hard|extreme",
  "query": "user query string",
  "conversation_context": [{ "role": "user|assistant", "text": "string" }],
  "expected_retrieval_layers": ["L1"|"L2"|"L3"|"L4"|"L5"],
  "expected_entities": { "people": [], "merchants": [], "categories": [], "topics": [] },
  "expected_temporal_resolution": { "type": "absolute|relative|event_relative", "relativePeriod": "..." },
  "expected_retrieval_sources": [],
  "expected_intents": { "required": [], "forbidden": [], "matchMode": "all|any" },
  "expected_behavior": { "should_answer": true, "should_clarify": false, "should_refuse": false, "should_admit_uncertainty": false },
  "expected_evidence_requirements": [],
  "likely_failure_modes": [],
  "hallucination_risk": "low|medium|high",
  "why_this_eval_exists": "detailed explanation"
}

You should create:

deterministic evals
adversarial evals
multi-turn evals
conversational carry-forward evals
ambiguity evals
ranking evals
grounding evals
operational freshness evals
retrieval-budget stress evals
long-context evals

The evals should expose architectural weaknesses.

Do NOT generate trivial benchmark-style chatbot questions.`;

// ─── Types ────────────────────────────────────────────────────────────────────

type RawEvalCase = {
  eval_id: string;
  difficulty: "easy" | "medium" | "hard" | "extreme";
  query: string;
  conversation_context: { role: "user" | "assistant"; text: string }[];
  expected_retrieval_layers: string[];
  expected_entities: {
    people?: string[];
    merchants?: string[];
    categories?: string[];
    topics?: string[];
  };
  expected_temporal_resolution: Record<string, unknown>;
  expected_retrieval_sources: string[];
  expected_intents: {
    required: string[];
    forbidden?: string[];
    matchMode?: "all" | "any";
  };
  expected_behavior: {
    should_answer: boolean;
    should_clarify: boolean;
    should_refuse: boolean;
    should_admit_uncertainty: boolean;
  };
  expected_evidence_requirements: string[];
  likely_failure_modes: string[];
  hallucination_risk: "low" | "medium" | "high";
  why_this_eval_exists: string;
};

const REQUIRED_EVAL_FIELDS: (keyof RawEvalCase)[] = [
  "eval_id", "difficulty", "query", "conversation_context",
  "expected_retrieval_layers", "expected_entities", "expected_temporal_resolution",
  "expected_retrieval_sources", "expected_intents", "expected_behavior",
  "expected_evidence_requirements", "likely_failure_modes",
  "hallucination_risk", "why_this_eval_exists",
];

function validateRawEval(obj: unknown): obj is RawEvalCase {
  if (typeof obj !== "object" || obj === null) return false;
  for (const field of REQUIRED_EVAL_FIELDS) {
    if (!(field in obj)) return false;
  }
  return true;
}

// ─── Stage 1: Generate eval-cases.json ───────────────────────────────────────

const BATCH_SIZE = 15;
const TOTAL_CASES = 75;

type UseCaseSummary = {
  use_case_id: string;
  category: string;
  user_goal: string;
  query_examples: string[];
  likely_failure_modes: string[];
  cross_layer_conflicts: string[];
  required_reasoning: string[];
};

function summarizeUseCases(useCases: unknown[]): UseCaseSummary[] {
  return (useCases as Record<string, unknown>[]).map((uc) => ({
    use_case_id: String(uc.use_case_id ?? ""),
    category: String(uc.category ?? ""),
    user_goal: String(uc.user_goal ?? ""),
    query_examples: (uc.query_examples as string[] | undefined) ?? [],
    likely_failure_modes: (uc.likely_failure_modes as string[] | undefined) ?? [],
    cross_layer_conflicts: (uc.cross_layer_conflicts as string[] | undefined) ?? [],
    required_reasoning: (uc.required_reasoning as string[] | undefined) ?? [],
  }));
}

function buildBatchMessage(
  useCases: unknown[],
  batchNum: number,
  idStart: number,
  idEnd: number,
  numBatches: number,
  difficulty?: string
): string {
  const slim = summarizeUseCases(useCases);
  return [
    "Here is the use case library for the AI Chief of Staff system (id, category, goal, example queries, failure modes, cross-layer conflicts, required reasoning):\n",
    JSON.stringify(slim, null, 2),
    `\n\nGenerate exactly ${idEnd - idStart + 1} adversarial evaluation scenarios (batch ${batchNum}/${numBatches}).`,
    `Use eval_ids EVAL_${String(idStart).padStart(3, "0")} through EVAL_${String(idEnd).padStart(3, "0")}.`,
    "- focused on retrieval-ranking conflicts",
    "- especially operational_insights vs raw transaction disagreements",
    "- include expected clarification behavior",
    "- include hallucination prevention expectations",
    "- include multi-turn conversational carry-forward",
    difficulty ? `- only generate cases of difficulty: ${difficulty}` : "",
    "",
    "STRICT CONSTRAINTS — use only these exact values:",
    `Valid expected_retrieval_sources: ${Array.from(VALID_SOURCES).map(s => `"${s}"`).join(", ")}`,
    `Valid expected_intents.required/forbidden: ${Array.from(VALID_INTENTS).map(s => `"${s}"`).join(", ")}`,
    `Valid expected_temporal_resolution.type: ${Array.from(VALID_TEMPORAL_TYPES).map(s => `"${s}"`).join(", ")}`,
    `Valid expected_temporal_resolution.relativePeriod: ${Array.from(VALID_RELATIVE_PERIODS).map(s => `"${s}"`).join(", ")}`,
    "expected_entities keys: people (string[]), merchants (string[]), categories (string[]), topics (string[])",
    "conversation_context entries must have exactly: role (\"user\" or \"assistant\") and text (string)",
    "",
    'Output a JSON object with a single key "cases" whose value is the array of eval cases.',
  ]
    .filter(Boolean)
    .join("\n");
}

function parseAndValidateBatch(raw: string, batchNum: number): RawEvalCase[] {
  const wrapper = JSON.parse(raw) as { cases?: unknown[] };
  const parsed: unknown[] = wrapper.cases ?? [];

  const patched = parsed.map((entry) => {
    if (typeof entry === "object" && entry !== null && !("expected_intents" in entry)) {
      (entry as Record<string, unknown>).expected_intents = { required: [], matchMode: "all" };
    }
    return entry;
  });

  const valid: RawEvalCase[] = [];
  let skipped = 0;
  for (const entry of patched) {
    if (validateRawEval(entry)) {
      const fixedSources = normalizeSources(entry.expected_retrieval_sources);
      const fixedIntents = {
        ...entry.expected_intents,
        required: normalizeIntents(entry.expected_intents.required, entry.eval_id),
        forbidden: normalizeIntents(entry.expected_intents.forbidden ?? [], entry.eval_id),
      };
      valid.push({ ...entry, expected_retrieval_sources: fixedSources, expected_intents: fixedIntents });
    } else {
      skipped++;
      console.warn(`Batch ${batchNum}: skipped invalid entry:`, JSON.stringify(entry).slice(0, 80));
    }
  }

  if (skipped > 0) console.warn(`Batch ${batchNum}: skipped ${skipped} invalid entries.`);
  return valid;
}

async function generateEvalCases(client: OpenAI, difficulty?: string): Promise<RawEvalCase[]> {
  const useCases = JSON.parse(fs.readFileSync(USE_CASES_PATH, "utf-8"));
  const numBatches = Math.ceil(TOTAL_CASES / BATCH_SIZE);
  const allValid: RawEvalCase[] = [];

  console.log(`Stage 1: Generating ${TOTAL_CASES} eval cases in ${numBatches} batches of ${BATCH_SIZE}...`);

  for (let b = 0; b < numBatches; b++) {
    const idStart = b * BATCH_SIZE + 1;
    const idEnd = Math.min((b + 1) * BATCH_SIZE, TOTAL_CASES);
    console.log(`  Batch ${b + 1}/${numBatches}: EVAL_${String(idStart).padStart(3, "0")}–EVAL_${String(idEnd).padStart(3, "0")}...`);

    const message = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 16384,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildBatchMessage(useCases, b + 1, idStart, idEnd, numBatches, difficulty) },
      ],
    });

    const raw = message.choices[0].message.content ?? "";
    const batch = parseAndValidateBatch(raw, b + 1);
    console.log(`  Batch ${b + 1} yielded ${batch.length} valid cases.`);
    allValid.push(...batch);
  }

  fs.mkdirSync(path.dirname(EVAL_CASES_PATH), { recursive: true });
  fs.writeFileSync(EVAL_CASES_PATH, JSON.stringify(allValid, null, 2));
  console.log(`Stage 1 complete: ${allValid.length} eval cases saved to ${EVAL_CASES_PATH}`);

  return allValid;
}

// ─── Retry dropped cases ──────────────────────────────────────────────────────

async function retryDroppedCases(client: OpenAI, existing: RawEvalCase[]): Promise<RawEvalCase[]> {
  const dropped = existing.filter(
    (c) => !c.expected_intents.required.length || !c.expected_retrieval_sources.length
  );

  if (!dropped.length) {
    console.log("Nothing to retry — no cases with empty intents or sources.");
    return existing;
  }

  console.log(`Retrying ${dropped.length} dropped case(s): ${dropped.map(c => c.eval_id).join(", ")}`);

  // Load metadata for query context (why_this_eval_exists)
  const metadata: Record<string, { why_this_eval_exists: string }> =
    fs.existsSync(EVAL_METADATA_PATH)
      ? JSON.parse(fs.readFileSync(EVAL_METADATA_PATH, "utf-8"))
      : {};

  const allRetried: RawEvalCase[] = [];
  const numBatches = Math.ceil(dropped.length / BATCH_SIZE);

  for (let b = 0; b < numBatches; b++) {
    const batchCases = dropped.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const batchNum = b + 1;
    console.log(`  Retry batch ${batchNum}/${numBatches}: ${batchCases.map(c => c.eval_id).join(", ")}...`);

    const caseContext = batchCases.map(c => ({
      eval_id: c.eval_id,
      query: c.query,
      difficulty: c.difficulty,
      hallucination_risk: c.hallucination_risk,
      why_this_eval_exists: metadata[c.eval_id]?.why_this_eval_exists ?? "",
      likely_failure_modes: c.likely_failure_modes,
    }));

    const userMessage = [
      "Re-generate the following evaluation cases. Their intents or retrieval sources were empty due to invalid values.",
      "Preserve the eval_id, query, difficulty, and hallucination_risk exactly. Fix the empty fields.\n",
      JSON.stringify(caseContext, null, 2),
      "",
      "STRICT CONSTRAINTS — use only these exact values:",
      `Valid expected_retrieval_sources: ${Array.from(VALID_SOURCES).map(s => `"${s}"`).join(", ")}`,
      `Valid expected_intents.required/forbidden: ${Array.from(VALID_INTENTS).map(s => `"${s}"`).join(", ")}`,
      `Valid expected_temporal_resolution.type: ${Array.from(VALID_TEMPORAL_TYPES).map(s => `"${s}"`).join(", ")}`,
      `Valid expected_temporal_resolution.relativePeriod: ${Array.from(VALID_RELATIVE_PERIODS).map(s => `"${s}"`).join(", ")}`,
      "expected_entities keys: people (string[]), merchants (string[]), categories (string[]), topics (string[])",
      "conversation_context entries must have exactly: role (\"user\" or \"assistant\") and text (string)",
      "",
      'Output a JSON object with a single key "cases" whose value is the array of regenerated eval cases.',
    ].join("\n");

    const message = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 16384,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = message.choices[0].message.content ?? "";
    const batch = parseAndValidateBatch(raw, batchNum);
    console.log(`  Retry batch ${batchNum} yielded ${batch.length} valid cases.`);
    allRetried.push(...batch);
  }

  // Merge: overwrite existing entries by eval_id with retried ones
  const byId = new Map(existing.map(c => [c.eval_id, c]));
  for (const c of allRetried) byId.set(c.eval_id, c);
  const merged = Array.from(byId.values());

  fs.writeFileSync(EVAL_CASES_PATH, JSON.stringify(merged, null, 2));
  console.log(`Retry complete: ${allRetried.length} cases replaced, ${merged.length} total saved.`);

  return merged;
}

// ─── Stage 2: Convert eval-cases.json → uc-generated.ts ──────────────────────

function inferEvalType(c: RawEvalCase): "exact" | "llm-judge" | "trace-only" {
  if (c.hallucination_risk === "high") return "llm-judge";
  if (c.expected_behavior.should_clarify || c.expected_behavior.should_refuse) return "llm-judge";
  if (c.expected_behavior.should_admit_uncertainty) return "llm-judge";
  return "trace-only";
}

function buildJudgeQuestion(c: RawEvalCase): string | null {
  if (c.expected_behavior.should_clarify) return "Does the response ask for clarification rather than guessing?";
  if (c.expected_behavior.should_refuse) return "Does the response refuse to answer or acknowledge it lacks sufficient evidence?";
  if (c.expected_behavior.should_admit_uncertainty) return "Does the response admit uncertainty or partial evidence rather than presenting a confident answer?";
  if (c.hallucination_risk === "high") return "Does the response avoid asserting facts not directly supported by the retrieved evidence?";
  return null;
}

function inferFailLayer(c: RawEvalCase): "L1" | "L2" | "L3" | "L4" | "L5" {
  const modes = c.likely_failure_modes.join(" ").toLowerCase();
  if (/entity|alias|merchant|person|resolution/.test(modes)) return "L2";
  if (/stale|operational|insight|lifecycle/.test(modes)) return "L3";
  if (/ranking|retrieval|sql|vector|source/.test(modes)) return "L4";
  if (/hallucin|synthesis|conversational|drift|fabricat/.test(modes)) return "L5";
  if (/memory|ingestion|missing data/.test(modes)) return "L1";
  return "L4";
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function normalizeCtxEntry(m: Record<string, unknown>): { role: "user" | "assistant"; text: string } {
  const role: "user" | "assistant" =
    (m.role === "user" || m.role === "assistant") ? m.role :
    m.user_query !== undefined ? "user" : "assistant";
  const text = String(m.text ?? m.user_query ?? m.system_response ?? m.content ?? "");
  return { role, text };
}

function serializeSessionMessages(ctx: RawEvalCase["conversation_context"]): string {
  if (!ctx.length) return "[]";
  const entries = (ctx as unknown as Record<string, unknown>[])
    .map(normalizeCtxEntry)
    .map((m) => `    { role: "${m.role}", text: \`${escapeStr(m.text)}\` }`);
  return `[\n${entries.join(",\n")}\n  ]`;
}

function buildExpectedIntentsBlock(c: RawEvalCase): string {
  const { required, forbidden = [], matchMode = "all" } = c.expected_intents;
  if (!required.length && !forbidden.length) return "";
  const parts = [
    `required: [${required.map(s => `"${s}"`).join(", ")}]`,
    forbidden.length ? `forbidden: [${forbidden.map(s => `"${s}"`).join(", ")}]` : null,
    matchMode !== "all" ? `matchMode: "${matchMode}"` : null,
  ].filter(Boolean).join(", ");
  return `  expectedIntents: { ${parts} },\n`;
}

function buildExpectedEntitiesBlock(c: RawEvalCase): string {
  const e = c.expected_entities;
  const parts: string[] = [];
  if (e.people?.length) parts.push(`people: [${e.people.map(s => `"${escapeStr(s)}"`).join(", ")}]`);
  if (e.merchants?.length) parts.push(`merchants: [${e.merchants.map(s => `"${escapeStr(s)}"`).join(", ")}]`);
  if (e.categories?.length) parts.push(`categories: [${e.categories.map(s => `"${escapeStr(s)}"`).join(", ")}]`);
  if (e.topics?.length) parts.push(`topics: [${e.topics.map(s => `"${escapeStr(s)}"`).join(", ")}]`);
  if (!parts.length) return "";
  return `  expectedEntities: { ${parts.join(", ")} },\n`;
}

function buildExpectedTemporalBlock(c: RawEvalCase): string {
  const t = c.expected_temporal_resolution;
  if (!t || typeof t !== "object") return "";
  const type = t.type as string | undefined;
  const period = t.relativePeriod as string | undefined;
  if (!type || !VALID_TEMPORAL_TYPES.has(type)) return "";
  const parts = [`type: "${type}"`];
  if (period && VALID_RELATIVE_PERIODS.has(period)) parts.push(`relativePeriod: "${period}"`);
  return `  expectedTemporal: { ${parts.join(", ")} },\n`;
}

function buildExpectedPlanBlock(c: RawEvalCase): string {
  if (!c.expected_retrieval_sources.length) return "";
  const steps = c.expected_retrieval_sources
    .map(s => `{ source: "${s}" }`)
    .join(", ");
  return `  expectedRetrievalPlan: [${steps}],\n`;
}

function convertToTypeScript(cases: RawEvalCase[]): string {
  const caseBlocks = cases.map((c) => {
    const evalType = inferEvalType(c);
    const judgeQuestion = buildJudgeQuestion(c);
    const failLayer = inferFailLayer(c);
    const sources = c.expected_retrieval_sources.map((s) => `"${s}"`).join(", ");
    const failConditions = c.likely_failure_modes.map((f) => `    "${escapeStr(f)}"`).join(",\n");
    const sessionMessages = serializeSessionMessages(c.conversation_context);

    const sessionMessagesLine = c.conversation_context.length > 0
      ? `  sessionMessages: ${sessionMessages},\n` : "";
    const requiredSourcesLine = sources.length ? `  requiredSourcesUsed: [${sources}],\n` : "";
    const judgeQuestionLine = judgeQuestion ? `  customJudgeQuestion: \`${escapeStr(judgeQuestion)}\`,\n` : "";
    const intentsLine = buildExpectedIntentsBlock(c);
    const entitiesLine = buildExpectedEntitiesBlock(c);
    const temporalLine = buildExpectedTemporalBlock(c);
    const planLine = buildExpectedPlanBlock(c);

    return `  {
  id: "${c.eval_id}",
  query: \`${escapeStr(c.query)}\`,
  userId: USER_A,
  type: "${evalType}",
${sessionMessagesLine}${requiredSourcesLine}${judgeQuestionLine}${intentsLine}${entitiesLine}${temporalLine}${planLine}  failConditions: [
${failConditions}
  ],
  expectedFailLayer: "${failLayer}",
}`;
  });

  return `// AUTO-GENERATED by evals/agents/eval-converter.ts — do not edit manually
import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;

export const generatedCases: EvalCase[] = [
${caseBlocks.join(",\n")}
];
`;
}

function saveMetadata(cases: RawEvalCase[]): void {
  const metadata = Object.fromEntries(cases.map(c => [
    c.eval_id,
    {
      difficulty: c.difficulty,
      hallucination_risk: c.hallucination_risk,
      why_this_eval_exists: c.why_this_eval_exists,
      expected_evidence_requirements: c.expected_evidence_requirements,
    },
  ]));
  fs.writeFileSync(EVAL_METADATA_PATH, JSON.stringify(metadata, null, 2));
  console.log(`Metadata saved to ${EVAL_METADATA_PATH}`);
}

function updateIndex(): void {
  const current = fs.readFileSync(INDEX_PATH, "utf-8");
  if (current.includes("generatedCases")) {
    console.log("index.ts already imports generatedCases — skipping update.");
    return;
  }
  const withImport = current.replace(
    'import type { EvalCase } from "../lib/types";',
    'import type { EvalCase } from "../lib/types";\nimport { generatedCases } from "./uc-generated";'
  );
  const withExport = withImport.replace(
    "export const allCases: EvalCase[] = [",
    "export const allCases: EvalCase[] = [\n  ...generatedCases,"
  );
  fs.writeFileSync(INDEX_PATH, withExport);
  console.log("Updated evals/cases/index.ts to include generatedCases.");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const skipGenerate = args.includes("--skip-generate");
  const retryDropped = args.includes("--retry-dropped");
  const difficultyIdx = args.indexOf("--difficulty");
  const difficulty = difficultyIdx !== -1 ? args[difficultyIdx + 1] : undefined;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let evalCases: RawEvalCase[];

  if (retryDropped) {
    console.log("--retry-dropped: loading existing eval-cases.json...");
    const existing: RawEvalCase[] = JSON.parse(fs.readFileSync(EVAL_CASES_PATH, "utf-8"));
    evalCases = await retryDroppedCases(client, existing);
  } else if (skipGenerate) {
    console.log("Skipping Stage 1 — loading existing eval-cases.json...");
    evalCases = JSON.parse(fs.readFileSync(EVAL_CASES_PATH, "utf-8"));
    console.log(`Loaded ${evalCases.length} eval cases.`);
  } else {
    evalCases = await generateEvalCases(client, difficulty);
  }

  console.log("\nStage 2: Converting to TypeScript EvalCase[]...");
  const tsContent = convertToTypeScript(evalCases);
  fs.writeFileSync(GENERATED_TS_PATH, tsContent);
  console.log(`Stage 2 complete: wrote ${GENERATED_TS_PATH}`);

  saveMetadata(evalCases);
  updateIndex();

  const byDifficulty = evalCases.reduce<Record<string, number>>((acc, c) => {
    acc[c.difficulty] = (acc[c.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  const byRisk = evalCases.reduce<Record<string, number>>((acc, c) => {
    acc[c.hallucination_risk] = (acc[c.hallucination_risk] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nTotal eval cases: ${evalCases.length}`);
  console.log("By difficulty:", byDifficulty);
  console.log("By hallucination risk:", byRisk);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
