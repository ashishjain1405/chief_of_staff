import OpenAI from "openai";
import type { IntentType } from "../processors/types";
import { INTENT_RULES } from "./rules";

export interface IntentResult {
  primary: IntentType;
  secondary: IntentType[];
  confidence: number;
}

const FALLBACK_INTENT: IntentResult = {
  primary: "operational_summary",
  secondary: [],
  confidence: 0.3,
};

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function regexCandidates(query: string): Map<IntentType, number> {
  const lower = query.toLowerCase();
  const hits = new Map<IntentType, number>();

  for (const rule of INTENT_RULES) {
    const count = rule.patterns.filter((p) => p.test(lower)).length;
    if (count > 0) {
      hits.set(rule.intent, (hits.get(rule.intent) ?? 0) + count);
    }
  }
  return hits;
}

async function classifyWithLLM(
  query: string,
  candidates: IntentType[]
): Promise<IntentResult> {
  const allIntents: IntentType[] = [
    "operational_summary", "finance", "spending_analysis", "commitments",
    "scheduling", "productivity", "relationship", "travel", "search_lookup",
    "subscriptions", "bills_payments", "reminders",
  ];

  const prompt = `Classify this query into 1–3 intent types from the list below.

Query: "${query}"

Regex-suggested candidates: ${candidates.length > 0 ? candidates.join(", ") : "none"}

Available intents:
- operational_summary: daily brief, catch me up, what's important
- finance: transactions, spending, debit/credit, unusual charges
- spending_analysis: spending trends, category breakdown, budget analysis
- commitments: promises made, overdue commitments, what did I say I'd do
- scheduling: meetings, calendar, what's today/tomorrow
- productivity: tasks, action items, priorities, blockers
- relationship: follow-ups, investor/client/contact status
- travel: flights, hotel, booking, itinerary, PNR
- search_lookup: find a specific email/note/document
- subscriptions: subscriptions, renewals, memberships, recurring charges
- bills_payments: bills due, credit card, EMI, payment reminders
- reminders: remind me, don't forget, upcoming alerts

Return ONLY valid JSON: {"primary": "...", "secondary": ["...", "..."], "confidence": 0.0-1.0}
secondary can be empty []. confidence reflects certainty about primary.`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    max_tokens: 100,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw);

  const primary = allIntents.includes(parsed.primary) ? parsed.primary as IntentType : "operational_summary";
  const secondary = (parsed.secondary ?? [])
    .filter((s: string) => allIntents.includes(s as IntentType) && s !== primary)
    .slice(0, 2) as IntentType[];
  const confidence = typeof parsed.confidence === "number"
    ? Math.min(1, Math.max(0, parsed.confidence))
    : 0.7;

  return { primary, secondary, confidence };
}

export async function classifyIntent(query: string): Promise<IntentResult> {
  try {
    const hits = regexCandidates(query);

    if (hits.size === 0) {
      // No regex matches — go straight to LLM
      return await Promise.race([
        classifyWithLLM(query, []),
        new Promise<IntentResult>((resolve) =>
          setTimeout(() => resolve(FALLBACK_INTENT), 1500)
        ),
      ]);
    }

    // Sort candidates by hit count desc — take top 2
    const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]);
    const topCandidates = sorted.slice(0, 2).map(([intent]) => intent);

    // Always confirm with LLM for multi-intent combination queries
    const llmResult = await Promise.race([
      classifyWithLLM(query, topCandidates),
      new Promise<IntentResult>((resolve) =>
        setTimeout(() => {
          // Fallback to regex result if LLM times out
          const primary: IntentType = topCandidates[0] ?? "operational_summary";
          const secondary: IntentType[] = topCandidates.slice(1);
          const maxHits = sorted[0][1];
          const confidence = Math.min(0.95, 0.6 + maxHits * 0.1);
          resolve({ primary, secondary, confidence });
        }, 1500)
      ),
    ]);

    return llmResult;
  } catch {
    return FALLBACK_INTENT;
  }
}

export { FALLBACK_INTENT };
