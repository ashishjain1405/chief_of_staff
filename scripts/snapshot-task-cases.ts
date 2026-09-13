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
//
// `bulk` selects on the List-Unsubscribe header, which is the cleanest
// available marketing signal: 72% of the corpus carries it, and the categories
// that yield genuine tasks barely do (pending_reply 0 of 17, important 1 of
// 18). It is not sufficient on its own though - "your car insurance is due for
// renewal soon" is bulk and real - so the bulk classes below are the ones that
// must be judged on content, not just the header.
const CLASSES: {
  category: string;
  n: number;
  creates_task: boolean;
  why: string;
  bulk?: boolean;
}[] = [
  // ── Completed events: the only "action" is a conditional disclaimer.
  { category: "transactions", n: 4, creates_task: false, why: "Completed debit. The only action is the conditional 'if unauthorized, report it' disclaimer present in every such alert." },
  { category: "account_security", n: 2, creates_task: false, why: "OTP or login notice. Informational, with a conditional 'if this wasn't you' disclaimer." },
  { category: "shipping_orders", n: 3, creates_task: false, why: "Shipped or delivered notification. The event already happened; nothing is owed." },

  // ── Marketing wearing a useful-looking category.
  { category: "promotions", n: 2, creates_task: false, why: "Marketing. Nothing is owed by the recipient." },
  { category: "newsletters", n: 2, creates_task: false, why: "Editorial digest to skim." },
  { category: "learning", n: 3, creates_task: false, bulk: true, why: "Content marketing - a webinar or course pitch sent to a list. 'Register for the live session' is the sender's call to action, not the recipient's obligation." },
  { category: "travel", n: 3, creates_task: false, bulk: true, why: "Travel deal blast - 'Flights from Rs 3,165', 'Save 35%'. An offer, not a booking the founder has committed to." },
  { category: "subscriptions_memberships", n: 3, creates_task: false, bulk: true, why: "Upsell - 'upgrade to premium', 'reactivate your plan'. A pitch to spend more, not a renewal the founder owes." },
  { category: "finance_bills", n: 3, creates_task: false, bulk: true, why: "Statement, disclosure or credit-score notice sent to every customer. Boilerplate like 'compare the balances with your statement' or 'open the attachment using your PAN' is standard text, not a personal instruction." },

  // ── Genuine asks, which the fix must not break.
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
  const taken = new Set<string>();
  for (const cls of CLASSES) {
    let query: any = supabase
      .from("communications")
      .select("id, subject, body, email_category, channel_metadata, contacts(email)")
      .eq("email_category", cls.category)
      .not("body", "is", null);

    // List-Unsubscribe present means a mass mailing; absent means it was sent
    // to this recipient specifically.
    if (cls.bulk === true) query = query.not("channel_metadata->>list_unsubscribe", "is", null);
    if (cls.bulk === false) query = query.is("channel_metadata->>list_unsubscribe", null);

    const { data: rows } = await query.limit(cls.n * 4);

    // Prefer emails with enough body to be a fair test.
    const usable = (rows ?? [])
      .filter((r: any) => (r.body ?? "").length > 200 && !taken.has(r.id))
      .slice(0, cls.n);

    for (const r of usable) {
      taken.add(r.id);
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
