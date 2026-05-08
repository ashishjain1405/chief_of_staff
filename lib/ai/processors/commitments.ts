import { differenceInDays, isBefore, addDays } from "date-fns";
import { ProcessorInsight, RawCommitment } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function processCommitments(commitments: RawCommitment[]): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();
  const in3Days = addDays(now, 3);
  const in14Days = addDays(now, 14);

  for (const commitment of commitments) {
    const contactName =
      commitment.contacts?.name ?? commitment.contacts?.email ?? null;
    const isOverdue =
      commitment.status?.toLowerCase() === "overdue" ||
      (commitment.due_date != null && isBefore(new Date(commitment.due_date), now) && commitment.status?.toLowerCase() !== "done");

    if (isOverdue) {
      const daysOverdue = commitment.due_date
        ? differenceInDays(now, new Date(commitment.due_date))
        : 1;

      insights.push({
        state_key: `commitment:overdue:${commitment.id}`,
        category: "commitments",
        insight_type: "overdue_commitment",
        priority_score: clamp(0.6 + Math.min(daysOverdue / 21, 0.3)),
        urgency: daysOverdue >= 7 ? "critical" : "high",
        title: `Overdue commitment: ${commitment.description.slice(0, 60)}`,
        summary: contactName
          ? `You committed to "${commitment.description}" for ${contactName}, ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} ago.`
          : `Commitment "${commitment.description}" is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue.`,
        recommended_action: contactName
          ? `Complete or communicate a delay to ${contactName}.`
          : "Complete or update the status of this commitment.",
        entities: [commitment.description.slice(0, 40), contactName].filter(Boolean) as string[],
        source_refs: [commitment.id],
        confidence: 1,
        source_count: 1,
        generated_by: "commitment_processor",
        explanation: `status=${commitment.status}, due_date=${commitment.due_date}, daysOverdue=${daysOverdue}`,
        expires_at: null,
        metadata: { daysOverdue, contactName, dueDate: commitment.due_date },
      });
      continue;
    }

    // At-risk: due soon with no linked progress
    if (commitment.due_date && isBefore(new Date(commitment.due_date), in3Days)) {
      const daysUntil = differenceInDays(new Date(commitment.due_date), now);

      insights.push({
        state_key: `commitment:at_risk:${commitment.id}`,
        category: "commitments",
        insight_type: "commitment_at_risk",
        priority_score: clamp(0.5 + (3 - daysUntil) * 0.1),
        urgency: daysUntil <= 1 ? "high" : "medium",
        title: `Commitment due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}: ${commitment.description.slice(0, 50)}`,
        summary: contactName
          ? `"${commitment.description}" for ${contactName} is due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}.`
          : `"${commitment.description}" is due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}.`,
        recommended_action: "Complete or confirm progress on this commitment.",
        entities: [commitment.description.slice(0, 40), contactName].filter(Boolean) as string[],
        source_refs: [commitment.id],
        confidence: 0.95,
        source_count: 1,
        generated_by: "commitment_processor",
        explanation: `due_date=${commitment.due_date}, daysUntil=${daysUntil}`,
        expires_at: commitment.due_date,
        metadata: { daysUntil, contactName, dueDate: commitment.due_date },
      });
    }
  }

  return insights;
}
