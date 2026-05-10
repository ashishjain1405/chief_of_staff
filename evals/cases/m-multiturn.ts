import type { EvalCase } from "../lib/types";

const USER_A = () => process.env.EVAL_USER_ID!;

export const multiTurnCases: EvalCase[] = [
  {
    id: "M1",
    query: "What about transport?",
    userId: USER_A,
    sessionMessages: [
      { role: "user", text: "How much did I spend on food last month?" },
      {
        role: "assistant",
        text: `Based on your Swiggy transactions last month, you spent ₹710 net (₹1,060 in charges minus a ₹350 refund).<!--METADATA:${JSON.stringify({
          context: {
            tracked_entities: [
              { value: "food_delivery", introduced_at_turn: 1, entity_type: "category" },
              { value: "Swiggy", introduced_at_turn: 1, entity_type: "merchant" },
            ],
            active_temporal: { type: "relative", relativePeriod: "last_month" },
            active_topic: "finance",
            turn_count: 1,
          },
          retrieval_summary: { sources_used: ["sql_transactions", "aggregated_finance"] },
        })}-->`,
      },
    ],
    type: "exact",
    exactChecks: (response) => {
      const allTime = /all.time|ever|total.*transport|all your transport/i.test(response);
      const hasTimeContext = /last month|this month|month/i.test(response);
      if (allTime) return { pass: false, reason: "Returned all-time transport instead of last month" };
      if (!hasTimeContext) return { pass: false, reason: "Did not carry forward last-month time context" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Returns all-time transport spend instead of last month",
      "Ignores established time context from Turn 1",
    ],
    expectedFailLayer: "L5",
  },
  {
    id: "M2",
    query: "Did he pay it?",
    userId: USER_A,
    sessionMessages: [
      { role: "user", text: "What did Rahul Jain say about the insurance claim?" },
      {
        role: "assistant",
        text: `Rahul Jain confirmed the insurance claim has been submitted to HR.<!--METADATA:${JSON.stringify({
          context: {
            tracked_entities: [
              { value: "Rahul Jain", introduced_at_turn: 1, entity_type: "person" },
              { value: "insurance", introduced_at_turn: 1, entity_type: "topic" },
            ],
            active_temporal: null,
            active_topic: "relationship",
            turn_count: 1,
          },
          retrieval_summary: { sources_used: ["sql_communications"], top_entity: "Rahul Jain" },
        })}-->`,
      },
      { role: "user", text: "What's happening with the product launch?" },
      {
        role: "assistant",
        text: `I don't have specific information about a product launch in your data.<!--METADATA:${JSON.stringify({
          context: {
            tracked_entities: [
              { value: "Rahul Jain", introduced_at_turn: 1, entity_type: "person" },
              { value: "insurance", introduced_at_turn: 1, entity_type: "topic" },
              { value: "product launch", introduced_at_turn: 2, entity_type: "topic" },
            ],
            active_temporal: null,
            active_topic: "search_lookup",
            turn_count: 2,
          },
          retrieval_summary: { sources_used: [] },
        })}-->`,
      },
    ],
    type: "exact",
    exactChecks: (response) => {
      const invents = /yes.*paid|he paid|payment confirmed/i.test(response) &&
        !/no record|don't see|can't find|unclear|clarif/i.test(response);
      if (invents) return { pass: false, reason: "Invented that Rahul paid without evidence" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "'He' resolved to wrong entity after unrelated turn",
      "Response fabricates a payment without asking for clarification",
    ],
    expectedFailLayer: "L5",
  },
  {
    id: "M3",
    query: "Mark the electricity one as done",
    userId: USER_A,
    sessionMessages: [
      { role: "user", text: "What bills do I have due?" },
      {
        role: "assistant",
        text: `You have an overdue BESCOM electricity bill of ₹1,840 and an insurance premium from Rahul Sharma.<!--METADATA:${JSON.stringify({
          context: {
            tracked_entities: [
              { value: "BESCOM", introduced_at_turn: 1, entity_type: "merchant" },
              { value: "electricity", introduced_at_turn: 1, entity_type: "topic" },
              { value: "Rahul Sharma", introduced_at_turn: 1, entity_type: "person" },
              { value: "insurance", introduced_at_turn: 1, entity_type: "topic" },
            ],
            active_temporal: null,
            active_topic: "bills_payments",
            turn_count: 1,
          },
          retrieval_summary: { sources_used: ["operational_insights", "sql_communications"] },
        })}-->`,
      },
    ],
    type: "exact",
    exactChecks: (response) => {
      const mentionsBESCOM = /bescom|electricity/i.test(response);
      // Fail only if the response explicitly references the WRONG bill (insurance/Rahul Sharma)
      // without also mentioning the correct one (BESCOM/electricity)
      const mentionsWrongBill = /insurance|rahul sharma/i.test(response) && !mentionsBESCOM;
      if (mentionsWrongBill) return { pass: false, reason: "Referenced wrong bill (insurance) from Turn 1 context" };
      // Also fail if model seems to have lost context entirely (asks what to mark, no reference to prior turn)
      const lostContext = /what (would|do) you (like|want) (me )?to mark|which (task|item|bill)|mark what/i.test(response);
      if (lostContext) return { pass: false, reason: "Lost Turn 1 context — asked what to mark instead of referencing electricity bill" };
      return { pass: true, reason: "" };
    },
    failConditions: [
      "References wrong bill or a fresh unrelated search",
      "Ignores Turn 1 context entirely",
    ],
    expectedFailLayer: "L5",
  },
  {
    // M4: fresh session — no prior context injected via sessionMessages.
    // The query is ambiguous ("Did he follow up?") with no context in this session.
    id: "M4",
    query: "Did he follow up?",
    userId: USER_A,
    sessionMessages: [],
    type: "exact",
    exactChecks: (response) => {
      const asksClarification = /who (do you mean|are you referring)|which person|could you (clarify|specify)|please (clarify|specify|let me know who)|can you clarify/i.test(response);
      if (!asksClarification) {
        return { pass: false, reason: "Did not ask for clarification on ambiguous 'he' with no session context" };
      }
      return { pass: true, reason: "" };
    },
    failConditions: [
      "Resolves 'he' to Rahul or any entity from a prior session",
      "Gives a direct answer without requesting clarification",
    ],
    expectedFailLayer: "L5",
  },
];
