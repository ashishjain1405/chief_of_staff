import { differenceInDays, isToday, isBefore, addDays } from "date-fns";
import { ProcessorInsight, RawTask } from "./types";

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const PRIORITY_WEIGHT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };

export function processTasks(tasks: RawTask[]): ProcessorInsight[] {
  const insights: ProcessorInsight[] = [];
  const now = new Date();

  const overdueTasks = tasks.filter(
    (t) => t.due_date && isBefore(new Date(t.due_date), now) && t.status?.toLowerCase() !== "done"
  );
  const highPriorityPending = tasks.filter(
    (t) => t.priority?.toLowerCase() === "high" && t.status?.toLowerCase() === "pending"
  );

  // Overdue task overload signal
  if (overdueTasks.length >= 3) {
    insights.push({
      state_key: `task:overload:overdue`,
      category: "productivity",
      insight_type: "task_overload",
      priority_score: clamp(0.5 + overdueTasks.length * 0.05),
      urgency: "high",
      title: `${overdueTasks.length} overdue tasks`,
      summary: `You have ${overdueTasks.length} tasks past their due date. Immediate attention needed.`,
      recommended_action: "Review and either complete, reschedule, or dismiss overdue tasks.",
      entities: overdueTasks.map((t) => t.title).slice(0, 3),
      source_refs: overdueTasks.map((t) => t.id),
      confidence: 1,
      source_count: overdueTasks.length,
      generated_by: "task_processor",
      explanation: `${overdueTasks.length} tasks with due_date < now and status != done`,
      expires_at: null,
      metadata: { overdueCount: overdueTasks.length },
    });
  }

  // High priority overload
  if (highPriorityPending.length > 5) {
    insights.push({
      state_key: `task:overload:high_priority`,
      category: "productivity",
      insight_type: "task_overload",
      priority_score: 0.65,
      urgency: "high",
      title: `${highPriorityPending.length} high-priority tasks pending`,
      summary: `You have ${highPriorityPending.length} high-priority tasks open. Consider re-prioritizing.`,
      recommended_action: "Delegate or reschedule lower-priority items.",
      entities: highPriorityPending.map((t) => t.title).slice(0, 3),
      source_refs: highPriorityPending.map((t) => t.id),
      confidence: 1,
      source_count: highPriorityPending.length,
      generated_by: "task_processor",
      explanation: `${highPriorityPending.length} high-priority pending tasks > threshold of 5`,
      expires_at: new Date(Date.now() + 3 * 864e5).toISOString(),
      metadata: { count: highPriorityPending.length },
    });
  }

  // Individual overdue tasks
  for (const task of overdueTasks) {
    const dueDate = new Date(task.due_date!);
    const daysOverdue = differenceInDays(now, dueDate);
    const priorityWeight = PRIORITY_WEIGHT[task.priority ?? "low"] ?? 0.3;

    const priorityScore = clamp(
      1.0 * 0.4 +
      Math.min(1, daysOverdue / 14) * 0.3 +
      priorityWeight * 0.3
    );

    insights.push({
      state_key: `task:overdue:${task.id}`,
      category: "productivity",
      insight_type: "overdue_task",
      priority_score: priorityScore,
      urgency: daysOverdue >= 7 ? "critical" : daysOverdue >= 3 ? "high" : "medium",
      title: `Overdue: ${task.title}`,
      summary: `"${task.title}" was due ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} ago.`,
      recommended_action: "Complete, reschedule, or dismiss this task.",
      entities: [task.title],
      source_refs: [task.id],
      confidence: 1,
      source_count: 1,
      generated_by: "task_processor",
      explanation: `due_date=${task.due_date}, daysOverdue=${daysOverdue}, priority=${task.priority}`,
      expires_at: null,
      metadata: { daysOverdue, priority: task.priority },
    });
  }

  // Stale pending tasks (not updated in 14+ days)
  for (const task of tasks) {
    if (task.status !== "pending" || !task.updated_at) continue;
    const daysSinceUpdate = differenceInDays(now, new Date(task.updated_at));
    if (daysSinceUpdate >= 14) {
      insights.push({
        state_key: `task:stale:${task.id}`,
        category: "productivity",
        insight_type: "stale_task",
        priority_score: 0.4,
        urgency: "low",
        title: `Stale task: ${task.title}`,
        summary: `"${task.title}" has had no updates in ${daysSinceUpdate} days.`,
        recommended_action: "Review if this task is still relevant.",
        entities: [task.title],
        source_refs: [task.id],
        confidence: 0.9,
        source_count: 1,
        generated_by: "task_processor",
        explanation: `last updated ${daysSinceUpdate} days ago`,
        expires_at: new Date(Date.now() + 14 * 864e5).toISOString(),
        metadata: { daysSinceUpdate },
      });
    }
  }

  return insights;
}
