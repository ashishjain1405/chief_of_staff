import { Job } from "bullmq";
import { appUrl } from "@/lib/utils";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDailyBrief } from "@/lib/ai/claude";
import { searchMemory, getStructuredContext } from "@/lib/memory/search";
import { dailyBriefPrompt } from "@/lib/ai/prompts";
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

  const structured = await getStructuredContext(userId);

  // Get relevant memory for context
  const memoryChunks = await searchMemory({
    userId,
    query: "priorities tasks follow-ups commitments",
    matchCount: 10,
    daysBack: 7,
    matchThreshold: 0.6,
  });

  const prompt = dailyBriefPrompt({
    ...structured,
    businessContext: user.business_context ?? {},
    relevantMemory: memoryChunks.map((c) => c.chunk_text),
  });

  const briefMarkdown = await generateDailyBrief(prompt);

  const today = new Date().toISOString().split("T")[0];

  // Save to database
  await supabase.from("daily_briefs").upsert(
    {
      user_id: userId,
      brief_date: today,
      raw_markdown: briefMarkdown,
      content: {
        top_priorities: structured.pendingTasks.slice(0, 3),
        follow_ups: structured.overdueFollowUps,
        meetings_today: structured.upcomingMeetings,
        commitments_due: structured.overdueCommitments,
      },
    },
    { onConflict: "user_id,brief_date" }
  );

  // Saved first, so the brief is on the dashboard even if sending fails.
  // Sent from the user's own Gmail through the existing gmail.send grant rather
  // than a separate email provider: no extra account, key or sender domain for
  // one message a day. Self-sent mail carries the SENT label, which the push
  // webhook skips, so the brief does not come back in as an inbox email.
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Kolkata",
  });
  try {
    await sendEmail(userId, {
      to: user.email,
      // ASCII only: sendEmail writes headers raw, without RFC 2047 encoding.
      subject: `Your Daily Brief - ${dateLabel}`,
      body: `${briefMarkdown}\n\nOpen the dashboard: ${appUrl("/dashboard")}`,
    });
  } catch (err) {
    console.error(`[daily-brief] ${userId}: saved; email failed:`, (err as Error).message);
    return;
  }
  await supabase
    .from("daily_briefs")
    .update({ delivered_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("brief_date", today);
  console.log(`[daily-brief] ${userId}: saved and emailed`);
}
