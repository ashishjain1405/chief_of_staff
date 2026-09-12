/**
 * Component eval for the task-creation decision.
 *
 * 28 of 46 pending tasks were once bank-alert boilerplate - "report
 * unauthorized transaction if it was not authorized" - roughly one useful task
 * per two junk ones. That was four compounding causes: the triage prompt never
 * defined requires_action, triage ran at temperature 1.0 so the category flipped
 * between runs, task creation was gated on a noisy importance_score, and the
 * worker's block list had drifted from the inbox grouping.
 *
 * None of those are visible from the outside. What is measurable is the single
 * decision they all feed: given a real email, does a task appear.
 *
 * Two things are asserted per case:
 *   1. creates_task matches the label.
 *   2. action_description is phrased as something the founder can do. Triage
 *      used to emit third-person chores - "the customer should verify...",
 *      "Ensure Kamal understands..." - which are somebody else's work.
 *
 * And one across cases:
 *   3. STABILITY. Re-triaging the same email must return the same category.
 *      This is what temperature 0 bought, and a regression here silently makes
 *      task creation a coin flip.
 *
 * Uses the same lib/tasks/gate.ts the worker calls, so the eval cannot pass
 * against a rule the pipeline does not actually apply.
 *
 * Usage:
 *   npm run snapshot:tasks     capture/refresh fixtures from real mail
 *   npm run eval:tasks         run
 */

import * as fs from "fs";
import * as path from "path";
import { triageEmail } from "@/lib/ai/claude";
import { shouldCreateTask } from "@/lib/tasks/gate";
import { isKnownFinancialDomain } from "@/lib/finance/senders";
import { resolveFollowUpDeadline } from "@/lib/tasks/deadline";

const FIXTURES = path.join(__dirname, "../fixtures/components/task-cases.json");

// Sampled for the stability check. Every case would triple the cost for little
// extra signal, since a temperature regression shows up immediately.
const STABILITY_SAMPLE = 4;

// Third-person phrasing means the action was written for somebody else.
const THIRD_PERSON =
  /\b(the|this)\s+(customer|user|recipient|receiver|client|sender)\b|\b(customer|user|recipient|receiver)\s+(should|must|needs?|has to)\b/i;

type Case = {
  id: string;
  subject: string;
  sender: string;
  to: string;
  body: string;
  stored_category: string;
  expect: { creates_task: boolean };
  why: string;
  // Set when a case is a documented pipeline limitation rather than a
  // regression. Reported every run but excluded from the gate, so the eval
  // stays useful instead of failing permanently. If a known_gap case starts
  // passing, the run says so and the marker should come off.
  known_gap?: string;
};

async function main() {
  if (!fs.existsSync(FIXTURES)) {
    console.error("No fixtures. Run: npm run snapshot:tasks");
    process.exit(1);
  }
  const cases: Case[] = JSON.parse(fs.readFileSync(FIXTURES, "utf-8"));
  if (cases.length === 0) {
    console.error("Fixture file is empty. Run: npm run snapshot:tasks");
    process.exit(1);
  }

  const founderAddress = cases.find((c) => c.to)?.to ?? "unknown";
  console.log(`Running ${cases.length} task-creation case(s)\n`);

  let wrongDecision = 0;
  let fixedGaps = 0;
  let thirdPerson = 0;
  let badDeadline = 0;
  const firstPass = new Map<string, string>();

  for (const c of cases) {
    const senderInfo = `<${c.sender}>`;
    const recipientInfo = `the founder's own address is ${founderAddress}; this email's To: ${c.to || "unknown"}`;
    const triage = await triageEmail({}, senderInfo, c.body, recipientInfo);
    firstPass.set(c.id, triage.email_category);

    const creates = shouldCreateTask({
      category: triage.email_category,
      requiresAction: triage.requires_action,
      senderEmail: c.sender,
      founderEmail: founderAddress,
      isFinancialDomain: isKnownFinancialDomain(c.sender),
    });

    const decisionOk = creates === c.expect.creates_task;
    if (!decisionOk && !c.known_gap) wrongDecision++;
    if (decisionOk && c.known_gap) fixedGaps++;

    // Only meaningful when a task is actually produced.
    const action = triage.action_description ?? "";
    const phrasingOk = !creates || !THIRD_PERSON.test(action);
    if (!phrasingOk) thirdPerson++;

    // A deadline can never predate the email that asked for it. The resolver
    // nulls those; if it had to, triage produced an impossible date.
    const rawDeadline = triage.follow_up_deadline;
    const resolved = resolveFollowUpDeadline(rawDeadline, new Date().toISOString());
    const deadlineOk = !rawDeadline || resolved !== null;
    if (!deadlineOk) badDeadline++;

    const status = decisionOk && phrasingOk
      ? "\x1b[32mPASS\x1b[0m"
      : c.known_gap
        ? "\x1b[33mGAP \x1b[0m"
        : "\x1b[31mFAIL\x1b[0m";
    console.log(`${status}  ${c.subject.slice(0, 52)}`);
    console.log(`        want task=${c.expect.creates_task}  got task=${creates}  (${triage.email_category}, action=${triage.requires_action})`);
    if (!decisionOk) console.log(`        \x1b[33m${c.why}\x1b[0m`);
    if (!decisionOk && c.known_gap) console.log(`        \x1b[33mknown gap:\x1b[0m ${c.known_gap}`);
    if (decisionOk && c.known_gap) console.log(`        \x1b[32mknown gap now passes - remove the marker\x1b[0m`);
    if (!phrasingOk) console.log(`        \x1b[31mthird person:\x1b[0m ${action.slice(0, 70)}`);
    if (!deadlineOk) console.log(`        \x1b[33mimpossible deadline:\x1b[0m ${rawDeadline}`);
  }

  // ── Stability: same email, same category
  console.log(`\nSTABILITY - re-triaging ${STABILITY_SAMPLE} cases, category must not move`);
  let unstable = 0;
  for (const c of cases.slice(0, STABILITY_SAMPLE)) {
    const again = await triageEmail(
      {},
      `<${c.sender}>`,
      c.body,
      `the founder's own address is ${founderAddress}; this email's To: ${c.to || "unknown"}`
    );
    const same = again.email_category === firstPass.get(c.id);
    if (!same) unstable++;
    console.log(`  ${same ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${firstPass.get(c.id)} -> ${again.email_category}  ${c.subject.slice(0, 40)}`);
  }

  const gaps = cases.filter((c) => c.known_gap).length;
  const gated = cases.length - gaps;
  const correct = gated - wrongDecision;
  console.log("\n" + "─".repeat(72));
  console.log(`correct decisions:     ${correct}/${gated} gated (${gaps} known gap(s) excluded)`);
  if (fixedGaps > 0) console.log(`known gaps now passing: ${fixedGaps} - remove their markers`);
  console.log(`third-person actions:  ${thirdPerson} (gate 0)`);
  console.log(`impossible deadlines:  ${badDeadline} (reported, not gated - the resolver nulls them)`);
  console.log(`unstable categories:   ${unstable}/${STABILITY_SAMPLE} (gate 0)`);

  const failures = [
    wrongDecision > 0 && `${wrongDecision} wrong task decision(s)`,
    thirdPerson > 0 && `${thirdPerson} action(s) written in third person`,
    unstable > 0 && `${unstable} category flip(s) - check that triage still sets temperature 0`,
  ].filter(Boolean) as string[];

  if (failures.length > 0) {
    console.log(`\n\x1b[31mFAIL\x1b[0m`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n\x1b[32mPASS\x1b[0m`);
  process.exit(0);
}

main();
