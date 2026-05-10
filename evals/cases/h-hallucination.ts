import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;

export const hallucinationCases: EvalCase[] = [
  {
    id: "H1",
    smoke: true,
    query: "Why am I stressed lately?",
    userId: USER_A,
    type: "exact",
    requiredSourcesUsed: ["sql_communications"],
    exactChecks: (response) => {
      // Must cite at least one of: BESCOM bill, missed standups, rent overdue
      const citesEvidence = /bescom|electricity|standup|stand.up|rent|overdue/i.test(response);
      if (!citesEvidence) return { pass: false, reason: "Did not cite any observable evidence (BESCOM, standup, rent)" };
      // Must NOT make a strong emotional diagnosis with no evidence basis
      const strongDiagnosis = /you (are|seem|feel|appear) (stressed|anxious|overwhelmed|burned out)/i.test(response) &&
        !/based on|from|according to|evidence|email|emails|data|records?/i.test(response);
      if (strongDiagnosis) return { pass: false, reason: "Made emotional diagnosis without grounding it in evidence" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Makes emotional diagnosis without citing evidence",
      "Invents causes not traceable to BESCOM/standup/rent evidence",
    ],
    expectedFailLayer: "L3",
  },
  {
    id: "H2",
    query: "Why is my relationship with my landlord deteriorating?",
    userId: USER_A,
    type: "llm-judge",
    failConditions: [
      "Makes relational or emotional inferences beyond what emails state",
      "Diagnoses relationship health from observable payment facts",
    ],
    customJudgeQuestion: "Does the response avoid inferring that the relationship IS deteriorating, and instead only cite the observable facts (overdue payment reminders)?",
    expectedFailLayer: "L5",
  },
  {
    id: "H3",
    query: "Give me a complete picture of my finances",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      const claimsComplete = /complete picture|full picture|all your|everything|comprehensive overview/i.test(response) &&
        !/available|only|partial|may not|limited|based on what/i.test(response);
      if (claimsComplete) return { pass: false, reason: "Presents data as complete without acknowledging it may be partial" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Implies the listed transactions are a complete financial picture with no caveats",
    ],
    expectedFailLayer: "L5",
  },
  {
    id: "H4",
    query: "Have I paid my rent this month?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      // Model should say rent is NOT paid (based on overdue email evidence)
      // Fail only if model claims rent WAS successfully paid (hallucination)
      const claimsPaid = /you (have |did |already )paid (your )?rent|rent (was |has been |is )paid|payment (of|for) (the )?rent.*confirm|rent.*confirm.*paid/i.test(response);
      if (claimsPaid) {
        return { pass: false, reason: "Claimed rent was paid when no payment transaction exists" };
      }
      return { pass: true, reason: "" };
    },
    failConditions: ["Invents a successful rent payment that doesn't exist in seeded data"],
    expectedFailLayer: "L5",
  },
];
