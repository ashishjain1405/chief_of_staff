/**
 * Component eval for parseEmailBody.
 *
 * Pure function, real Gmail payload snapshots, zero API cost, runs in
 * milliseconds. This sits upstream of triage, extraction, summaries and
 * embeddings, so a bad parse degrades everything downstream - 41% of stored
 * bodies begin with CSS boilerplate and 47% of finance-category emails have
 * unusable bodies, which no amount of prompt tuning can fix.
 *
 * Regenerate fixtures with: npm run snapshot:payloads
 *
 * Usage:
 *   npm run eval:parsing
 */

import * as fs from "fs";
import * as path from "path";
import { parseEmailBody } from "@/lib/integrations/gmail";

const FIXTURES = path.join(__dirname, "../fixtures/components/email-payloads.json");

// Markers that mean stylesheet or script text leaked into the parsed body.
const BOILERPLATE = /@media|font-family|!important|-webkit-|text-size-adjust|<!--/i;
const HTML_TAG = /<(?:div|span|table|td|tr|p|a|img|br|style|script)\b[^>]*>/i;
const MIN_CONTENT_CHARS = 100;

type Fixture = {
  id: string;
  subject: string;
  why: string;
  current_body_len: number;
  payload: unknown;
};

function main() {
  const fixtures: Fixture[] = JSON.parse(fs.readFileSync(FIXTURES, "utf-8"));
  if (fixtures.length === 0) {
    console.error("No fixtures. Run: npm run snapshot:payloads");
    process.exit(1);
  }

  console.log(`Running ${fixtures.length} parse case(s)\n`);

  let failed = 0;

  for (const f of fixtures) {
    const body = parseEmailBody(f.payload);
    const head = body.slice(0, 300);

    const checks = [
      {
        name: "has_content",
        pass: body.trim().length >= MIN_CONTENT_CHARS,
        detail: `${body.trim().length} chars (want >= ${MIN_CONTENT_CHARS})`,
      },
      {
        name: "no_style_or_script_text",
        pass: !BOILERPLATE.test(head),
        detail: BOILERPLATE.test(head)
          ? `matched ${BOILERPLATE.exec(head)?.[0]} in first 300 chars`
          : "clean",
      },
      {
        name: "no_html_tags",
        pass: !HTML_TAG.test(body),
        detail: HTML_TAG.test(body) ? `found ${HTML_TAG.exec(body)?.[0]}` : "clean",
      },
    ];

    const bad = checks.filter((c) => !c.pass);
    if (bad.length > 0) failed++;

    const status = bad.length === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(`${status}  ${f.id}  ${(f.subject ?? "").slice(0, 44)}`);
    console.log(`        (${f.why})`);
    for (const c of checks) {
      const mark = c.pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(`        ${mark} ${c.name} - ${c.detail}`);
    }
    if (bad.length > 0) console.log(`        parsed head: ${JSON.stringify(head.slice(0, 110))}`);
    console.log();
  }

  console.log("─".repeat(72));
  console.log(`${fixtures.length - failed}/${fixtures.length} cases passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
