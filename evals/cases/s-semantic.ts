import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;

export const semanticCases: EvalCase[] = [
  {
    id: "S1",
    query: "What did Rahul Jain say about insurance?",
    userId: USER_A,
    type: "llm-judge",
    failConditions: [
      "Attributes statements from Rahul Sharma to Rahul Jain",
      "Invents statements not in the email",
    ],
    customJudgeQuestion: "Does the response correctly attribute the insurance claim submission to Rahul Jain (rahul.jain@company.com) and not conflate him with Rahul Sharma the insurance agent?",
    expectedFailLayer: "L2",
  },
  {
    id: "S2",
    query: "What did Rahul say about insurance?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      const distinguishes = /rahul jain|rahul sharma/i.test(response);
      const asks = /which rahul|clarif/i.test(response);
      if (!distinguishes && !asks) {
        return { pass: false, reason: "Response picked one Rahul without flagging ambiguity or distinguishing both" };
      }
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Picks one Rahul without acknowledging ambiguity",
      "Conflates both Rahuls into a single answer",
    ],
    expectedFailLayer: "L5",
  },
  {
    id: "S3",
    query: "What did Rahul Jain say?",
    userId: USER_A,
    type: "exact",
    exactChecks: (response) => {
      const overClarifies = /which rahul/i.test(response);
      if (overClarifies) {
        return { pass: false, reason: "Asked 'which Rahul' when Rahul Jain was specified explicitly" };
      }
      return { pass: true, reason: "" };
    },
    failConditions: ["Response asks for clarification when the full name was already provided"],
    expectedFailLayer: "L5",
  },
  {
    id: "S4",
    query: "Summarize all conversations with Priya about the loan",
    userId: USER_A,
    type: "exact",
    requiredSourcesUsed: ["sql_communications"],
    exactChecks: (response, trace) => {
      // S4 tests that SQL retrieval finds multiple Priya loan emails.
      // 8 emails seeded; SQL topic filter on "loan" + "priya" should return many.
      const commsSource = trace.retrieved_sources.find(s => s.source === "sql_communications");
      if (!commsSource || commsSource.count < 3) {
        return { pass: false, reason: `sql_communications returned ${commsSource?.count ?? 0} items; expected ≥3 Priya loan emails` };
      }
      const claimsNone = /no (conversations?|emails?|records?|information|data)|don't (have|see|find)|can't find|couldn't find|unable to find|nothing.*priya|priya.*nothing/i.test(response);
      if (claimsNone) return { pass: false, reason: "Claims no Priya conversations when 8 exist in seeded data" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "SQL retrieval fails to return ≥3 Priya loan emails",
      "Claims no conversations with Priya exist",
    ],
    expectedFailLayer: "L4",
  },
];
