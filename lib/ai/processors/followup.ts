import { differenceInDays, isBefore } from "date-fns";
import { ProcessorInsight, RawCommunication, RawContact, RawRelationship } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function processFollowUps(
  relationships: RawRelationship[],
  communications: RawCommunication[],
  contacts: RawContact[],
): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();

  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  // Overdue follow-ups from relationships table
  for (const rel of relationships) {
    if (!rel.follow_up_due) continue;
    if (!isBefore(new Date(rel.follow_up_due), now)) continue;

    const contact = rel.contacts;
    const contactName = contact?.name ?? contact?.email ?? "Unknown";
    const daysOverdue = differenceInDays(now, new Date(rel.follow_up_due));
    const importanceBoost = 0;

    const priorityScore = clamp(
      0.5 +
      Math.min(daysOverdue / 30, 0.3) +
      importanceBoost
    );

    insights.push({
      state_key: `followup:missed:${rel.id}`,
      category: "relationship",
      insight_type: "missed_followup",
      priority_score: priorityScore,
      urgency: daysOverdue >= 14 ? "high" : "medium",
      title: `Follow up with ${contactName}`,
      summary: `Scheduled follow-up with ${contactName} (${rel.category}) was due ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} ago.`,
      recommended_action: `Send a message or email to ${contactName}.`,
      entities: [contactName],
      source_refs: [rel.id],
      confidence: 1,
      source_count: 1,
      generated_by: "followup_processor",
      explanation: `follow_up_due=${rel.follow_up_due}, daysOverdue=${daysOverdue}`,
      expires_at: null,
      metadata: { daysOverdue, category: rel.category, contactId: contact?.id },
    });
  }

  // Unanswered important emails (requires_action=true, not action_taken, older than 3 days)
  for (const comm of communications) {
    if (!comm.requires_action || comm.action_taken) continue;
    const ageDays = differenceInDays(now, new Date(comm.occurred_at));
    if (ageDays < 3) continue;

    const contactName = comm.contacts?.name ?? comm.contacts?.email ?? "Unknown";
    const sentimentBoost = comm.sentiment === "negative" ? 0.2 : 0;
    const ageBoost = clamp(ageDays / 30) * 0.2;

    const priorityScore = clamp(0.4 + sentimentBoost + ageBoost);

    insights.push({
      state_key: `followup:unanswered:${comm.id}`,
      category: "relationship",
      insight_type: "unanswered_email",
      priority_score: priorityScore,
      urgency: ageDays >= 7 ? "high" : "medium",
      title: `Unanswered email from ${contactName}`,
      summary: `"${comm.subject ?? "(no subject)"}" from ${contactName} has been unanswered for ${ageDays} day${ageDays !== 1 ? "s" : ""}.`,
      recommended_action: "Reply or take the required action.",
      entities: [contactName, comm.subject ?? ""].filter(Boolean),
      source_refs: [comm.id],
      confidence: 0.9,
      source_count: 1,
      generated_by: "followup_processor",
      explanation: `requires_action=true, action_taken=false, age=${ageDays}d, sentiment=${comm.sentiment}`,
      expires_at: null,
      metadata: { ageDays, sentiment: comm.sentiment, subject: comm.subject },
    });
  }

  // Stale high-importance contacts (no interaction > 30 days)
  for (const contact of contacts) {
    if (!contact.importance_score || contact.importance_score < 0.7) continue;
    if (!contact.last_interaction_at) continue;
    const daysSince = differenceInDays(now, new Date(contact.last_interaction_at));
    if (daysSince < 30) continue;

    insights.push({
      state_key: `followup:stale_contact:${contact.id}`,
      category: "relationship",
      insight_type: "stale_relationship",
      priority_score: clamp(contact.importance_score * 0.6 + Math.min(daysSince / 90, 0.4)),
      urgency: daysSince >= 60 ? "high" : "medium",
      title: `Reconnect with ${contact.name ?? contact.email}`,
      summary: `You haven't interacted with ${contact.name ?? contact.email} in ${daysSince} days. They are a high-importance contact.`,
      recommended_action: "Send a brief check-in message.",
      entities: [contact.name ?? contact.email ?? "Unknown"],
      source_refs: [contact.id],
      confidence: 0.85,
      source_count: 1,
      generated_by: "followup_processor",
      explanation: `importance_score=${contact.importance_score}, daysSinceInteraction=${daysSince}`,
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
      metadata: { daysSince, importanceScore: contact.importance_score },
    });
  }

  return insights;
}
