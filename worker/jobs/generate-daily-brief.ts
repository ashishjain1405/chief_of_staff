import { Job } from "bullmq";
import { appUrl } from "@/lib/utils";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateDailyBrief } from "@/lib/ai/claude";
import { searchMemory, getStructuredContext } from "@/lib/memory/search";
import { dailyBriefPrompt } from "@/lib/ai/prompts";
import { Resend } from "resend";


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
    .select("email, full_name, business_context")
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

  // Saved first, so the brief is on the dashboard even without email. Resend
  // threw at construction when its key was missing, which would have aborted
  // the whole brief; it is optional now.
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.log(`[daily-brief] ${userId}: saved; email skipped (Resend not configured)`);
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: user.email,
    subject: `Your Daily Brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`,
    text: briefMarkdown,
    html: `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a">Good morning, ${user.full_name?.split(" ")[0] ?? "there"} 👋</h2>
      <div style="white-space:pre-wrap;line-height:1.6">${briefMarkdown.replace(/\n/g, "<br>")}</div>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <a href="${appUrl("/dashboard")}" style="color:#6366f1">Open Dashboard →</a>
        </div>`,
  });
  await supabase
    .from("daily_briefs")
    .update({ delivered_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("brief_date", today);
  console.log(`[daily-brief] ${userId}: saved and emailed`);
}
