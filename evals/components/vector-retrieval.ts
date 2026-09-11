/**
 * Component eval for semantic retrieval (match_memory_chunks + searchMemory).
 *
 * The match threshold is the single number that decides whether Ask has a
 * semantic layer at all, and an absolute cosine value means nothing on its
 * own - it has to be measured against the corpus it filters. This derives it
 * instead of guessing:
 *
 *   1. CONTROL     - a chunk's own text as the query must self-match at ~1.0.
 *                    Separates "threshold too high" from "pipeline broken".
 *   2. POSITIVES   - questions generated FROM known chunks, so ground truth is
 *                    free. Two difficulty levels, because model-written
 *                    questions are sharper than what people type and flatter
 *                    the system. The vague set is the one that matters.
 *   3. NOISE FLOOR - similarity at rank 50 for those same queries: what
 *                    irrelevant content scores.
 *   4. ABSTRACT    - "what should I focus on today". No email answers these,
 *                    so returning nothing is correct. Guards against setting
 *                    the threshold so low that meta-questions pull in junk.
 *
 * The threshold belongs between the low tail of the positives and the top of
 * the noise. On the current corpus those distributions overlap, so there is no
 * clean answer - only a recall/precision trade. Recall is weighted higher
 * because precision is already handled downstream (vector_search is capped at
 * 2 items and the ranker blends similarity), while a chunk filtered out here
 * can never be ranked at all.
 *
 * Queries are cached as fixtures so the metric is comparable run to run.
 * Re-derive the number when the email mix changes or real users sign up.
 *
 * Usage:
 *   npm run eval:retrieval              run against cached fixtures
 *   npm run eval:retrieval -- --generate   rebuild fixtures from the corpus
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { embedText } from "@/lib/memory/embed";
import { DEFAULT_MATCH_THRESHOLD } from "@/lib/memory/search";

const FIXTURES = path.join(__dirname, "../fixtures/components/retrieval-queries.json");
const SAMPLE_SIZE = 20;
const MIN_CHUNK_CHARS = 300;
const SWEEP = [0.5, 0.45, 0.4, 0.35, 0.3];

// Retrieval is only useful if the answer lands in the window the ranker sees.
const RECALL_AT = 8;

// Gates. Measured baselines were 20/20 specific and 13/18 vague, with 0/4
// abstract queries returning anything; these sit below that to absorb the
// noise in model-generated queries without going slack.
const MIN_SPECIFIC_RECALL = 0.9;
const MIN_VAGUE_RECALL = 0.6;

const ABSTRACT_QUERIES = [
  "what should I focus on today?",
  "overdue follow ups and promises",
  "what needs my attention",
  "am I spending too much",
];

const PROMPTS: Record<Difficulty, string> = {
  specific:
    "Below is a summary of an email from someone's inbox. Write the single most natural question this person would type into an AI assistant that this email answers. Be realistic and conversational - how a busy person actually types. Do not quote the email. Output only the question.",
  vague:
    "Here is an email summary from someone's inbox. Write how that person would VAGUELY ask about it a week later, from fuzzy memory: short, imprecise, missing the key nouns, maybe slightly wrong. Like \"what was that thing about the insurance renewal?\". Max 12 words. Output only the question.",
};

type Difficulty = "specific" | "vague";
type Fixture = { id: string; chunk_id: string; difficulty: Difficulty; query: string };
type Hit = { id: string; similarity: number };

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const fmt = (n: number) => n.toFixed(3);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// match_threshold: -1 so nothing is filtered - the eval needs the raw ranking
// to sweep thresholds after the fact. days_back is wide for the same reason.
async function search(query: string, userId: string, count: number): Promise<Hit[]> {
  const { data, error } = await supabase().rpc("match_memory_chunks", {
    query_embedding: await embedText(query),
    match_threshold: -1,
    match_count: count,
    p_user_id: userId,
    days_back: 3650,
  });
  if (error) throw error;
  return (data ?? []) as Hit[];
}

async function firstUserId(): Promise<string> {
  const { data } = await supabase().from("users").select("id").limit(1);
  if (!data?.length) throw new Error("No users in the database");
  return data[0].id;
}

async function generateFixtures() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { data: pool } = await supabase()
    .from("memory_chunks")
    .select("id, chunk_text")
    .limit(500);

  const usable = (pool ?? []).filter((c) => (c.chunk_text ?? "").length > MIN_CHUNK_CHARS);
  if (usable.length < 5) {
    console.error(`Only ${usable.length} chunks over ${MIN_CHUNK_CHARS} chars. Ingest more mail first.`);
    process.exit(1);
  }

  const sample = usable.sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  console.log(`Generating queries from ${sample.length} chunks (${usable.length} usable of ${pool?.length})\n`);

  const fixtures: Fixture[] = [];
  for (const [i, chunk] of sample.entries()) {
    for (const difficulty of ["specific", "vague"] as Difficulty[]) {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: `${PROMPTS[difficulty]}\n\n---\n${chunk.chunk_text.slice(0, 1200)}`,
        }],
        temperature: difficulty === "vague" ? 0.7 : 0.3,
      });
      const query = res.choices[0].message.content?.trim();
      if (!query) continue;
      fixtures.push({ id: `Q${String(i + 1).padStart(3, "0")}-${difficulty}`, chunk_id: chunk.id, difficulty, query });
      console.log(`  [${difficulty.padEnd(8)}] ${query.slice(0, 68)}`);
    }
  }

  fs.mkdirSync(path.dirname(FIXTURES), { recursive: true });
  fs.writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2));
  console.log(`\nWrote ${fixtures.length} queries to ${path.relative(process.cwd(), FIXTURES)}`);
}

async function run() {
  if (!fs.existsSync(FIXTURES)) {
    console.error("No fixtures. Run: npm run eval:retrieval -- --generate");
    process.exit(1);
  }

  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(FIXTURES, "utf-8"));
  const userId = await firstUserId();

  // Fixtures pin chunk ids, which a rebuild or re-embed invalidates.
  const chunkIds = [...new Set(fixtures.map((f) => f.chunk_id))];
  const { data: live } = await supabase().from("memory_chunks").select("id, chunk_text").in("id", chunkIds);
  const liveById = new Map((live ?? []).map((c) => [c.id, c.chunk_text as string]));
  const stale = chunkIds.filter((id) => !liveById.has(id));
  if (stale.length > 0) {
    console.log(`\x1b[33m${stale.length}/${chunkIds.length} fixture chunks no longer exist - regenerate.\x1b[0m\n`);
  }
  const usable = fixtures.filter((f) => liveById.has(f.chunk_id));
  if (usable.length === 0) {
    console.error("Every fixture chunk is stale. Run: npm run eval:retrieval -- --generate");
    process.exit(1);
  }

  // ── 1. Control
  console.log("CONTROL - a chunk's own text must retrieve itself");
  const controls = [...new Set(usable.map((f) => f.chunk_id))].slice(0, 3);
  let controlFailed = false;
  for (const id of controls) {
    const hits = await search(liveById.get(id)!, userId, 1);
    const ok = hits[0]?.id === id && (hits[0]?.similarity ?? 0) > 0.95;
    if (!ok) controlFailed = true;
    console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} sim=${fmt(hits[0]?.similarity ?? 0)} self=${hits[0]?.id === id}`);
  }
  if (controlFailed) {
    console.error("\n\x1b[31mControl failed: the embedding pipeline is broken, not the threshold.\x1b[0m");
    console.error("Check that embedText and embedAndStoreChunks use the same model and dimensions.");
    process.exit(1);
  }

  // ── 2. Positives
  type Measured = Fixture & { trueSim: number; rank: number; top1: number; noise: number };
  const measured: Measured[] = [];
  for (const f of usable) {
    const hits = await search(f.query, userId, 200);
    const idx = hits.findIndex((h) => h.id === f.chunk_id);
    measured.push({
      ...f,
      trueSim: idx >= 0 ? hits[idx].similarity : 0,
      rank: idx >= 0 ? idx + 1 : -1,
      top1: hits[0]?.similarity ?? 0,
      noise: hits[49]?.similarity ?? 0,
    });
  }

  const recallAt = (rows: Measured[], threshold: number) =>
    rows.filter((r) => r.rank > 0 && r.rank <= RECALL_AT && r.trueSim >= threshold).length;

  for (const difficulty of ["specific", "vague"] as Difficulty[]) {
    const rows = measured.filter((r) => r.difficulty === difficulty);
    if (rows.length === 0) continue;
    const pos = rows.map((r) => r.trueSim);
    console.log(`\n${difficulty.toUpperCase()} queries (n=${rows.length})`);
    console.log(`  known-chunk similarity: p5=${fmt(percentile(pos, 5))} p25=${fmt(percentile(pos, 25))} median=${fmt(percentile(pos, 50))} max=${fmt(Math.max(...pos))}`);
    console.log(`  noise floor (rank 50):  median=${fmt(percentile(rows.map((r) => r.noise), 50))} max=${fmt(Math.max(...rows.map((r) => r.noise)))}`);
    for (const r of rows.filter((r) => r.trueSim < DEFAULT_MATCH_THRESHOLD || r.rank > RECALL_AT || r.rank < 0)) {
      console.log(`  \x1b[33mmiss\x1b[0m sim=${fmt(r.trueSim)} rank=${r.rank} "${r.query.slice(0, 52)}"`);
    }
  }

  // ── 3. Sweep
  console.log(`\nTHRESHOLD SWEEP - known chunk reachable within top ${RECALL_AT}`);
  console.log(`  threshold  specific   vague`);
  for (const th of SWEEP) {
    const spec = measured.filter((r) => r.difficulty === "specific");
    const vague = measured.filter((r) => r.difficulty === "vague");
    const mark = th === DEFAULT_MATCH_THRESHOLD ? " \x1b[36m<- in use\x1b[0m" : "";
    console.log(`  ${th.toFixed(2).padEnd(10)} ${`${recallAt(spec, th)}/${spec.length}`.padEnd(10)} ${`${recallAt(vague, th)}/${vague.length}`.padEnd(7)}${mark}`);
  }

  // ── 4. Abstract queries must stay empty
  console.log(`\nABSTRACT queries - should return nothing at ${DEFAULT_MATCH_THRESHOLD}`);
  let leaked = 0;
  for (const q of ABSTRACT_QUERIES) {
    const hits = await search(q, userId, 10);
    const above = hits.filter((h) => h.similarity >= DEFAULT_MATCH_THRESHOLD).length;
    if (above > 0) leaked++;
    console.log(`  ${above === 0 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} top1=${fmt(hits[0]?.similarity ?? 0)} above-threshold=${above}  "${q}"`);
  }

  // ── Verdict
  const spec = measured.filter((r) => r.difficulty === "specific");
  const vague = measured.filter((r) => r.difficulty === "vague");
  const specRecall = spec.length ? recallAt(spec, DEFAULT_MATCH_THRESHOLD) / spec.length : 1;
  const vagueRecall = vague.length ? recallAt(vague, DEFAULT_MATCH_THRESHOLD) / vague.length : 1;

  console.log("\n" + "─".repeat(72));
  console.log(`threshold in use:      ${DEFAULT_MATCH_THRESHOLD}`);
  console.log(`recall@${RECALL_AT} specific:     ${(specRecall * 100).toFixed(0)}% (gate ${MIN_SPECIFIC_RECALL * 100}%)`);
  console.log(`recall@${RECALL_AT} vague:        ${(vagueRecall * 100).toFixed(0)}% (gate ${MIN_VAGUE_RECALL * 100}%)`);
  console.log(`abstract queries leaking results: ${leaked}/${ABSTRACT_QUERIES.length} (gate 0)`);

  const failures = [
    specRecall < MIN_SPECIFIC_RECALL && `specific recall ${(specRecall * 100).toFixed(0)}% below ${MIN_SPECIFIC_RECALL * 100}%`,
    vagueRecall < MIN_VAGUE_RECALL && `vague recall ${(vagueRecall * 100).toFixed(0)}% below ${MIN_VAGUE_RECALL * 100}%`,
    leaked > 0 && `${leaked} abstract queries returned results - threshold may be too low`,
  ].filter(Boolean) as string[];

  if (failures.length > 0) {
    console.log(`\n\x1b[31mFAIL\x1b[0m`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mPASS\x1b[0m`);
  process.exit(0);
}

async function main() {
  if (process.argv.includes("--generate")) {
    await generateFixtures();
    process.exit(0);
  }
  await run();
}

main();
