/**
 * Captures real emails as labelled fixtures for the task-extraction eval.
 *
 * Labels are assigned per class rather than per email, from evidence already
 * measured on this corpus: bank and UPI alerts carry a conditional "if you did
 * not authorize this, report it" disclaimer and nothing to do; OTP and login
 * alerts are the same shape; newsletters and promotions are to skim; human mail
 * in "important" / "pending_reply" is where real asks live.
 *
 * Hand-correct any label that is wrong for a specific email and set `why` to
 * say so - the eval reads the file, never regenerates it in place, and existing
 * labels are carried forward on re-run.
 *
 * Usage:
 *   npm run snapshot:tasks
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

const OUT = path.join(__dirname, "../evals/fixtures/components/task-cases.json");

type Case = {
  id: string;
  subject: string;
  sender: string;
  to: string;
  body: string;
  stored_category: string;
  expect: { creates_task: boolean };
  why: string;
};

// Each class pins an expected outcome and the reason for it.
const CLASSES: { category: string; n: number; creates_task: boolean; why: string }[] = [
  { category: "transactions", n: 4, creates_task: false, why: "Completed debit. The only action is the conditional 'if unauthorized, report it' disclaimer present in every such alert." },
  { category: "account_security", n: 2, creates_task: false, why: "OTP or login notice. Informational, with a conditional 'if this wasn't you' disclaimer." },
  { category: "promotions", n: 2, creates_task: false, why: "Marketing. Nothing is owed by the recipient." },
  { category: "newsletters", n: 2, creates_task: false, why: "Editorial digest to skim." },
  { category: "pending_reply", n: 3, creates_task: true, why: "A human is waiting on a reply from the founder." },
  { category: "important", n: 3, creates_task: true, why: "Human mail with an ask the founder personally owns." },
  { category: "finance_bills", n: 2, creates_task: true, why: "Money owed or an upcoming charge - the founder must pay or cancel." },
];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Carry forward any label that was hand-corrected.
  const existing: Record<string, Case> = {};
  if (fs.existsSync(OUT)) {
    for (const c of JSON.parse(fs.readFileSync(OUT, "utf-8")) as Case[]) existing[c.id] = c;
  }

  const cases: Case[] = [];
  for (const cls of CLASSES) {
    const { data: rows } = await supabase
      .from("communications")
      .select("id, subject, body, email_category, channel_metadata, contacts(email)")
      .eq("email_category", cls.category)
      .not("body", "is", null)
      .limit(cls.n * 3);

    // Prefer emails with enough body to be a fair test.
    const usable = (rows ?? []).filter((r) => (r.body ?? "").length > 200).slice(0, cls.n);

    for (const r of usable) {
      const prior = existing[r.id];
      cases.push({
        id: r.id,
        subject: r.subject ?? "",
        sender: (r.contacts as any)?.email ?? "",
        to: String((r.channel_metadata as any)?.to ?? ""),
        body: (r.body ?? "").slice(0, 4000),
        stored_category: r.email_category ?? "",
        // A hand-corrected label wins over the class default.
        expect: prior?.expect ?? { creates_task: cls.creates_task },
        why: prior?.why ?? cls.why,
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(cases, null, 2));

  const carried = cases.filter((c) => existing[c.id]).length;
  console.log(`Wrote ${cases.length} cases to ${path.relative(process.cwd(), OUT)}`);
  console.log(`  ${carried} label(s) carried forward from the previous file`);
  console.log(`  expect task: ${cases.filter((c) => c.expect.creates_task).length}, expect none: ${cases.filter((c) => !c.expect.creates_task).length}`);
  process.exit(0);
}

main();
