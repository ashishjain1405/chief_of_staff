import * as fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { fetchEmailById } from "@/lib/integrations/gmail";

// Snapshots real Gmail payloads into a fixture file so parseEmailBody can be
// eval'd hermetically. raw_events only stores {messageId, historyId}, so the
// payloads have to come from the API once and then be committed.
//
//   npm run snapshot:payloads -- --user <uuid>

const OUT = "evals/fixtures/components/email-payloads.json";
const CSS = /@media|font-family|!important|-webkit-/i;

const userArg = process.argv.find((a) => a.startsWith("--user="))?.split("=")[1];

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let userId = userArg;
  if (!userId) {
    // Default to the account with a live Gmail watch - the others can't be fetched.
    const { data } = await supabase
      .from("integrations")
      .select("user_id")
      .eq("provider", "google")
      .eq("is_active", true)
      .gt("metadata->>watch_expires_at", new Date().toISOString())
      .limit(1);
    userId = data?.[0]?.user_id;
  }
  if (!userId) throw new Error("No user with a live Gmail watch; pass --user=<uuid>");

  const { data: rows } = await supabase
    .from("communications")
    .select("external_id, subject, body")
    .eq("user_id", userId)
    .eq("source", "gmail")
    .not("external_id", "is", null)
    .limit(1000);

  const all = rows ?? [];
  const cssBad = all.filter((r) => r.body && CSS.test(r.body.slice(0, 300)));
  const emptyBad = all.filter((r) => !r.body || r.body.trim().length < 50);
  const clean = all.filter(
    (r) => r.body && r.body.trim().length > 200 && !CSS.test(r.body.slice(0, 300))
  );

  const picks = [
    ...cssBad.slice(0, 3).map((r) => ({ ...r, why: "body begins with CSS boilerplate" })),
    ...emptyBad.slice(0, 2).map((r) => ({ ...r, why: "body parses very short - check whether the email has any text at all" })),
    ...clean.slice(0, 2).map((r) => ({ ...r, why: "control: currently parses cleanly" })),
  ];

  console.log(`Snapshotting ${picks.length} payloads for user ${userId}\n`);

  // Hand-written expectations and verified notes must survive a regeneration -
  // an earlier run of this script silently discarded them.
  const existing: Record<string, { why?: string; expect?: unknown }> = {};
  if (fs.existsSync(OUT)) {
    for (const f of JSON.parse(fs.readFileSync(OUT, "utf-8"))) {
      existing[f.id] = { why: f.why, expect: f.expect };
    }
  }

  const out: unknown[] = [];
  for (const p of picks) {
    try {
      const msg = await fetchEmailById(userId, p.external_id!);
      const prior = existing[p.external_id!];
      out.push({
        id: p.external_id,
        subject: p.subject,
        why: prior?.why ?? p.why,
        current_body_len: (p.body ?? "").length,
        ...(prior?.expect ? { expect: prior.expect } : {}),
        payload: msg.payload,
      });
      console.log(
        `  ok   ${p.external_id}  mime=${msg.payload?.mimeType} parts=${msg.payload?.parts?.length ?? 0}  ${p.why}`
      );
    } catch (e: any) {
      console.error(`  fail ${p.external_id}: ${e.message}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(
    `\nWrote ${out.length} snapshots to ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
