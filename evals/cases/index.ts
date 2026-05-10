import { factualCases } from "./f-factual";
import { semanticCases } from "./s-semantic";
import { temporalCases } from "./t-temporal";
import { hallucinationCases } from "./h-hallucination";
import { multiTurnCases } from "./m-multiturn";
import { adversarialCases } from "./a-adversarial";
import type { EvalCase } from "../lib/types";
import { generatedCases } from "./uc-generated";

export const allCases: EvalCase[] = [
  ...generatedCases,
  ...factualCases,
  ...semanticCases,
  ...temporalCases,
  ...hallucinationCases,
  ...multiTurnCases,
  ...adversarialCases,
];

export const smokeCases: EvalCase[] = allCases.filter((c) => c.smoke);
