import type { IntentType } from "@/lib/ai/processors/types";

export type Assertion =
  | { field: "intent.primary"; eq: IntentType }
  | { field: "intent.primary"; oneOf: IntentType[] }
  | { field: "weights.operational"; gte: number }
  | { field: "weights.operational"; lte: number }
  | { field: "weights.operational"; eq: number }
  | { field: "weights.investigative"; gte: number }
  | { field: "weights.investigative"; eq: number }
  | { field: "entities.merchants"; includes: string }
  | { field: "entities.merchants"; isEmpty: true }
  | { field: "entities.categories"; includes: string }
  | { field: "entities.categories"; allIn: string[] }
  | { field: "entities.people"; includes: string }
  | { field: "entities.people"; isEmpty: true }
  | { field: "entities.topics"; includes: string }
  | { field: "temporal.relativePeriod"; eq: string }
  | { field: "temporal"; isNull: true }
  | { field: "temporal"; nonNull: true }
  | { field: "plan.sources"; includes: string }
  | { field: "plan.sources"; excludes: string }
  | { field: "plan.sources"; only: string[] }
  | { field: string; gt: number }   // retrieved.<source>.count gt N
  | { field: string; eq: number }   // retrieved.<source>.count eq N
  | { field: "top_ranked[0].source"; eq: string }
  | { field: "top_ranked[0].source"; oneOf: string[] }
  | { field: "no_crash" };          // just assert pipeline completes

export interface TestCase {
  id: string;
  description: string;
  query: string;
  type?: "manual";
  assert: Assertion[];
}

const VALID_CATEGORIES = ["food_delivery", "groceries", "travel", "entertainment", "subscriptions", "utilities", "healthcare", "shopping", "education"];
const validCats: Assertion = { field: "entities.categories", allIn: VALID_CATEGORIES };
const invFull: Assertion = { field: "weights.investigative", eq: 1.0 };
const opLow: Assertion = { field: "weights.operational", lte: 0.15 };
const invHigh: Assertion = { field: "weights.investigative", gte: 0.5 };
const opHigh: Assertion = { field: "weights.operational", gte: 0.3 };
const hasSqlComms: Assertion = { field: "plan.sources", includes: "sql_communications" };
const hasSqlTxns: Assertion = { field: "plan.sources", includes: "sql_transactions" };
const hasSqlMeetings: Assertion = { field: "plan.sources", includes: "sql_meetings" };
const hasSqlCommitments: Assertion = { field: "plan.sources", includes: "sql_commitments" };
const hasOpInsights: Assertion = { field: "plan.sources", includes: "operational_insights" };
const hasVectorSearch: Assertion = { field: "plan.sources", includes: "vector_search" };
const hasAggFinance: Assertion = { field: "plan.sources", includes: "aggregated_finance" };

