import { createClient } from "@supabase/supabase-js";
import { fetchEmailById, parseEmailBody } from "@/lib/integrations/gmail";

// Re-parses a sample of already-stored emails with the current parser and
// compares against what is in the database, so the effect of a parser change is
// measured on real mail rather than inferred from a handful of fixtures.
//
//   npm run measure:parsing -- --limit=40

const CSS = /@media|font-family|!important|-webkit-|text-size-adjust/i;
const limitArg = process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1];
const LIMIT = parseInt(limitArg ?? "40", 10);

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integ } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "google")
    .eq("is_active", true)
    .gt("metadata->>watch_expires_at", new Date().toISOString())
    .limit(1);
  const userId = integ?.[0]?.user_id;
  if (!userId) throw new Error("No account with a live Gmail watch");

  const { data: rows } = await supabase
    .from("communications")
    .select("external_id, subject, body")
    .eq("user_id", userId)
    .eq("source", "gmail")
    .not("external_id", "is", null)
    .limit(600);

  const affected = (rows ?? []).filter((r) => r.body && CSS.test(r.body.slice(0, 300)));
  const sample = affected.slice(0, LIMIT);

  console.log(`Re-parsing ${sample.length} emails whose stored body starts with CSS\n`);

  let cleanNow = 0;
  let stillDirty = 0;
  let lostContent = 0;
  let charsBefore = 0;
  let charsAfter = 0;

  for (const r of sample) {
    let parsed: string;
    try {
      const msg = await fetchEmailById(userId, r.external_id!);
      parsed = parseEmailBody(msg.payload);
    } catch (e: any) {
      console.error(`  fetch failed ${r.external_id}: ${e.message}`);
      continue;
    }

    const before = (r.body ?? "").length;
    const after = parsed.length;
    charsBefore += before;
    charsAfter += after;

    const dirty = CSS.test(parsed.slice(0, 300));
    if (dirty) stillDirty++;
    else cleanNow++;
    // Losing most of the text would be a regression even if the result is clean.
    if (after < before * 0.25) lostContent++;

    await new Promise((res) => setTimeout(res, 120));
  }

  const n = cleanNow + stillDirty;
  console.log(`clean after fix : ${cleanNow}/${n} (${((100 * cleanNow) / Math.max(n, 1)).toFixed(0)}%)`);
  console.log(`still has CSS   : ${stillDirty}/${n}`);
  console.log(`lost >75% chars : ${lostContent}/${n}`);
  console.log(`avg body chars  : ${Math.round(charsBefore / Math.max(n, 1))} -> ${Math.round(charsAfter / Math.max(n, 1))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
