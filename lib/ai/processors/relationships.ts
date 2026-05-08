import { differenceInDays } from "date-fns";
import { ProcessorInsight, RawContact, RawCommunication, RawRelationship } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function processRelationships(
  relationships: RawRelationship[],
  contacts: RawContact[],
  communications: RawCommunication[],
): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();

  // Build last-communication map per contact
  const lastCommByContact = new Map<string, RawCommunication[]>();
  for (const comm of communications) {
    if (!comm.contact_id) continue;
    const arr = lastCommByContact.get(comm.contact_id) ?? [];
    arr.push(comm);
    lastCommByContact.set(comm.contact_id, arr);
  }

  // Cold VIP contacts: high importance, low health or no recent interaction
  for (const contact of contacts) {
    if (!contact.importance_score || contact.importance_score < 0.7) continue;

    const daysSince = contact.last_interaction_at
      ? differenceInDays(now, new Date(contact.last_interaction_at))
      : 999;

    if (daysSince < 45) continue;

    const rel = relationships.find((r) => r.contacts?.id === contact.id);
    const healthScore = rel?.health_score ?? null;

    insights.push({
      state_key: `relationship:cold_vip:${contact.id}`,
      category: "relationship",
      insight_type: "cold_vip",
      priority_score: clamp(contact.importance_score * 0.6 + Math.min(daysSince / 120, 0.4)),
      urgency: daysSince >= 90 ? "high" : "medium",
      title: `Reconnect with ${contact.name ?? contact.email}`,
      summary: `${contact.name ?? contact.email} is a high-importance contact you haven't interacted with in ${daysSince} days${healthScore != null ? ` (relationship health: ${(healthScore * 100).toFixed(0)}%)` : ""}.`,
      recommended_action: "Send a check-in message or schedule a call.",
      entities: [contact.name ?? contact.email ?? "Unknown"],
      source_refs: [contact.id],
      confidence: 0.85,
      source_count: 1,
      generated_by: "relationship_processor",
      explanation: `importance=${contact.importance_score}, daysSinceInteraction=${daysSince}, health=${healthScore}`,
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
      metadata: { daysSince, importanceScore: contact.importance_score, healthScore },
    });
  }

  // Waiting for reply: they sent email, user hasn't responded in 5+ days
  for (const comm of communications) {
    if (!comm.requires_action || comm.action_taken) continue;
    const ageDays = differenceInDays(now, new Date(comm.occurred_at));
    if (ageDays < 5) continue;

    const contactName = comm.contacts?.name ?? comm.contacts?.email ?? "Unknown";

    insights.push({
      state_key: `relationship:waiting_for_reply:${comm.id}`,
      category: "relationship",
      insight_type: "waiting_for_reply",
      priority_score: clamp(0.45 + Math.min(ageDays / 30, 0.35)),
      urgency: ageDays >= 10 ? "high" : "medium",
      title: `${contactName} is waiting for your reply`,
      summary: `"${comm.subject ?? "(no subject)"}" from ${contactName} has been waiting ${ageDays} days for a response.`,
      recommended_action: "Reply to this email.",
      entities: [contactName],
      source_refs: [comm.id],
      confidence: 0.85,
      source_count: 1,
      generated_by: "relationship_processor",
      explanation: `requires_action=true, action_taken=false, ageDays=${ageDays}`,
      expires_at: null,
      metadata: { ageDays, subject: comm.subject },
    });
  }

  // Negative sentiment trend: 2+ recent negative emails from same contact
  const negativeBySender = new Map<string, RawCommunication[]>();
  for (const comm of communications) {
    if (comm.sentiment?.toLowerCase() !== "negative" || !comm.contact_id) continue;
    const arr = negativeBySender.get(comm.contact_id) ?? [];
    arr.push(comm);
    negativeBySender.set(comm.contact_id, arr);
  }
  for (const [contactId, negComms] of negativeBySender) {
    if (negComms.length < 2) continue;
    const contact = contacts.find((c) => c.id === contactId);
    const name = contact?.name ?? contact?.email ?? "Unknown";

    insights.push({
      state_key: `relationship:negative_trend:${contactId}`,
      category: "relationship",
      insight_type: "negative_trend",
      priority_score: clamp(0.55 + negComms.length * 0.05),
      urgency: "high",
      title: `Negative trend with ${name}`,
      summary: `${negComms.length} recent emails from ${name} have a negative sentiment. This relationship may need attention.`,
      recommended_action: "Address the underlying concerns proactively.",
      entities: [name],
      source_refs: negComms.map((c) => c.id),
      confidence: 0.75,
      source_count: negComms.length,
      generated_by: "relationship_processor",
      explanation: `${negComms.length} consecutive negative-sentiment communications`,
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
      metadata: { negativeCount: negComms.length },
    });
  }

  return insights;
}
