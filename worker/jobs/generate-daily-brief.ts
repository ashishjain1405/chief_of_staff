import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { generateDailyBrief } from "@/lib/ai/claude";
import { searchMemory, getStructuredContext } from "@/lib/memory/search";
import { dailyBriefPrompt } from "@/lib/ai/prompts";
import { Resend } from "resend";


export async function generateAndDeliverDailyBrief(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const { userId } = job.data;

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
      delivered_at: new Date().toISOString(),
    },
    { onConflict: "user_id,brief_date" }
  );

  // Send email via Resend
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: user.email,
    subject: `Your Daily Brief — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`,
    text: briefMarkdown,
    html: `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a1a">Good morning, ${user.full_name?.split(" ")[0] ?? "there"} 👋</h2>
      <div style="white-space:pre-wrap;line-height:1.6">${briefMarkdown.replace(/\n/g, "<br>")}</div>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color:#6366f1">Open Dashboard →</a>
    </div>`,
  });
}