export const TEST_CASES: TestCase[] = [

  // ─── Layer 1 — Communications ──────────────────────────────────────────────

  { id: "L1-C1",  description: "Last email from Rahul",          query: "Show me the last email from Rahul.",            assert: [{ field: "intent.primary", eq: "search_lookup" }, { field: "entities.people", includes: "Rahul" }, hasSqlComms, invFull] },
  { id: "L1-C2",  description: "Amazon refund email",            query: "Did Amazon send me a refund email?",            assert: [{ field: "entities.merchants", includes: "Amazon" }, hasSqlComms] },
  { id: "L1-C3",  description: "Emails mentioning insurance",    query: "Find emails mentioning insurance premium.",      assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C4",  description: "Bank email failed transaction",  query: "What did my bank say about the failed transaction?", assert: [{ field: "no_crash" }] },
  { id: "L1-C5",  description: "Unread emails this week",        query: "Show unread emails from this week.",             assert: [{ field: "temporal.relativePeriod", eq: "this_week" }, hasSqlComms] },
  { id: "L1-C6",  description: "Joining letter email",           query: "Did I receive a joining letter?",               assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C7",  description: "Emails from Deloitte",           query: "Find emails with attachments from Deloitte.",   assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C8",  description: "Emails mentioning Goa trip",     query: "Show emails mentioning Goa trip.",              assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C9",  description: "Swiggy invoice email",           query: "Did Swiggy send any invoice?",                  assert: [{ field: "entities.merchants", includes: "Swiggy" }, hasSqlComms] },
  { id: "L1-C10", description: "Communications about taxes",     query: "Find all communications related to taxes.",     assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C11", description: "John pricing emails",            query: "What did John say about pricing?",              assert: [{ field: "intent.primary", eq: "search_lookup" }, { field: "entities.people", includes: "John" }, hasSqlComms] },
  { id: "L1-C12", description: "Approval request emails",        query: "Find emails where someone asked me for approval.", assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C13", description: "Unknown sender emails",          query: "Show emails from unknown senders.",             assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C14", description: "Layoffs mentions",               query: "Did anyone mention layoffs?",                   assert: [{ field: "no_crash" }] },
  { id: "L1-C15", description: "Resignation emails",             query: "Find emails about resignation.",                assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C16", description: "OTP emails",                     query: "Search for OTP emails.",                        assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C17", description: "Contract renewal messages",      query: "Find messages mentioning contract renewal.",    assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C18", description: "Diwali emails",                  query: "Show emails around Diwali.",                    assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C19", description: "AWS credits discussion",         query: "What was discussed about AWS credits?",         assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C20", description: "Legal notice emails",            query: "Find emails mentioning legal notice.",          assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C21", description: "Recruiter emails",               query: "Show emails from recruiters.",                  assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C22", description: "Calendar invite emails",         query: "Did anyone send me a calendar invite?",         assert: [{ field: "no_crash" }] },
  { id: "L1-C23", description: "Refund delayed emails",          query: "Find communications mentioning refund delayed.", assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C24", description: "Flight cancellation emails",     query: "Show emails related to flight cancellation.",   assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L1-C25", description: "Invoice emails",                 query: "Find all invoice emails.",                      assert: [hasSqlComms] },
  { id: "L1-C26", description: "Subscription signup emails",     query: "Search for subscriptions I signed up for.",    assert: [{ field: "intent.primary", oneOf: ["search_lookup", "subscriptions"] }, hasSqlComms] },
  { id: "L1-C27", description: "Phishing emails",                query: "Did I get any phishing-looking email?",         assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C28", description: "Stock options emails",           query: "Find emails mentioning stock options.",         assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },
  { id: "L1-C29", description: "Urgent communications",          query: "Search communications for the word 'urgent'.", assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms] },

  // ─── Layer 1 — Meetings ────────────────────────────────────────────────────

  { id: "L1-M1",  description: "Yesterday meetings",             query: "What meetings did I have yesterday?",           assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings, invHigh] },
  { id: "L1-M2",  description: "Meetings with Rahul",            query: "Show meetings with Rahul.",                     assert: [{ field: "intent.primary", oneOf: ["scheduling", "relationship"] }, { field: "entities.people", includes: "Rahul" }, hasSqlMeetings] },
  { id: "L1-M3",  description: "Hiring meeting discussion",      query: "What was discussed in the hiring meeting?",     assert: [hasSqlMeetings] },
  { id: "L1-M4",  description: "Insurance in meetings",          query: "Did we discuss insurance in any meeting?",      assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M5",  description: "Budget meetings",                query: "Find meetings where budget cuts were mentioned.", assert: [hasSqlMeetings] },
  { id: "L1-M6",  description: "Longest meetings this week",     query: "Show my longest meetings this week.",           assert: [{ field: "intent.primary", eq: "scheduling" }, { field: "temporal.relativePeriod", eq: "this_week" }, hasSqlMeetings] },
  { id: "L1-M7",  description: "Large meetings",                 query: "Which meetings had more than 5 attendees?",     assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M8",  description: "Cancelled meetings",             query: "What meetings were cancelled?",                 assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M9",  description: "Meetings before Goa trip",       query: "Show meetings before my Goa trip.",             assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M10", description: "Met John after salary",          query: "Did I meet John after salary day?",             assert: [{ field: "entities.people", includes: "John" }, hasSqlMeetings] },
  { id: "L1-M11", description: "Meetings without notes",         query: "Find meetings without notes.",                  assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M12", description: "Roadmap meetings",               query: "Which meetings discussed roadmap?",             assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M13", description: "Investor meetings",              query: "Show investor meetings.",                       assert: [{ field: "intent.primary", oneOf: ["scheduling", "relationship"] }, hasSqlMeetings] },
  { id: "L1-M14", description: "Acquisition meetings",           query: "Find meetings mentioning acquisition.",         assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M15", description: "Overlapping meetings",           query: "What meetings overlapped?",                     assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M16", description: "After-hours meetings",           query: "Show meetings outside working hours.",          assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M17", description: "Interview meetings",             query: "Did I have any interview meetings?",            assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M18", description: "Performance review meetings",    query: "Find meetings related to performance review.",  assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M19", description: "Pricing meetings",               query: "Show meetings where I spoke about pricing.",    assert: [{ field: "intent.primary", eq: "scheduling" }, hasSqlMeetings] },
  { id: "L1-M20", description: "Meetings with action items",     query: "Find meetings with action items.",              assert: [{ field: "intent.primary", oneOf: ["scheduling", "commitments"] }, hasSqlMeetings] },

  // ─── Layer 1 — Transactions ────────────────────────────────────────────────

  { id: "L1-T1",  description: "Rent payment",                   query: "Did I pay rent?",                               assert: [{ field: "intent.primary", oneOf: ["bills_payments", "finance"] }, hasSqlTxns, invFull, validCats] },
  { id: "L1-T2",  description: "Food spending",                  query: "How much did I spend on food?",                 assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, { field: "entities.categories", includes: "food_delivery" }, hasSqlTxns, invFull, validCats] },
  { id: "L1-T3",  description: "Last week transactions",         query: "Show transactions from last week.",             assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, { field: "temporal.relativePeriod", eq: "last_week" }, hasSqlTxns] },
  { id: "L1-T4",  description: "Netflix charge this month",      query: "Did Netflix charge me this month?",             assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, { field: "entities.merchants", includes: "Netflix" }, hasSqlTxns, invFull] },
  { id: "L1-T5",  description: "UPI payments above 5000",        query: "Find all UPI payments above ₹5,000.",           assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns, invFull] },
  { id: "L1-T6",  description: "Cash withdrawals",               query: "Show cash withdrawals.",                        assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T7",  description: "Salary received",                query: "Did I receive salary?",                         assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T8",  description: "All refunds",                    query: "Show all refunds.",                             assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T9",  description: "Travel spending",                query: "What did I spend on travel?",                   assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, { field: "entities.categories", includes: "travel" }, hasSqlTxns, invFull, validCats] },
  { id: "L1-T10", description: "Starbucks transactions",         query: "Find transactions at Starbucks.",               assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T11", description: "Electricity bill",               query: "Did I pay my electricity bill?",                assert: [{ field: "intent.primary", oneOf: ["bills_payments", "finance"] }, hasSqlTxns, validCats] },
  { id: "L1-T12", description: "Failed transactions",            query: "Show failed transactions.",                     assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T13", description: "Duplicate charges",              query: "Find duplicate charges.",                       assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T14", description: "Zomato double charge",           query: "Did Zomato charge twice?",                      assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, { field: "entities.merchants", includes: "Zomato" }, hasSqlTxns] },
  { id: "L1-T15", description: "Subscriptions list",             query: "Show subscriptions.",                           assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, hasSqlTxns] },
  { id: "L1-T16", description: "Grocery spending",               query: "How much did I spend on groceries?",            assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, { field: "entities.categories", includes: "groceries" }, hasSqlTxns, invFull, validCats] },
  { id: "L1-T17", description: "Largest expense",                query: "What was my largest expense?",                  assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasSqlTxns] },
  { id: "L1-T18", description: "International transactions",     query: "Show international transactions.",              assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T19", description: "Holi transactions",              query: "Find transactions around Holi.",                assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T20", description: "Transfer to Dad",                query: "Did I transfer money to Dad?",                  assert: [hasSqlTxns] },
  { id: "L1-T21", description: "EMI payments",                   query: "Show EMI payments.",                            assert: [{ field: "intent.primary", oneOf: ["bills_payments", "finance"] }, hasSqlTxns] },
  { id: "L1-T22", description: "After midnight transactions",    query: "Find transactions after midnight.",             assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T23", description: "Tax payments",                   query: "How much tax did I pay?",                       assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasSqlTxns] },
  { id: "L1-T24", description: "Suspicious transactions",        query: "Show suspicious transactions.",                 assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T25", description: "QR payments",                    query: "Find all QR payments.",                         assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, { field: "no_crash" }] },
  { id: "L1-T26", description: "PhonePe credits",                query: "Show all credits from PhonePe.",                assert: [{ field: "entities.merchants", includes: "PhonePe" }, hasSqlTxns] },
  { id: "L1-T27", description: "Received rent",                  query: "Did I receive rent?",                           assert: [{ field: "no_crash" }] },
  { id: "L1-T28", description: "ATM withdrawals",                query: "Show ATM withdrawals.",                         assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T29", description: "Uncategorized transactions",     query: "Find transactions with no category.",           assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasSqlTxns] },
  { id: "L1-T30", description: "Insurance premium payment",      query: "Did I pay insurance premium?",                  assert: [{ field: "intent.primary", oneOf: ["bills_payments", "finance"] }, hasSqlTxns, validCats] },

  // ─── Layer 1 — Tasks & Commitments ────────────────────────────────────────

  { id: "L1-K1",  description: "Overdue tasks",                  query: "What tasks are overdue?",                       assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments, invHigh] },
  { id: "L1-K2",  description: "Promise to Rahul",               query: "Did I promise Rahul something?",                assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K3",  description: "Pending commitments",            query: "Show pending commitments.",                     assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K4",  description: "Follow-ups",                     query: "What follow-ups do I have?",                    assert: [hasSqlCommitments] },
  { id: "L1-K5",  description: "Tasks this week",                query: "Show tasks due this week.",                     assert: [{ field: "temporal.relativePeriod", eq: "this_week" }, hasSqlCommitments] },
  { id: "L1-K6",  description: "Hiring commitments",             query: "Find commitments related to hiring.",           assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K7",  description: "Meeting action items",           query: "What action items came from meetings?",         assert: [hasSqlCommitments] },
  { id: "L1-K8",  description: "Document sending commitment",    query: "Did I commit to sending documents?",            assert: [hasSqlCommitments] },
  { id: "L1-K9",  description: "Tasks by John",                  query: "Show tasks assigned by John.",                  assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, { field: "entities.people", includes: "John" }, hasSqlCommitments] },
  { id: "L1-K10", description: "Unresolved commitments",         query: "Find unresolved commitments.",                  assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K11", description: "Blocked tasks",                  query: "What tasks are blocked?",                       assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K12", description: "Tax commitments",                query: "Show commitments around taxes.",                assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K13", description: "Ignored items 2+ weeks",         query: "What have I ignored for more than 2 weeks?",    assert: [hasSqlCommitments] },
  { id: "L1-K14", description: "Proposal review commitment",     query: "Did I promise to review the proposal?",         assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K15", description: "High priority tasks",            query: "Show all high-priority tasks.",                 assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K16", description: "Recurring commitments",          query: "Find recurring commitments.",                   assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K17", description: "Finance tasks",                  query: "What tasks involve finance?",                   assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K18", description: "Travel tasks",                   query: "Show tasks linked to travel.",                  assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L1-K19", description: "Commitments due tomorrow",       query: "What commitments are due tomorrow?",            assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity", "scheduling"] }, hasSqlCommitments, { field: "temporal", nonNull: true }] },
  { id: "L1-K20", description: "Commitments without due dates",  query: "Find commitments without due dates.",           assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },

  // ─── Layer 1 — Vector / Semantic Memory ────────────────────────────────────

  { id: "L1-V1",  description: "Goa trip knowledge",             query: "What do I know about the Goa trip?",            assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V2",  description: "Insurance summary",              query: "Summarize everything related to insurance.",    assert: [{ field: "no_crash" }] },
  { id: "L1-V3",  description: "Burnout conversations",          query: "What conversations mentioned burnout?",         assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V4",  description: "Product strategy memories",      query: "Find memories related to product strategy.",   assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V5",  description: "Rahul startup knowledge",        query: "What do I know about Rahul's startup?",         assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V6",  description: "Layoffs discussions",            query: "Search for discussions around layoffs.",        assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V7",  description: "Investor concerns",              query: "What concerns did investors raise?",            assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V8",  description: "Hiring memories",                query: "Find memories related to hiring engineers.",    assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V9",  description: "Pricing discussions",            query: "What did people say about pricing issues?",     assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V10", description: "Churn discussions",              query: "Find discussions about churn.",                 assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V11", description: "Customer complaints",            query: "What are recurring complaints from customers?", assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V12", description: "Tax conversations",              query: "Search for conversations about taxes.",         assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V13", description: "Relocation memories",            query: "What memories relate to relocation?",          assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V14", description: "AWS billing knowledge",          query: "Find anything connected to AWS billing.",       assert: [hasVectorSearch, { field: "no_crash" }] },
  { id: "L1-V15", description: "Funding discussions",            query: "What discussions happened around funding?",     assert: [hasVectorSearch, { field: "no_crash" }] },

  // ─── Layer 2 — Entity Resolution ──────────────────────────────────────────

  { id: "L2-P1",  description: "Dad insurance messages",         query: "What did Dad say about insurance?",             assert: [{ field: "entities.people", includes: "Dad" }, hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P2",  description: "RJ messages",                    query: "Did RJ message me?",                            assert: [{ field: "entities.people", includes: "RJ" }, hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P3",  description: "Rahul Jain discussion",          query: "What did Rahul Jain discuss?",                  assert: [{ field: "entities.people", includes: "Rahul Jain" }, hasSqlComms] },
  { id: "L2-P4",  description: "Mom messages",                   query: "Show messages from mom.",                       assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P5",  description: "Ashu call",                      query: "Did Ashu call me?",                             assert: [{ field: "entities.people", includes: "Ashu" }, { field: "no_crash" }] },
  { id: "L2-P6",  description: "HR conversations",               query: "Find conversations with HR.",                   assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P7",  description: "Founder mentions",               query: "What did the founder mention?",                 assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P8",  description: "Manager discussions",            query: "Show discussions with my manager.",             assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-P9",  description: "John from Deloitte",             query: "Did John from Deloitte email me?",              assert: [{ field: "entities.people", includes: "John" }, hasSqlComms] },
  { id: "L2-P10", description: "CA messages",                    query: "What did the CA say?",                          assert: [hasSqlComms, { field: "no_crash" }] },

  { id: "L2-M1",  description: "Zomato spend",                   query: "How much did I spend on Zomato?",               assert: [{ field: "entities.merchants", includes: "Zomato" }, hasSqlTxns, invFull] },
  { id: "L2-M2",  description: "Zomato alias resolution",        query: "What about zomato ltd?",                        assert: [{ field: "entities.merchants", includes: "Zomato" }, { field: "no_crash" }] },
  { id: "L2-M3",  description: "Swiggy Instamart alias",         query: "Show spends on Swiggy Instamart.",              assert: [{ field: "entities.merchants", includes: "Swiggy" }, hasSqlTxns] },
  { id: "L2-M4",  description: "Amazon Pay charges",             query: "Did Amazon Pay charge me?",                     assert: [{ field: "entities.merchants", includes: "Amazon Pay" }, hasSqlTxns] },
  { id: "L2-M5",  description: "AWS expenses",                   query: "Show AWS expenses.",                            assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-M6",  description: "Google subscriptions",           query: "What subscriptions are from Google?",           assert: [{ field: "entities.merchants", includes: "Google" }, hasSqlTxns] },
  { id: "L2-M7",  description: "Starbucks spend (unknown merch)",query: "How much did I spend at Starbucks?",            assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-M8",  description: "Uber transactions",              query: "Show Uber transactions.",                       assert: [{ field: "entities.merchants", includes: "Uber" }, hasSqlTxns] },
  { id: "L2-M9",  description: "Uber Eats charges",              query: "Did Uber Eats charge me?",                      assert: [{ field: "entities.merchants", includes: "Uber Eats" }, hasSqlTxns] },
  { id: "L2-M10", description: "Apple charges",                  query: "Find Apple charges.",                           assert: [{ field: "entities.merchants", includes: "Apple" }, hasSqlTxns] },

  { id: "L2-T1",  description: "Before Goa trip temporal",       query: "What happened before my Goa trip?",            assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-T2",  description: "After salary temporal",          query: "What did I spend after salary?",               assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-T3",  description: "Around Diwali temporal",         query: "What happened around Diwali?",                  assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-T4",  description: "Before joining Deloitte",        query: "Show expenses before joining Deloitte.",        assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-T5",  description: "John after meeting",             query: "What did John say after our meeting?",          assert: [{ field: "entities.people", includes: "John" }, hasSqlComms] },
  { id: "L2-T6",  description: "Since last quarter",             query: "What changed since last quarter?",              assert: [{ field: "temporal.relativePeriod", eq: "last_quarter" }, hasSqlComms] },
  { id: "L2-T7",  description: "Around New Year",                query: "Show transactions around New Year.",            assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-T8",  description: "Before breakup (unresolvable)",  query: "What happened before the breakup.",             assert: [{ field: "no_crash" }] },
  { id: "L2-T9",  description: "After promotion (unresolvable)", query: "Show activity after my promotion.",             assert: [{ field: "no_crash" }] },
  { id: "L2-T10", description: "During travel expenses",         query: "What expenses happened during travel?",         assert: [{ field: "entities.categories", includes: "travel" }, hasSqlTxns, validCats] },

  { id: "L2-A1",  description: "Multiple Rahuls ambiguity",      query: "Show messages from Rahul.",                     assert: [{ field: "entities.people", includes: "Rahul" }, { field: "no_crash" }] },
  { id: "L2-A2",  description: "Pay John ambiguity",             query: "Did I pay John?",                               assert: [{ field: "no_crash" }] },
  { id: "L2-A3",  description: "Spending around trip ambiguity", query: "Show spending around the trip.",                assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L2-A4",  description: "Mom messages ambiguity",         query: "Find messages from Mom.",                       assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L2-A5",  description: "Rent payments",                  query: "Show rent payments.",                           assert: [{ field: "intent.primary", oneOf: ["finance", "bills_payments"] }, hasSqlTxns] },
  { id: "L2-A6",  description: "After meeting ambiguity",        query: "What happened after the meeting?",              assert: [hasSqlMeetings, { field: "no_crash" }] },

  // ─── Layer 3 — Daily Catch-up ──────────────────────────────────────────────

  { id: "L3-D1",  description: "Catch me up",                    query: "Catch me up.",                                  assert: [{ field: "intent.primary", eq: "operational_summary" }, { field: "weights.operational", eq: 1.0 }, { field: "weights.investigative", eq: 0.0 }, { field: "plan.sources", only: ["operational_insights"] }] },
  { id: "L3-D2",  description: "What to know today",             query: "What should I know today?",                     assert: [{ field: "intent.primary", eq: "operational_summary" }, { field: "weights.operational", eq: 1.0 }, { field: "plan.sources", only: ["operational_insights"] }] },
  { id: "L3-D3",  description: "Anything urgent",                query: "Anything urgent?",                              assert: [{ field: "intent.primary", eq: "operational_summary" }, { field: "weights.operational", eq: 1.0 }, hasOpInsights] },
  { id: "L3-D4",  description: "Summarize my day",               query: "Summarize my day.",                             assert: [{ field: "intent.primary", eq: "operational_summary" }, { field: "weights.operational", eq: 1.0 }, hasOpInsights] },
  { id: "L3-D5",  description: "What needs attention",           query: "What needs attention?",                         assert: [{ field: "intent.primary", oneOf: ["operational_summary", "productivity"] }, hasOpInsights] },
  { id: "L3-D6",  description: "What am I missing",              query: "What am I missing?",                            assert: [{ field: "intent.primary", oneOf: ["operational_summary", "productivity"] }, hasOpInsights] },
  { id: "L3-D7",  description: "Changed since yesterday",        query: "What changed since yesterday?",                 assert: [{ field: "intent.primary", eq: "operational_summary" }, hasOpInsights] },
  { id: "L3-D8",  description: "Slipped through cracks",         query: "What slipped through the cracks?",              assert: [{ field: "intent.primary", eq: "operational_summary" }, hasOpInsights] },
  { id: "L3-D9",  description: "What to prioritize",             query: "What should I prioritize?",                     assert: [{ field: "intent.primary", oneOf: ["operational_summary", "productivity"] }, hasOpInsights] },
  { id: "L3-D10", description: "Daily briefing",                 query: "Give me my briefing.",                          assert: [{ field: "intent.primary", eq: "operational_summary" }, { field: "weights.operational", eq: 1.0 }, hasOpInsights] },

  // ─── Layer 3 — Financial Operational Insights ─────────────────────────────

  { id: "L3-F1",  description: "Am I overspending analytical",   query: "Am I overspending?",                            assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, invHigh, opHigh] },
  { id: "L3-F2",  description: "Unusual expenses",               query: "What unusual expenses happened?",               assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasOpInsights] },
  { id: "L3-F3",  description: "Subscriptions increased",        query: "What subscriptions increased?",                 assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, hasSqlTxns] },
  { id: "L3-F4",  description: "Recent spending spike",          query: "Did spending spike recently?",                  assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasOpInsights] },
  { id: "L3-F5",  description: "Suspicious transactions",        query: "Any suspicious transactions?",                  assert: [{ field: "intent.primary", oneOf: ["finance", "search_lookup"] }, hasOpInsights] },
  { id: "L3-F6",  description: "Recurring payments changed",     query: "What recurring payments changed?",              assert: [{ field: "intent.primary", oneOf: ["finance", "subscriptions"] }, { field: "no_crash" }] },
  { id: "L3-F7",  description: "Bills due",                      query: "What bills are due?",                           assert: [{ field: "intent.primary", eq: "bills_payments" }, hasSqlComms] },
  { id: "L3-F8",  description: "Expenses need review",           query: "What expenses need review?",                    assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasOpInsights] },
  { id: "L3-F9",  description: "Spending more than usual",       query: "Am I spending more than usual?",                assert: [invHigh, opHigh] },
  { id: "L3-F10", description: "Merchants increasing charges",   query: "What merchants increased charges?",             assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasSqlTxns] },

  // ─── Layer 3 — Relationship Insights ──────────────────────────────────────

  { id: "L3-R1",  description: "Ignored contacts",               query: "Who have I ignored recently?",                  assert: [hasOpInsights] },
  { id: "L3-R2",  description: "Emails needing reply",           query: "Which important emails need replies?",          assert: [{ field: "intent.primary", oneOf: ["relationship", "productivity"] }, hasSqlComms] },
  { id: "L3-R3",  description: "Who is waiting on me",           query: "Who is waiting on me?",                         assert: [{ field: "intent.primary", oneOf: ["relationship", "commitments"] }, hasOpInsights] },
  { id: "L3-R4",  description: "Cooling relationships",          query: "Which relationships are cooling off?",          assert: [hasOpInsights] },
  { id: "L3-R5",  description: "Double follow-up",               query: "Did anyone follow up twice?",                   assert: [{ field: "intent.primary", oneOf: ["relationship", "search_lookup"] }, hasSqlComms] },
  { id: "L3-R6",  description: "Frustrated contacts",            query: "Who seems frustrated?",                         assert: [hasOpInsights] },
  { id: "L3-R7",  description: "Stalled conversations",          query: "What important conversations stalled?",         assert: [hasOpInsights] },
  { id: "L3-R8",  description: "Owe response to whom",           query: "Who do I owe a response to?",                   assert: [{ field: "intent.primary", oneOf: ["relationship", "commitments"] }, hasOpInsights] },
  { id: "L3-R9",  description: "Negative email threads",         query: "Any emotionally negative threads?",             assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L3-R10", description: "More active contacts",           query: "Which contacts became more active?",            assert: [hasOpInsights] },

  // ─── Layer 3 — Task/Commitment Intelligence ────────────────────────────────

  { id: "L3-K1",  description: "Commitments at risk",            query: "What commitments are at risk?",                 assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments, hasOpInsights] },
  { id: "L3-K2",  description: "Tasks slipping",                 query: "What tasks are slipping?",                      assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments, hasOpInsights] },
  { id: "L3-K3",  description: "What is overdue",                query: "What's overdue?",                               assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L3-K4",  description: "Unresolved promises",            query: "What promises are unresolved?",                 assert: [hasSqlCommitments] },
  { id: "L3-K5",  description: "Aging commitments",              query: "Which commitments are aging?",                  assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments, hasOpInsights] },
  { id: "L3-K6",  description: "Approaching deadlines",          query: "What deadlines are approaching?",               assert: [hasSqlCommitments] },
  { id: "L3-K7",  description: "What is blocked",                query: "What's blocked?",                               assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L3-K8",  description: "What to escalate",               query: "What should I escalate?",                       assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasOpInsights] },
  { id: "L3-K9",  description: "Action items without owners",    query: "What action items are missing owners?",         assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments] },
  { id: "L3-K10", description: "Overdue follow-ups",             query: "What follow-ups are overdue?",                  assert: [{ field: "intent.primary", oneOf: ["commitments", "productivity"] }, hasSqlCommitments, hasOpInsights] },

  // ─── Layer 3 — Lifecycle ───────────────────────────────────────────────────

  { id: "L3-L1",  description: "Resolved issues",                query: "What issues got resolved?",                     assert: [{ field: "intent.primary", oneOf: ["operational_summary", "productivity"] }, hasOpInsights] },
  { id: "L3-L2",  description: "Stopped being urgent",           query: "What stopped being urgent?",                    assert: [{ field: "intent.primary", oneOf: ["operational_summary", "productivity", "commitments"] }, hasOpInsights] },
  { id: "L3-L3",  description: "Stale alerts",                   query: "Which alerts are stale?",                       assert: [{ field: "no_crash" }] },
  { id: "L3-L4",  description: "Snoozed items",                  query: "What was snoozed?",                             assert: [{ field: "no_crash" }] },
  { id: "L3-L5",  description: "Reopened items",                 query: "What reopened?",                                assert: [{ field: "no_crash" }] },
  { id: "L3-L6",  description: "Expired insights",               query: "What insights expired?",                        assert: [{ field: "no_crash" }] },
  { id: "L3-L7",  description: "Recurring issues",               query: "What recurring issues keep resurfacing?",       assert: [{ field: "no_crash" }] },
  { id: "L3-L8",  description: "Persistent alerts",              query: "Which alerts are persistent?",                  assert: [{ field: "no_crash" }] },
  { id: "L3-L9",  description: "Auto-resolved items",            query: "What was resolved automatically?",              assert: [hasOpInsights, { field: "no_crash" }] },
  { id: "L3-L10", description: "Recent state changes",           query: "What changed state recently?",                  assert: [hasOpInsights, { field: "no_crash" }] },

  // ─── Layer 4 — Aggregation Queries ────────────────────────────────────────

  { id: "L4-A1",  description: "Last month spending total",      query: "How much did I spend last month?",              assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, { field: "temporal.relativePeriod", eq: "last_month" }, hasAggFinance, hasSqlTxns, invFull] },
  { id: "L4-A2",  description: "Food spending breakdown",        query: "Break down food spending.",                     assert: [{ field: "entities.categories", includes: "food_delivery" }, hasAggFinance, invFull, validCats] },
  { id: "L4-A3",  description: "Top merchants",                  query: "What are my top merchants?",                    assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasAggFinance] },
  { id: "L4-A4",  description: "Month vs last month comparison", query: "Compare this month vs last month.",             assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasAggFinance] },
  { id: "L4-A5",  description: "Weekly spending trend",          query: "What's my weekly spending trend?",              assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasAggFinance] },
  { id: "L4-A6",  description: "Category increase most",         query: "Which category increased the most?",            assert: [{ field: "intent.primary", oneOf: ["spending_analysis", "finance"] }, hasAggFinance] },
  { id: "L4-A7",  description: "Rent percentage",                query: "What percentage went to rent?",                 assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasSqlTxns] },
  { id: "L4-A8",  description: "Monthly travel spend",           query: "Show monthly travel spend.",                    assert: [{ field: "entities.categories", includes: "travel" }, hasAggFinance, validCats] },
  { id: "L4-A9",  description: "Average daily spend",            query: "What's my average daily spend?",                assert: [{ field: "intent.primary", oneOf: ["spending_analysis", "finance"] }, hasAggFinance] },
  { id: "L4-A10", description: "Costliest subscriptions",        query: "Which subscriptions cost the most?",            assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, hasSqlTxns] },

  // ─── Layer 4 — Root Cause / Why Analysis ──────────────────────────────────

  { id: "L4-R1",  description: "Why overspending",               query: "Why am I overspending?",                        assert: [invHigh, opHigh, { field: "weights.investigative", gte: 0.5 }] },
  { id: "L4-R2",  description: "Why food spending up",           query: "Why did food spending increase?",               assert: [{ field: "entities.categories", includes: "food_delivery" }, invHigh, opHigh, validCats] },
  { id: "L4-R3",  description: "Why subscriptions higher",       query: "Why are subscriptions higher?",                 assert: [{ field: "intent.primary", oneOf: ["subscriptions", "spending_analysis"] }, invHigh, opHigh] },
  { id: "L4-R4",  description: "Why travel costs spiked",        query: "Why did travel costs spike?",                   assert: [{ field: "entities.categories", includes: "travel" }, invHigh, opHigh, validCats] },
  { id: "L4-R5",  description: "Why savings lower",              query: "Why is my savings lower?",                      assert: [invHigh, opHigh, { field: "no_crash" }] },
  { id: "L4-R6",  description: "Why meetings increasing",        query: "Why are meetings increasing?",                  assert: [{ field: "intent.primary", oneOf: ["scheduling", "operational_summary"] }, invHigh] },
  { id: "L4-R7",  description: "Why tasks delayed",              query: "Why are tasks getting delayed?",                assert: [invHigh, opHigh, { field: "no_crash" }] },
  { id: "L4-R8",  description: "Why comm volume high",           query: "Why is communication volume high?",             assert: [invHigh, opHigh, { field: "no_crash" }] },
  { id: "L4-R9",  description: "Why entertainment spike",        query: "Why did entertainment spending jump?",          assert: [{ field: "entities.categories", includes: "entertainment" }, invHigh, opHigh, validCats] },
  { id: "L4-R10", description: "Why missing deadlines",          query: "Why am I missing deadlines?",                   assert: [invHigh, opHigh, { field: "no_crash" }] },

  // ─── Layer 4 — Cross-source Investigations ────────────────────────────────

  { id: "L4-X1",  description: "Travel spend post Goa",          query: "Did my travel spending increase after the Goa trip?", assert: [{ field: "entities.categories", includes: "travel" }, hasSqlTxns, validCats] },
  { id: "L4-X2",  description: "Conversations led to expense",   query: "What conversations led to this expense?",       assert: [hasSqlComms, hasSqlTxns, { field: "no_crash" }] },
  { id: "L4-X3",  description: "Meetings before contract pay",   query: "Show meetings before the contract payment.",    assert: [hasSqlMeetings, hasSqlTxns, { field: "no_crash" }] },
  { id: "L4-X4",  description: "Salary effect on spending",      query: "Did salary increase change spending?",          assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L4-X5",  description: "Tasks after investor meetings",  query: "What tasks were created after investor meetings?", assert: [hasSqlMeetings, hasSqlCommitments] },
  { id: "L4-X6",  description: "Commitments from hiring disc",   query: "What commitments came from the hiring discussion?", assert: [hasSqlCommitments, hasSqlComms] },
  { id: "L4-X7",  description: "Subscriptions after job switch", query: "Did subscriptions rise after switching jobs?",  assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, hasSqlTxns] },
  { id: "L4-X8",  description: "Comms around refund",            query: "Show communication around the refund.",         assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L4-X9",  description: "Before missed deadline",         query: "What happened before the missed deadline?",     assert: [hasSqlCommitments, { field: "no_crash" }] },
  { id: "L4-X10", description: "Workload after onboarding",      query: "Did workload increase after onboarding?",       assert: [hasSqlCommitments, hasSqlComms, { field: "no_crash" }] },

  // ─── Layer 4 — Evidence-heavy Fact Retrieval ──────────────────────────────

  { id: "L4-E1",  description: "Rent paid in March",             query: "Did I pay rent in March?",                      assert: [hasSqlTxns, invFull, { field: "temporal", nonNull: true }] },
  { id: "L4-E2",  description: "How many times met Rahul",       query: "How many times did I meet Rahul?",              assert: [{ field: "entities.people", includes: "Rahul" }, hasSqlMeetings, invFull] },
  { id: "L4-E3",  description: "Netflix double charge",          query: "Did Netflix charge twice?",                     assert: [{ field: "entities.merchants", includes: "Netflix" }, hasSqlTxns, invFull] },
  { id: "L4-E4",  description: "Last thing John asked",          query: "What was the last thing John asked?",           assert: [{ field: "entities.people", includes: "John" }, hasSqlComms, invFull] },
  { id: "L4-E5",  description: "Received refund",                query: "Did I receive the refund?",                     assert: [hasSqlTxns, invFull, { field: "no_crash" }] },
  { id: "L4-E6",  description: "Subscription count",             query: "How many subscriptions do I have?",             assert: [{ field: "intent.primary", oneOf: ["subscriptions", "finance"] }, hasSqlTxns] },
  { id: "L4-E7",  description: "Last talked to Dad",             query: "When did I last talk to Dad?",                  assert: [hasSqlComms, invFull, { field: "no_crash" }] },
  { id: "L4-E8",  description: "Layoffs mentioned",              query: "Did anyone mention layoffs?",                   assert: [hasSqlComms, invFull] },
  { id: "L4-E9",  description: "Largest UPI transaction",        query: "What was my largest UPI transaction?",          assert: [hasSqlTxns, invFull] },
  { id: "L4-E10", description: "Insurance paid this quarter",    query: "Did I pay insurance this quarter?",             assert: [hasSqlTxns, invFull, { field: "temporal", nonNull: true }] },

  // ─── Layer 4 — Hybrid Operational + Investigative ─────────────────────────

  { id: "L4-H1",  description: "Know about rent",                query: "What should I know about rent?",                assert: [invHigh, opHigh, hasSqlTxns] },
  { id: "L4-H2",  description: "Overspending on food analytical",query: "Am I overspending on food?",                    assert: [invHigh, opHigh, { field: "entities.categories", includes: "food_delivery" }, validCats] },
  { id: "L4-H3",  description: "Financial risks",                query: "What risks do I have financially?",             assert: [invHigh, opHigh, hasOpInsights] },
  { id: "L4-H4",  description: "Commitments causing stress",     query: "What commitments are causing stress?",          assert: [invHigh, opHigh, hasSqlCommitments] },
  { id: "L4-H5",  description: "Recurring problems to fix",      query: "What recurring problems should I fix?",         assert: [invHigh, opHigh, hasOpInsights] },
  { id: "L4-H6",  description: "Expense habits",                 query: "Which expenses are becoming habits?",           assert: [invHigh, hasSqlTxns] },
  { id: "L4-H7",  description: "Unresolved issues costing money",query: "What unresolved issues cost me money?",         assert: [invHigh, opHigh, hasOpInsights] },
  { id: "L4-H8",  description: "Reduce spending on what",        query: "What should I reduce spending on?",             assert: [invHigh, hasSqlTxns, hasOpInsights] },
  { id: "L4-H9",  description: "Relationships needing attention",query: "Which relationships need attention?",           assert: [{ field: "intent.primary", eq: "relationship" }, hasOpInsights] },
  { id: "L4-H10", description: "Concerning patterns",            query: "What patterns should concern me?",              assert: [invHigh, opHigh, hasOpInsights] },

  // ─── Layer 5 — Robustness / Failure Cases ─────────────────────────────────

  { id: "L5-F1",  description: "Nonsense query",                 query: "asdfghjkl",                                     assert: [{ field: "no_crash" }] },
  { id: "L5-F2",  description: "Pay rent to Netflix",            query: "Did I pay rent to Netflix?",                    assert: [{ field: "entities.merchants", includes: "Netflix" }, hasSqlTxns, { field: "no_crash" }] },
  { id: "L5-F3",  description: "Emails from Mars",               query: "Show emails from Mars.",                        assert: [{ field: "intent.primary", eq: "search_lookup" }, hasSqlComms, { field: "no_crash" }] },
  { id: "L5-F4",  description: "Before nonexistent trip",        query: "What happened before my nonexistent trip?",     assert: [{ field: "no_crash" }] },
  { id: "L5-F5",  description: "Batman conversations",           query: "Find conversations with Batman.",               assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L5-F6",  description: "Spend in 2035",                  query: "How much did I spend in 2035?",                 assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L5-F7",  description: "Salary before birth",            query: "Did I receive salary before birth?",            assert: [{ field: "no_crash" }] },
  { id: "L5-F8",  description: "Alien tasks",                    query: "What tasks did aliens assign me?",              assert: [hasSqlCommitments, { field: "no_crash" }] },

  // ─── Layer 5 — Stress / Scale ─────────────────────────────────────────────

  { id: "L5-S1",  description: "Summarize last year",            query: "Summarize everything from the last year.",      assert: [{ field: "no_crash" }] },
  { id: "L5-S2",  description: "All financial activity",         query: "Show all financial activity.",                  assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L5-S3",  description: "Every mention of insurance",     query: "Find every mention of insurance.",              assert: [hasSqlComms, { field: "no_crash" }] },
  { id: "L5-S4",  description: "Analyze all meetings",           query: "Analyze all my meetings.",                      assert: [hasSqlMeetings, { field: "no_crash" }] },
  { id: "L5-S5",  description: "Patterns across all comms",      query: "What patterns exist across all communications?", assert: [hasSqlComms, hasVectorSearch, { field: "no_crash" }] },
  { id: "L5-S6",  description: "Summarize all commitments",      query: "Summarize every commitment.",                   assert: [hasSqlCommitments, { field: "no_crash" }] },
  { id: "L5-S7",  description: "Every recurring expense",        query: "Show every recurring expense.",                 assert: [hasSqlTxns, { field: "no_crash" }] },
  { id: "L5-S8",  description: "All relationship changes",       query: "What changed across all relationships?",        assert: [{ field: "intent.primary", eq: "relationship" }, hasOpInsights, { field: "no_crash" }] },
  { id: "L5-S9",  description: "Entire spending history",        query: "Analyze my entire spending history.",           assert: [{ field: "intent.primary", oneOf: ["finance", "spending_analysis"] }, hasAggFinance, { field: "no_crash" }] },
  { id: "L5-S10", description: "Complete life dashboard",        query: "Give me a complete life dashboard.",            assert: [hasOpInsights, { field: "no_crash" }] },

  // ─── Layer 5 — Manual only (multi-turn / synthesis quality) ───────────────

  { id: "L5-M1",  type: "manual", description: "Answer only from evidence", query: "Answer only from evidence.", assert: [] },
  { id: "L5-M2",  type: "manual", description: "Context carry-forward flow 1", query: "What did John say about insurance?", assert: [] },
  { id: "L5-M3",  type: "manual", description: "Concise answer tone", query: "Give me a concise answer.", assert: [] },
];
