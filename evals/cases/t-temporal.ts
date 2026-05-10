import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;

export const temporalCases: EvalCase[] = [
  {
    id: "T1",
    query: "How much did I spend last month?",
    userId: USER_A,
    type: "exact",
    // Last month: Swiggy net 710 + Uber 770 + BigBasket 1200 = 2680 INR + AWS 42 USD
    exactChecks: (response) => {
      const hasTotal = /2[,.]?680|2680/i.test(response);
      const wrongTotal = /1[,.]?410|1410/i.test(response) && !/710/.test(response);
      if (wrongTotal) return { pass: false, reason: "Reports gross Swiggy spend without netting refund" };
      if (!hasTotal) return { pass: false, reason: "Does not report INR 2,680 total for last month" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Includes transactions from outside last calendar month",
      "Wrong total — excludes refunds from netting",
    ],
    expectedFailLayer: "L4",
  },
  {
    id: "T2",
    query: "What happened before the Goa trip?",
    userId: USER_A,
    type: "llm-judge",
    failConditions: [
      "'Goa trip' not resolved to a specific date",
      "All-time results returned with no date anchor",
      "Wrong date used as anchor",
    ],
    customJudgeQuestion: "Does the response reference events or information that occurred before the Goa travel date, using the travel confirmation as a temporal anchor rather than returning all-time results?",
    expectedFailLayer: "L2",
  },
];
