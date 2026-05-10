import type { EvalResult } from "./types";

const HARD_GATES = new Set(["A3", "F2", "H1", "A1"]);

export function printReport(results: EvalResult[]) {
  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);
  const hardFails = failed.filter(r => HARD_GATES.has(r.caseId));

  console.log("\n" + "─".repeat(72));

  for (const r of results) {
    const status = r.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    const layers = formatLayers(r);
    const tail = r.passed ? r.query.slice(0, 50) : `root: ${r.failedAt} — ${r.reason?.slice(0, 50)}`;
    console.log(`${status}  ${r.caseId.padEnd(4)} ${layers}  ${tail}`);
  }

  console.log("─".repeat(72));
  console.log(`Results: ${passed.length}/${results.length} passed (${pct(passed.length, results.length)}%)`);
  console.log(`Hard gate failures: ${hardFails.length}${hardFails.length > 0 ? "  \x1b[31m← blocks ship\x1b[0m" : ""}`);
  console.log(`Soft gate failures: ${failed.length - hardFails.length}`);
  console.log();
}

function formatLayers(r: EvalResult): string {
  if (!r.failedAt) return "[✓]      ";
  const layers = ["L1", "L2", "L3", "L4", "L5"] as const;
  const parts = layers.map(l => {
    if (r.failedAt === l) return `\x1b[31m${l}✗\x1b[0m`;
    if (layerIndex(l) < layerIndex(r.failedAt as string)) return `\x1b[32m${l}✓\x1b[0m`;
    return `${l}-`;
  });
  return `[${parts.join(" ")}]`;
}

function layerIndex(l: string): number {
  return ["L1", "L2", "L3", "L4", "L5", "exact", "llm"].indexOf(l);
}

function pct(n: number, total: number): string {
  return total === 0 ? "0" : ((n / total) * 100).toFixed(1);
}

export function saveResults(results: EvalResult[]) {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "../results");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`Results saved to ${file}`);
}
