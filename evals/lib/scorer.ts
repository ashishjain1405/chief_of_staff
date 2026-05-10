import OpenAI from "openai";
import type { EvalCase, EvalResult, RetrievalTrace } from "./types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function score(
  c: EvalCase,
  response: string,
  trace: RetrievalTrace
): Promise<EvalResult> {
  const base = { caseId: c.id, query: c.query, response, trace };

  // 1. Forbidden source data check (RLS / cross-user)
  if (c.forbiddenSourceData?.length) {
    for (const forbidden of c.forbiddenSourceData) {
      if (response.includes(forbidden)) {
        return { ...base, passed: false, failedAt: "L4", reason: `Forbidden data leaked: "${forbidden}"` };
      }
    }
  }

  // 2. Required sources check
  if (c.requiredSourcesUsed?.length) {
    const usedSources = trace.retrieved_sources.filter(s => s.success && s.count > 0).map(s => s.source);
    for (const required of c.requiredSourcesUsed) {
      if (!usedSources.includes(required)) {
        return { ...base, passed: false, failedAt: "L4", reason: `Required source not used: "${required}"` };
      }
    }
  }

  // 3. Intent check
  if (c.expectedIntents) {
    const { required, forbidden = [], matchMode = "all" } = c.expectedIntents;
    const actual = trace.intent.split("+").map(s => s.trim());
    const matched = required.filter(r => actual.includes(r));
    const intentPass = matchMode === "all" ? matched.length === required.length : matched.length > 0;
    if (!intentPass) {
      return {
        ...base, passed: false, failedAt: "L2",
        reason: `Intent mismatch (${matchMode}): expected [${required.join(",")}] but got "${trace.intent}"`,
      };
    }
    for (const f of forbidden) {
      if (actual.includes(f)) {
        return {
          ...base, passed: false, failedAt: "L2",
          reason: `Forbidden intent "${f}" present in "${trace.intent}"`,
        };
      }
    }
  }

  // 4. Entity check
  if (c.expectedEntities) {
    const keys = ["people", "merchants", "categories", "topics"] as const;
    for (const key of keys) {
      const expected = c.expectedEntities[key];
      if (!expected?.length) continue;
      const actual: string[] = trace.entities[key] ?? [];
      const actualLower = actual.map(s => s.toLowerCase());
      for (const val of expected) {
        if (!actualLower.includes(val.toLowerCase())) {
          return {
            ...base, passed: false, failedAt: "L2",
            reason: `Expected entity ${key}="${val}" not found in trace.entities.${key}: [${actual.join(", ")}]`,
          };
        }
      }
    }
  }

  // 5. Temporal check
  if (c.expectedTemporal) {
    const actual = trace.temporal;
    if (!actual) {
      return { ...base, passed: false, failedAt: "L2", reason: "Expected temporal resolution but trace.temporal is null" };
    }
    if (c.expectedTemporal.type && actual.type !== c.expectedTemporal.type) {
      return {
        ...base, passed: false, failedAt: "L2",
        reason: `Temporal type mismatch: expected "${c.expectedTemporal.type}" got "${actual.type}"`,
      };
    }
    if (c.expectedTemporal.relativePeriod && actual.relativePeriod !== c.expectedTemporal.relativePeriod) {
      return {
        ...base, passed: false, failedAt: "L2",
        reason: `Temporal period mismatch: expected "${c.expectedTemporal.relativePeriod}" got "${actual.relativePeriod}"`,
      };
    }
  }

  // 6. Retrieval plan check
  if (c.expectedRetrievalPlan?.length) {
    const planSources = trace.retrieval_plan.map(s => ({ source: s.source, priority: s.priority }));
    for (const expected of c.expectedRetrievalPlan) {
      const step = planSources.find(s => s.source === expected.source);
      if (!step) {
        return {
          ...base, passed: false, failedAt: "L3",
          reason: `Expected source "${expected.source}" missing from retrieval plan`,
        };
      }
      if (expected.minPriority !== undefined && step.priority < expected.minPriority) {
        return {
          ...base, passed: false, failedAt: "L3",
          reason: `Source "${expected.source}" priority ${step.priority} below expected minimum ${expected.minPriority}`,
        };
      }
    }
  }

  // 7. Retrieval weights check
  if (c.expectedWeights) {
    const w = trace.retrieval_weights;
    if (c.expectedWeights.operational_weight) {
      const [min, max] = c.expectedWeights.operational_weight;
      if (w.operational_weight < min || w.operational_weight > max) {
        return {
          ...base, passed: false, failedAt: "L3",
          reason: `operational_weight ${w.operational_weight} outside expected range [${min}, ${max}]`,
        };
      }
    }
    if (c.expectedWeights.investigative_weight) {
      const [min, max] = c.expectedWeights.investigative_weight;
      if (w.investigative_weight < min || w.investigative_weight > max) {
        return {
          ...base, passed: false, failedAt: "L3",
          reason: `investigative_weight ${w.investigative_weight} outside expected range [${min}, ${max}]`,
        };
      }
    }
  }

  // 8. Exact checks (zero-evidence, session bleed, etc.)
  if (c.exactChecks) {
    const result = c.exactChecks(response, trace);
    if (!result.pass) {
      return { ...base, passed: false, failedAt: "exact", reason: result.reason };
    }
  }

  // 9. LLM-as-judge for grounding/hallucination
  if (c.type === "llm-judge") {
    return scoreLLM(c, response, trace, base);
  }

  return { ...base, passed: true };
}

async function scoreLLM(
  c: EvalCase,
  response: string,
  trace: RetrievalTrace,
  base: Pick<EvalResult, "caseId" | "query" | "response" | "trace">
): Promise<EvalResult> {
  const topItems = trace.top_ranked_items.map(i =>
    `${i.source}: ${i.title ?? "(no title)"}${i.snippet ? ` — ${i.snippet}` : ""} (score: ${i.score})`
  ).join("\n");

  const questions = [
    "1. Does the response assert anything NOT supported by the retrieved context? Answer yes/no + one-line reason. (hallucination check)",
    "2. Is every factual claim in the response traceable to the retrieved context? Answer yes/no + one-line reason. (grounding check)",
    c.customJudgeQuestion ? `3. ${c.customJudgeQuestion} Answer yes/no + one-line reason.` : null,
  ].filter(Boolean).join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are an eval judge. Answer each question concisely with yes/no followed by a one-line reason. Be strict.",
      },
      {
        role: "user",
        content: `Query: ${c.query}\n\nTop retrieved items:\n${topItems}\n\nResponse:\n${response}\n\n${questions}`,
      },
    ],
    max_tokens: 300,
  });

  const judgment = completion.choices[0].message.content ?? "";

  const hallucinates = /^1\.\s*yes/im.test(judgment);
  const grounded = /^2\.\s*yes/im.test(judgment);
  const customFail = c.customJudgeQuestion ? /^3\.\s*no/im.test(judgment) : false;

  if (hallucinates) {
    return { ...base, passed: false, failedAt: "L5", reason: `Hallucination: ${judgment.split("\n")[0]}` };
  }
  if (!grounded) {
    return { ...base, passed: false, failedAt: "L5", reason: `Not grounded: ${judgment.split("\n")[1] ?? judgment}` };
  }
  if (customFail) {
    return { ...base, passed: false, failedAt: "L5", reason: `Custom check failed: ${judgment.split("\n")[2] ?? judgment}` };
  }

  return { ...base, passed: true };
}
