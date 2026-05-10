import type { RetrievalTrace, RetrievalStep, RetrievalItem, RetrievalWeights, EntityContext, TemporalAnchor } from "./types";
import type { IntentResult } from "../intent/classify";

export function buildTrace(
  query: string,
  intent: IntentResult,
  plan: RetrievalStep[],
  sourceStatuses: { source: string; count: number; success: boolean }[],
  rankedItems: RetrievalItem[],
  startTime: number,
  budgetExhausted: boolean
): RetrievalTrace {
  return {
    query,
    intent: `${intent.primary}${intent.secondary.length > 0 ? `+${intent.secondary.join("+")}` : ""}`,
    retrieval_weights: intent.retrieval_weights,
    entities: intent.entities,
    temporal: intent.temporal,
    retrieval_plan: plan,
    retrieved_sources: sourceStatuses,
    top_ranked_items: rankedItems.slice(0, 5).map((item) => ({
      source: item.source,
      score: Math.round(item.retrieval_score * 100) / 100,
      title: getItemTitle(item),
      snippet: getItemSnippet(item),
    })),
    total_latency_ms: Date.now() - startTime,
    budget_exhausted: budgetExhausted,
  };
}

function getItemSnippet(item: RetrievalItem): string | undefined {
  switch (item.item_type) {
    case "communication": return item.data.body_summary ?? undefined;
    case "insight": return item.data.summary;
    case "transaction": return `${item.data.transaction_type} ${item.data.currency} ${item.data.amount} on ${item.data.transaction_datetime?.slice(0, 10)}`;
    case "commitment": return item.data.status ? `status: ${item.data.status}` : undefined;
    default: return undefined;
  }
}

function getItemTitle(item: RetrievalItem): string | undefined {
  switch (item.item_type) {
    case "insight": return item.data.title;
    case "transaction": return `${item.data.merchant_normalized ?? "?"} ${item.data.amount}`;
    case "communication": return item.data.subject ?? undefined;
    case "meeting": return item.data.title ?? undefined;
    case "commitment": return item.data.description;
    case "aggregated_finance": return `Finance summary: ${item.data.total}`;
    case "vector": return item.data.chunk_text.slice(0, 60);
  }
}
