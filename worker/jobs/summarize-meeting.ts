import { Job } from "bullmq";
import { createClient } from "@supabase/supabase-js";
import { summarizeMeeting } from "@/lib/ai/claude";
import { embedAndStoreChunks, updateMeetingEmbedding } from "@/lib/memory/embed";
import { operationalQueue } from "@/lib/queues";

export async function processMeetingSummary(job: Job) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { meetingId, userId } = job.data;

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .single();

  if (!meeting || !meeting.transcript || meeting.transcript_summary) return;

  const { data: user } = await supabase
    .from("users")
    .select("business_context")
    .eq("id", userId)
    .single();

  const attendeeList = (meeting.attendees as any[])
    ?.map((a: any) => a.name ?? a.email)
    .join(", ") ?? "";

  const summary = await summarizeMeeting(
    meeting.title ?? "Meeting",
    attendeeList,
    meeting.transcript,
    user?.business_context ?? {}
  );

  // Update meeting with summary
  await supabase
    .from("meetings")
    .update({
      transcript_summary: summary.executive_summary,
      action_items: summary.action_items,
      decisions: summary.key_decisions,
      follow_ups_generated: true,
    })
    .eq("id", meetingId);

  // Create tasks from action items
  for (const item of summary.action_items) {
    const ownerIsFounder =
      item.owner.toLowerCase().includes("me") ||
      item.owner.toLowerCase().includes("i ") ||
      item.owner === "";

    if (!ownerIsFounder) continue;

    await supabase.from("tasks").insert({
      user_id: userId,
      title: item.description,
      source_type: "meeting",
      source_id: meetingId,
      due_date: item.due_date,
      priority: "medium",
      ai_reasoning: `Extracted from meeting: ${meeting.title}`,
    });
  }

  // Create commitments
  for (const c of summary.commitments) {
    if (c.confidence < 0.6) continue;

    await supabase.from("commitments").insert({
      user_id: userId,
      description: c.description,
      source_type: "meeting",
      source_id: meetingId,
      due_date: c.due_date,
      extracted_by: "ai",
      ai_confidence: c.confidence,
    });
  }

  // Embed meeting summary
  const textToEmbed = [
    summary.executive_summary,
    summary.key_decisions.map((d) => d.description).join(". "),
    summary.action_items.map((a) => a.description).join(". "),
  ]
    .filter(Boolean)
    .join("\n\n");

  await embedAndStoreChunks({
    userId,
    sourceType: "meeting",
    sourceId: meetingId,
    text: `${meeting.title}\n\n${textToEmbed}`,
    metadata: { occurred_at: meeting.start_time, attendees: attendeeList },
  });

  await updateMeetingEmbedding(meetingId, textToEmbed);

  await operationalQueue.add("compute-operational-state", { userId }, { delay: 30000, jobId: `ops-${userId}`, deduplication: { id: `ops-${userId}` } });
}
