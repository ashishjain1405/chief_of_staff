/**
 * AGENT 1 — Use Case Discovery Agent
 *
 * Generates a strategic library of use cases for the chief-of-staff AI system
 * by calling Claude with a product strategist persona, then saves them to
 * evals/fixtures/use-cases.json.
 *
 * Usage:
 *   npx tsx --env-file=.env.eval evals/agents/use-case-discovery.ts
 *   npx tsx --env-file=.env.eval evals/agents/use-case-discovery.ts --category finance
 *   npx tsx --env-file=.env.eval evals/agents/use-case-discovery.ts --count 20
 *   npx tsx --env-file=.env.eval evals/agents/use-case-discovery.ts --append
 *
 * Weekly cron (Monday 9am):
 *   0 9 * * 1  cd /path/to/chief-of-staff && npx tsx --env-file=.env.eval evals/agents/use-case-discovery.ts >> evals/results/discovery.log 2>&1
 */

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";

const FIXTURES_PATH = path.join(__dirname, "../fixtures/use-cases.json");

const SYSTEM_PROMPT = `You are a senior AI Product Strategist and AI Systems Researcher specializing in:

AI memory systems
agentic assistants
retrieval architectures
enterprise productivity workflows
personal operating systems
conversational AI
information retrieval
organizational cognition

You are helping design an evaluation framework for an AI Chief of Staff product.

The product ingests:

emails
meetings
tasks
commitments
financial transactions
vector memories
operational insights

The system architecture has 5 layers:

Raw Memory
communications
meetings
transactions
tasks
commitments
vector memory
Entity Resolution
people
merchants
aliases
projects
topics
temporal anchors
Operational Intelligence
precomputed operational insights
lifecycle-managed states
alerts
summaries
anomalies
Investigative Retrieval
SQL retrieval
aggregations
vector search
hybrid retrieval
ranking
evidence blending
Conversational Synthesis
evidence-grounded response generation
conversational memory
ambiguity handling
clarification behavior

Your task is to identify:

realistic user questions
latent user needs
difficult retrieval scenarios
ambiguous conversational situations
operational edge cases
retrieval conflicts
entity conflicts
temporal ambiguities
multi-hop reasoning requirements
contradictory evidence situations
ranking failures
conversational memory failures
hallucination risks
missing evidence situations
cross-layer conflicts

You should think like:

a power user
an executive
a founder
a chief of staff
a finance-heavy user
a relationship-heavy user
a travel-heavy user
an overloaded knowledge worker

Your output should be exhaustive, deeply practical, and adversarial.

Avoid generic chatbot queries. Focus on:

realistic workflows
difficult retrieval paths
layered reasoning
architecture-breaking edge cases

For every use case include:

{ "use_case_id": "UC_###", "category": "finance|relationships|tasks|meetings|travel|operations|cross_domain|etc", "user_goal": "what the user is actually trying to achieve", "query_examples": [], "required_layers": [], "required_reasoning": [], "likely_failure_modes": [], "cross_layer_conflicts": [], "risk_level": "low|medium|high|critical", "why_this_is_hard": "detailed explanation" }

Generate:

simple use cases
medium complexity use cases
adversarial edge cases
multi-turn conversational cases
contradictory evidence cases
retrieval ambiguity cases
operational vs investigative conflicts
temporal anchor ambiguity
alias conflicts
ranking failures
stale operational insight issues
partial memory situations
false positive retrieval cases
overloaded context situations
long-session conversational drift

Be comprehensive. Assume this system will eventually operate at production scale.`;

type UseCase = {
  use_case_id: string;
  category: string;
  user_goal: string;
  query_examples: string[];
  required_layers: string[];
  required_reasoning: string[];
  likely_failure_modes: string[];
  cross_layer_conflicts: string[];
  risk_level: "low" | "medium" | "high" | "critical";
  why_this_is_hard: string;
};

const REQUIRED_FIELDS: (keyof UseCase)[] = [
  "use_case_id",
  "category",
  "user_goal",
  "query_examples",
  "required_layers",
  "required_reasoning",
  "likely_failure_modes",
  "cross_layer_conflicts",
  "risk_level",
  "why_this_is_hard",
];

function validateUseCase(obj: unknown): obj is UseCase {
  if (typeof obj !== "object" || obj === null) return false;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) return false;
  }
  return true;
}

function buildUserMessage(category?: string, count?: number): string {
  let msg =
    "Generate a comprehensive use case library for this AI Chief of Staff system.\n\n";

  if (category) {
    msg += `Focus only on the "${category}" category.\n\n`;
  }

  if (count) {
    msg += `Generate exactly ${count} use cases.\n\n`;
  } else {
    msg +=
      "Generate at least 60 use cases covering all complexity levels and categories.\n\n";
  }

  msg +=
    'Output a JSON object with a single key "cases" whose value is the array of use cases.';
  return msg;
}

function printSummary(cases: UseCase[]): void {
  const byRisk = cases.reduce<Record<string, number>>((acc, c) => {
    acc[c.risk_level] = (acc[c.risk_level] ?? 0) + 1;
    return acc;
  }, {});

  const byCategory = cases.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\nTotal use cases: ${cases.length}`);
  console.log("\nBy risk level:");
  for (const [level, count] of Object.entries(byRisk)) {
    console.log(`  ${level}: ${count}`);
  }
  console.log("\nBy category:");
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const categoryIdx = args.indexOf("--category");
  const countIdx = args.indexOf("--count");
  const append = args.includes("--append");

  const category = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined;
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : undefined;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  console.log("Running Use Case Discovery Agent...");
  if (category) console.log(`Category filter: ${category}`);
  if (count) console.log(`Count limit: ${count}`);

  const message = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(category, count) },
    ],
  });

  const raw = message.choices[0].message.content ?? "";
  const wrapper = JSON.parse(raw) as { cases?: unknown[] };
  const parsed: unknown[] = wrapper.cases ?? [];

  const valid: UseCase[] = [];
  let skipped = 0;
  for (const entry of parsed) {
    if (validateUseCase(entry)) {
      valid.push(entry);
    } else {
      skipped++;
      console.warn("Skipped invalid entry:", JSON.stringify(entry).slice(0, 100));
    }
  }

  if (skipped > 0) {
    console.warn(`\nSkipped ${skipped} invalid entries.`);
  }

  let output: UseCase[] = valid;
  if (append && fs.existsSync(FIXTURES_PATH)) {
    const existing: UseCase[] = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8"));
    const existingIds = new Set(existing.map((c) => c.use_case_id));
    const newCases = valid.filter((c) => !existingIds.has(c.use_case_id));
    output = [...existing, ...newCases];
    console.log(`\nAppended ${newCases.length} new cases to existing ${existing.length}.`);
  }

  fs.mkdirSync(path.dirname(FIXTURES_PATH), { recursive: true });
  fs.writeFileSync(FIXTURES_PATH, JSON.stringify(output, null, 2));
  console.log(`\nSaved ${output.length} use cases to ${FIXTURES_PATH}`);

  printSummary(valid);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
