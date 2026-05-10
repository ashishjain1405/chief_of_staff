import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;
const USER_B = () => process.env.EVAL_USER_B_ID!;

export const factualCases: EvalCase[] = [
  {
    id: "F1",
    smoke: true,
    query: "Did I pay AWS this month?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      const mentionsAWS = /aws/i.test(response);
      const mentionsAmount = /\$42|42\s*(usd|dollars?)|usd\s*42/i.test(response);
      const deniesPayment = /no.*aws|aws.*not|didn't pay|not paid|no record|no transaction/i.test(response);
      if (deniesPayment) return { pass: false, reason: "Incorrectly says no AWS payment found" };
      if (!mentionsAWS) return { pass: false, reason: "Does not mention AWS" };
      if (!mentionsAmount) return { pass: false, reason: "Does not mention the 42 amount" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Response says payment not found",
      "Invents amount or date",
      "Uses wrong month's transaction",
    ],
    expectedFailLayer: "L4",
  },
  {
    id: "F2",
    smoke: true,
    query: "Did I pay my internet bill?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      // F2: no internet bill payment exists in seeded data. Only fail if model invents one.
      const hallucinated = /you (have |did |already )paid.*(internet|broadband)|payment (of|for) .*(internet|broadband)|internet bill (was |has been |is )?paid|yes.*internet.*paid|internet.*payment.*confirmed/i.test(response);
      if (hallucinated) return { pass: false, reason: "Hallucinated an internet bill payment that does not exist" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Response invents a payment, amount, or date",
      "Response says 'it appears you paid' without evidence",
    ],
    expectedFailLayer: "L5",
  },
  {
    id: "F3",
    query: "Did I pay my electricity bill?",
    userId: USER_A,
    type: "exact",
    requiredSourcesUsed: ["sql_transactions"],
    exactChecks: (response) => {
      const saysUnpaid = /not paid|unpaid|haven't paid|hasn't been paid|no payment|bill is due|still owe/i.test(response) &&
        !/paid on|was paid|payment.*made|payment.*found|did pay/i.test(response);
      if (saysUnpaid) return { pass: false, reason: "Trusts stale insight and says bill is unpaid despite BESCOM debit transaction existing" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Response trusts stale insight and says unpaid",
      "Contradiction between insight and transaction not acknowledged",
    ],
    expectedFailLayer: "L3",
  },
  {
    id: "F4",
    query: "How much did I spend on Swiggy last month?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      // Net spend: ₹350 + ₹420 + ₹290 - ₹350 refund = ₹710
      const hasGross = /1[,.]?060|1060/i.test(response) && !/710/.test(response);
      if (hasGross) return { pass: false, reason: "Reports ₹1,060 gross without netting the ₹350 refund" };
      const hasNet = /₹\s*710|710\s*(inr|rupees?)|inr\s*710|\b710\b/i.test(response);
      if (!hasNet) return { pass: false, reason: "Does not report ₹710 net spend" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Reports ₹1,060 gross instead of netting refund",
      "Double-counts any transaction",
    ],
    expectedFailLayer: "L4",
  },
];
