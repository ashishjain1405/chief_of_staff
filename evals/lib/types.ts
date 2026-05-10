import type { RetrievalTrace, EntityContext, TemporalAnchor, RetrievalSource } from "../../lib/ai/retrieval/types";

export type { RetrievalTrace };

export type ExpectedIntents = {
  required: string[];
  forbidden?: string[];
  matchMode?: "all" | "any";
};

export type ExpectedRetrievalPlanStep = {
  source: RetrievalSource;
  minPriority?: number;
};

export type ExpectedWeights = {
  operational_weight?: [number, number];
  investigative_weight?: [number, number];
};

export type EvalCase = {
  id: string;
  smoke?: boolean;
  query: string;
  userId: () => string;
  sessionMessages?: { role: "user" | "assistant"; text: string }[];
  type: "exact" | "llm-judge" | "trace-only";
  expectedRetrievalPath?: RetrievalTrace["retrieved_sources"][number]["source"];
  requiredSourcesUsed?: string[];
  forbiddenSourceData?: string[];
  exactChecks?: (response: string, trace: RetrievalTrace) => { pass: boolean; reason: string };
  customJudgeQuestion?: string;
  failConditions: string[];
  expectedFailLayer?: "L1" | "L2" | "L3" | "L4" | "L5";
  // Extended trace checks
  expectedIntents?: ExpectedIntents;
  expectedEntities?: Partial<EntityContext>;
  expectedTemporal?: Partial<TemporalAnchor>;
  expectedRetrievalPlan?: ExpectedRetrievalPlanStep[];
  expectedWeights?: ExpectedWeights;
};

export type EvalResult = {
  caseId: string;
  query: string;
  response: string;
  trace: RetrievalTrace;
  passed: boolean;
  failedAt?: "L1" | "L2" | "L3" | "L4" | "L5" | "exact" | "llm";
  reason?: string;
};
