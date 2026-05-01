import { ProcessorInsight } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Cross-processor compound insight rules
export function synthesizeInsights(allInsights: ProcessorInsight[]): ProcessorInsight[] {
  const compound: ProcessorInsight[] = [];

  const byType = new Map<string, ProcessorInsight[]>();
  for (const insight of allInsights) {
    const arr = byType.get(insight.insight_type) ?? [];
    arr.push(insight);
    byType.set(insight.insight_type, arr);
  }

  const overdueCommitments = byType.get("overdue_commitment") ?? [];
  const waitingForReply = byType.get("waiting_for_reply") ?? [];
  const unansweredEmails = byType.get("unanswered_email") ?? [];
  const spendingSpikes = byType.get("spending_spike") ?? [];
  const subscriptionCostSpike = byType.get("subscription_cost_spike") ?? [];
  const meetingOverload = byType.get("meeting_overload") ?? [];
  const overdueTasks = byType.get("overdue_task") ?? [];
  const coldVip = byType.get("cold_vip") ?? [];
  const negativeTrend = byType.get("negative_trend") ?? [];
  const tightTransition = byType.get("tight_transition") ?? [];
  const meetingStartingSoon = byType.get("meeting_starting_soon") ?? [];

  // Execution risk: overdue commitment + waiting_for_reply on same entity
  for (const commitment of overdueCommitments) {
    const entityId = commitment.metadata?.contactName as string | undefined;
    if (!entityId) continue;
    const relatedWaiting = waitingForReply.find((w) =>
      w.entities.some((e) => commitment.entities.includes(e))
    );
    if (relatedWaiting) {
      compound.push({
        state_key: `compound:execution_risk:${commitment.source_refs[0] ?? entityId}`,
        category: "commitments",
        insight_type: "execution_risk",
        priority_score: clamp(Math.max(commitment.priority_score, relatedWaiting.priority_score) + 0.1),
        urgency: "critical",
        title: `Execution risk: ${commitment.entities[0]}`,
        summary: `You have an overdue commitment AND an unanswered message to ${commitment.entities[0]}. This relationship is at risk.`,
        recommended_action: `Reply to ${commitment.entities[0]} and address the overdue commitment.`,
        entities: [...new Set([...commitment.entities, ...relatedWaiting.entities])],
        source_refs: [...commitment.source_refs, ...relatedWaiting.source_refs],
        confidence: 0.85,
        source_count: 2,
        generated_by: "synthesis_processor",
        explanation: `merged: overdue_commitment + waiting_for_reply for ${commitment.entities[0]}`,
        expires_at: null,
        metadata: { commitmentId: commitment.source_refs[0], emailId: relatedWaiting.source_refs[0] },
      });
    }
  }

  // Budget pressure: spending spike + subscription cost spike
  if (spendingSpikes.length > 0 && subscriptionCostSpike.length > 0) {
    const maxPriority = Math.max(
      ...spendingSpikes.map((s) => s.priority_score),
      ...subscriptionCostSpike.map((s) => s.priority_score)
    );
    compound.push({
      state_key: `compound:budget_pressure:${new Date().toISOString().slice(0, 7)}`,
      category: "finance",
      insight_type: "budget_pressure",
      priority_score: clamp(maxPriority + 0.1),
      urgency: "high",
      title: "Budget pressure this month",
      summary: `Both one-time spending spikes and recurring subscription costs are elevated this period.`,
      recommended_action: "Review your budget and identify areas to cut.",
      entities: [
        ...spendingSpikes.flatMap((s) => s.entities),
        ...subscriptionCostSpike.flatMap((s) => s.entities),
      ].slice(0, 5),
      source_refs: [],
      confidence: 0.8,
      source_count: spendingSpikes.length + subscriptionCostSpike.length,
      generated_by: "synthesis_processor",
      explanation: `${spendingSpikes.length} spending spikes + subscription cost spike`,
      expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
      metadata: { spikeMerchants: spendingSpikes.map((s) => s.entities[0]) },
    });
  }

  // Burnout risk: meeting overload + overdue tasks
  if (meetingOverload.length > 0 && overdueTasks.length >= 2) {
    compound.push({
      state_key: `compound:burnout_risk:${new Date().toISOString().slice(0, 10)}`,
      category: "scheduling",
      insight_type: "burnout_risk",
      priority_score: 0.7,
      urgency: "high",
      title: "Overloaded: heavy meetings + overdue tasks",
      summary: `You have a packed meeting schedule and ${overdueTasks.length} overdue tasks. Consider blocking time for focused work.`,
      recommended_action: "Block 2–3 hours of deep work time and address the most critical overdue tasks.",
      entities: [],
      source_refs: [],
      confidence: 0.8,
      source_count: meetingOverload.length + overdueTasks.length,
      generated_by: "synthesis_processor",
      explanation: `meeting_overload + ${overdueTasks.length} overdue tasks`,
      expires_at: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
      metadata: { overdueTaskCount: overdueTasks.length },
    });
  }

  // Relationship deteriorating: cold VIP + negative trend for same contact
  for (const vip of coldVip) {
    const neg = negativeTrend.find((n) =>
      n.entities.some((e) => vip.entities.includes(e))
    );
    if (neg) {
      compound.push({
        state_key: `compound:rel_deteriorating:${vip.source_refs[0]}`,
        category: "relationship",
        insight_type: "relationship_deteriorating",
        priority_score: clamp(Math.max(vip.priority_score, neg.priority_score) + 0.1),
        urgency: "high",
        title: `Relationship deteriorating: ${vip.entities[0]}`,
        summary: `${vip.entities[0]} is both a cold VIP contact and showing a negative communication trend. This relationship needs immediate attention.`,
        recommended_action: `Reach out to ${vip.entities[0]} proactively with a positive touchpoint.`,
        entities: vip.entities,
        source_refs: [...vip.source_refs, ...neg.source_refs],
        confidence: 0.8,
        source_count: 2,
        generated_by: "synthesis_processor",
        explanation: `cold_vip + negative_trend for ${vip.entities[0]}`,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
        metadata: { contactId: vip.source_refs[0] },
      });
    }
  }

  // Critical travel risk: tight transition + meeting starting soon
  for (const tight of tightTransition) {
    const soonMeeting = meetingStartingSoon.find((m) =>
      tight.source_refs.some((r) => m.source_refs.includes(r))
    );
    if (soonMeeting) {
      compound.push({
        state_key: `compound:travel_risk:${tight.source_refs[1] ?? tight.state_key}`,
        category: "scheduling",
        insight_type: "critical_schedule_risk",
        priority_score: 0.9,
        urgency: "critical",
        title: `Critical: back-to-back + starting soon`,
        summary: `"${tight.metadata?.nextMeeting}" is starting in minutes with only ${tight.metadata?.gapMinutes} minutes since your last meeting.`,
        recommended_action: "Wrap up current meeting immediately.",
        entities: tight.entities,
        source_refs: [...tight.source_refs, ...soonMeeting.source_refs],
        confidence: 0.95,
        source_count: 2,
        generated_by: "synthesis_processor",
        explanation: `tight_transition + meeting_starting_soon`,
        expires_at: soonMeeting.expires_at,
        metadata: { ...tight.metadata },
      });
    }
  }

  return compound;
}
