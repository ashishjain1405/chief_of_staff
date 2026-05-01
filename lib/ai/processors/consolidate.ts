import { ProcessorInsight } from "./types";

// Merge insights that reference the same primary entity from different processors.
// Keeps highest-confidence version as primary; appends supporting signals.
export function consolidateInsights(insights: ProcessorInsight[]): ProcessorInsight[] {
  // Deduplicate by state_key first
  const byKey = new Map<string, ProcessorInsight>();
  for (const insight of insights) {
    const existing = byKey.get(insight.state_key);
    if (!existing || insight.priority_score > existing.priority_score) {
      byKey.set(insight.state_key, insight);
    }
  }

  const deduped = [...byKey.values()];

  // Group by primary entity (entities[0]) across different processors
  const byEntity = new Map<string, ProcessorInsight[]>();
  for (const insight of deduped) {
    const primaryEntity = insight.entities[0];
    if (!primaryEntity) continue;
    const arr = byEntity.get(primaryEntity) ?? [];
    arr.push(insight);
    byEntity.set(primaryEntity, arr);
  }

  const result: ProcessorInsight[] = [];
  const merged = new Set<string>();

  for (const [entity, group] of byEntity) {
    // Only merge if 2+ different processors produced insights for same entity
    const processors = new Set(group.map((g) => g.generated_by));
    if (processors.size < 2) {
      for (const g of group) result.push(g);
      continue;
    }

    // Sort by priority desc — primary is highest
    const sorted = [...group].sort((a, b) => b.priority_score - a.priority_score);
    const primary = sorted[0];
    const supporting = sorted.slice(1);

    if (supporting.length === 0) {
      result.push(primary);
      continue;
    }

    const mergedInsight: ProcessorInsight = {
      ...primary,
      summary: primary.summary + " " + supporting.map((s) => s.summary).join(" "),
      source_refs: [...new Set([...primary.source_refs, ...supporting.flatMap((s) => s.source_refs)])],
      source_count: group.reduce((sum, g) => sum + g.source_count, 0),
      generated_by: [...processors].join("+"),
      explanation: [primary.explanation, ...supporting.map((s) => s.explanation)].join("; "),
      entities: [...new Set(group.flatMap((g) => g.entities))],
    };

    result.push(mergedInsight);
    for (const s of supporting) merged.add(s.state_key);
  }

  // Add insights with no entity that weren't merged
  for (const insight of deduped) {
    if (!insight.entities[0] && !merged.has(insight.state_key)) {
      result.push(insight);
    }
  }

  return result;
}
