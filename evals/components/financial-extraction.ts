/**
 * Component eval for the financial extractor.
 *
 * Unlike evals/scripts/run.ts - which drives the whole pipeline through
 * /api/ask?eval=true - this calls extractFinancialTransaction() directly. No
 * server, no Supabase, no seeded users: just an email in, structured fields out.
 * That isolation is the point, since a wrong amount here is invisible to any
 * end-to-end Ask assertion but lands straight in the finance dashboard.
 *
 * Usage:
 *   npx tsx --env-file=.env.local --tsconfig tsconfig.json evals/components/financial-extraction.ts
 *   npx tsx ... evals/components/financial-extraction.ts --id FX1-cdsl-quantity-not-amount
 *   npx tsx ... evals/components/financial-extraction.ts --runs 3   # sample for flakiness
 */

import * as fs from "fs";
import * as path from "path";
import { extractFinancialTransaction } from "@/lib/ai/extractors/financial";
import { classifySender } from "@/lib/finance/senders";

type Expect = {
  is_financial_email?: boolean;
  amount?: number | null;
  // For emails that legitimately contain several transactions: the schema holds
  // only one, and the prompt says to keep "the primary one", so any of these is
  // defensible and pinning a single value would make the case arbitrary.
  amount_in?: number[];
  currency?: string;
  merchant_contains?: string;
  category?: string[];
  transaction_type?: string[];
  min_confidence?: number;
  max_confidence?: number;
  datetime_not_after_today?: boolean;
};

type Case = {
  id: string;
  note: string;
  input: { sender: string; subject: string; body: string };
  expect: Expect;
};

type Check = { field: string; pass: boolean; detail: string };

const FIXTURES = path.join(__dirname, "../fixtures/components/financial-extraction.json");

const args = process.argv.slice(2);
const idIndex = args.indexOf("--id");
const only = idIndex === -1 ? undefined : args[idIndex + 1];
const runs = args.includes("--runs") ? parseInt(args[args.indexOf("--runs") + 1], 10) : 1;

function endOfToday(): number {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d.getTime();
}

function checkCase(c: Case, result: any): Check[] {
  const checks: Check[] = [];
  const e = c.expect;
  const txn = result.transaction ?? {};

  const add = (field: string, pass: boolean, detail: string) =>
    checks.push({ field, pass, detail });

  if (e.is_financial_email !== undefined) {
    add(
      "is_financial_email",
      result.is_financial_email === e.is_financial_email,
      `expected ${e.is_financial_email}, got ${result.is_financial_email}`
    );
  }

  if (e.amount !== undefined) {
    const got = txn.amount ?? null;
    add("amount", got === e.amount, `expected ${e.amount}, got ${got}`);
  }

  if (e.amount_in !== undefined) {
    const got = txn.amount ?? null;
    add(
      "amount_in",
      got !== null && e.amount_in.includes(got),
      `expected one of [${e.amount_in.join(", ")}], got ${got}`
    );
  }

  if (e.currency !== undefined) {
    add("currency", txn.currency === e.currency, `expected ${e.currency}, got ${txn.currency}`);
  }

  if (e.merchant_contains !== undefined) {
    const merchant = `${txn.merchant_name ?? ""} ${txn.merchant_normalized ?? ""}`.toLowerCase();
    add(
      "merchant",
      merchant.includes(e.merchant_contains.toLowerCase()),
      `expected to contain "${e.merchant_contains}", got "${txn.merchant_name} / ${txn.merchant_normalized}"`
    );
  }

  if (e.category !== undefined) {
    add(
      "category",
      e.category.includes(txn.category),
      `expected one of [${e.category.join(", ")}], got ${txn.category}`
    );
  }

  if (e.transaction_type !== undefined) {
    add(
      "transaction_type",
      e.transaction_type.includes(txn.transaction_type),
      `expected one of [${e.transaction_type.join(", ")}], got ${txn.transaction_type}`
    );
  }

  if (e.min_confidence !== undefined) {
    add(
      "min_confidence",
      result.confidence >= e.min_confidence,
      `expected >= ${e.min_confidence}, got ${result.confidence}`
    );
  }

  if (e.max_confidence !== undefined) {
    add(
      "max_confidence",
      result.confidence <= e.max_confidence,
      `expected <= ${e.max_confidence}, got ${result.confidence}`
    );
  }

  if (e.datetime_not_after_today) {
    const dt = txn.transaction_datetime ? new Date(txn.transaction_datetime).getTime() : null;
    add(
      "datetime_not_after_today",
      dt === null || dt <= endOfToday(),
      `got ${txn.transaction_datetime}`
    );
  }

  return checks;
}

async function main() {
  const all: Case[] = JSON.parse(fs.readFileSync(FIXTURES, "utf-8"));
  const cases = only ? all.filter((c) => c.id === only) : all;

  if (cases.length === 0) {
    console.error(`No cases matched. Available: ${all.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`Running ${cases.length} extraction case(s)${runs > 1 ? ` x${runs} runs` : ""}\n`);

  let failedCases = 0;

  for (const c of cases) {
    const senderType = classifySender(c.input.sender);
    // Per-field tallies, so a field that only fails sometimes is visible as
    // flaky rather than averaging into a single misleading pass/fail.
    const tally = new Map<string, { pass: number; details: Set<string> }>();

    for (let i = 0; i < runs; i++) {
      const result = await extractFinancialTransaction(
        c.input.sender,
        senderType,
        c.input.subject,
        c.input.body
      );
      for (const chk of checkCase(c, result)) {
        if (!tally.has(chk.field)) tally.set(chk.field, { pass: 0, details: new Set() });
        const t = tally.get(chk.field)!;
        if (chk.pass) t.pass++;
        else t.details.add(chk.detail);
      }
    }

    const failed = [...tally.entries()].filter(([, t]) => t.pass < runs);
    if (failed.length > 0) failedCases++;

    const status = failed.length === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${status}  ${c.id}  (sender_type=${senderType})`);
    for (const [field, t] of tally) {
      const mark = t.pass === runs ? "\x1b[32m✓\x1b[0m" : t.pass === 0 ? "\x1b[31m✗\x1b[0m" : "\x1b[33m~\x1b[0m";
      const rate = runs > 1 ? ` [${t.pass}/${runs}]` : "";
      const detail = t.details.size > 0 ? ` - ${[...t.details].join("; ")}` : "";
      console.log(`        ${mark} ${field}${rate}${detail}`);
    }
    if (failed.length > 0) console.log(`        note: ${c.note}`);
    console.log();
  }

  console.log("─".repeat(72));
  console.log(`${cases.length - failedCases}/${cases.length} cases passed`);
  process.exit(failedCases > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
