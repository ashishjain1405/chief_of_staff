import { isToday, differenceInMinutes, format } from "date-fns";
import { ProcessorInsight, RawMeeting } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function meetingLabel(m: RawMeeting): string {
  return `${m.title} at ${format(new Date(m.start_time), "h:mm a")}`;
}

export function processScheduling(meetings: RawMeeting[]): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();

  const upcoming = meetings
    .filter((m) => new Date(m.start_time) >= now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const todaysMeetings = upcoming.filter((m) => isToday(new Date(m.start_time)));

  // Meeting overload (4+ meetings in a day)
  if (todaysMeetings.length >= 4) {
    insights.push({
      state_key: `scheduling:overload:${format(now, "yyyy-MM-dd")}`,
      category: "scheduling",
      insight_type: "meeting_overload",
      priority_score: clamp(0.5 + todaysMeetings.length * 0.05),
      urgency: todaysMeetings.length >= 6 ? "high" : "medium",
      title: `Heavy meeting day: ${todaysMeetings.length} meetings today`,
      summary: `You have ${todaysMeetings.length} meetings scheduled today, which may limit deep work time.`,
      recommended_action: "Consider declining or rescheduling non-essential meetings.",
      entities: todaysMeetings.map((m) => m.title).slice(0, 3),
      source_refs: todaysMeetings.map((m) => m.id),
      confidence: 1,
      source_count: todaysMeetings.length,
      generated_by: "scheduling_processor",
      explanation: `${todaysMeetings.length} meetings today >= threshold of 4`,
      expires_at: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
      metadata: { meetingCount: todaysMeetings.length, date: format(now, "yyyy-MM-dd") },
    });
  }

  // Tight transitions (< 10 min gap between consecutive meetings)
  for (let i = 0; i < upcoming.length - 1; i++) {
    const current = upcoming[i];
    const next = upcoming[i + 1];
    if (!current.end_time) continue;

    const gapMinutes = differenceInMinutes(
      new Date(next.start_time),
      new Date(current.end_time)
    );

    if (gapMinutes >= 0 && gapMinutes < 10) {
      insights.push({
        state_key: `scheduling:tight:${next.id}`,
        category: "scheduling",
        insight_type: "tight_transition",
        priority_score: 0.55,
        urgency: "medium",
        title: `Back-to-back: ${current.title} → ${next.title}`,
        summary: `Only ${gapMinutes} minute${gapMinutes !== 1 ? "s" : ""} between "${current.title}" and "${next.title}". You may need to end the first meeting early.`,
        recommended_action: "Plan to leave the first meeting on time.",
        entities: [current.title, next.title],
        source_refs: [current.id, next.id],
        confidence: 1,
        source_count: 2,
        generated_by: "scheduling_processor",
        explanation: `gap=${gapMinutes}min between ${current.end_time} and ${next.start_time}`,
        expires_at: next.start_time,
        metadata: { gapMinutes, currentMeeting: current.title, nextMeeting: next.title },
      });
    }
  }

  // Meeting starting very soon (< 30 min, no prep time flagged)
  for (const meeting of upcoming) {
    const minutesUntil = differenceInMinutes(new Date(meeting.start_time), now);
    if (minutesUntil > 0 && minutesUntil <= 30) {
      const attendeeCount = meeting.attendees?.length ?? 0;
      insights.push({
        state_key: `scheduling:starting_soon:${meeting.id}`,
        category: "scheduling",
        insight_type: "meeting_starting_soon",
        priority_score: clamp(1 - minutesUntil / 30),
        urgency: minutesUntil <= 10 ? "critical" : "high",
        title: `Starting in ${minutesUntil} min: ${meeting.title}`,
        summary: `"${meeting.title}" starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}${attendeeCount > 0 ? ` with ${attendeeCount} attendee${attendeeCount !== 1 ? "s" : ""}` : ""}.`,
        recommended_action: "Prepare and join the meeting.",
        entities: [meeting.title],
        source_refs: [meeting.id],
        confidence: 1,
        source_count: 1,
        generated_by: "scheduling_processor",
        explanation: `starts at ${meeting.start_time}, minutesUntil=${minutesUntil}`,
        expires_at: meeting.start_time,
        metadata: { minutesUntil, attendeeCount },
      });
    }
  }

  return insights;
}
