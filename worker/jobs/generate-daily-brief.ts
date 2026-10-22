import { Job } from "bullmq";
import { appUrl } from "@/lib/utils";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { gatherBriefData } from "@/lib/brief/data";
import { buildBrief } from "@/lib/brief/build";
import { briefSubject, renderHtml, renderMarkdown, renderText } from "@/lib/brief/render";
import { sendEmail } from "@/lib/integrations/gmail";


// The scheduled run carries no userId and briefs every onboarded user; a job
// with a userId briefs just that user.
export async function generateAndDeliverDailyBrief(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  if (job.data?.userId) return briefUser(supabase, job.data.userId);

  const { data: users, error } = await supabase.from("users").select("id").eq("onboarding_complete", true);
  if (error) throw error;
  for (const { id } of users ?? []) {
    try {
      await briefUser(supabase, id);
    } catch (err) {
      console.error(`[daily-brief] ${id} failed:`, (err as Error).message);
    }
  }
}

async function briefUser(supabase: SupabaseClient, userId: string) {

  const { data: user } = await supabase
    .from("users")
    .select("email, business_context")
    .eq("id", userId)
    .single();

  if (!user) return;

  const brief = await buildBrief(await gatherBriefData(supabase, userId, user.business_context ?? {}));

  // content holds the structured brief, whose keys tomorrow's brief compares
  // against for "New" and "done since yesterday"; raw_markdown feeds the
  // dashboard card. brief_date is the IST day, not the UTC one.
  await supabase.from("daily_briefs").upsert(
    { user_id: userId, brief_date: brief.date, raw_markdown: renderMarkdown(brief), content: brief },
    { onConflict: "user_id,brief_date" }
  );

  // Saved first, so the brief is on the dashboard even if sending fails.
  // Sent from the user's own Gmail through the existing gmail.send grant rather
  // than a separate email provider: no extra account, key or sender domain for
  // one message a day. Self-sent mail carries the SENT label, which the push
  // webhook skips, so the brief does not come back in as an inbox email.
  try {
    await sendEmail(userId, {
      to: user.email,
      subject: briefSubject(brief),
      body: renderText(brief, appUrl),
      html: renderHtml(brief, appUrl),
    });
  } catch (err) {
    console.error(`[daily-brief] ${userId}: saved; email failed:`, (err as Error).message);
    return;
  }
  await supabase
    .from("daily_briefs")
    .update({ delivered_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("brief_date", brief.date);
  console.log(`[daily-brief] ${userId}: saved and emailed`);
}
