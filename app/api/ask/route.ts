import { createClient } from "@/lib/supabase/server";
import { searchMemory } from "@/lib/memory/search";
import { askSystemPrompt, askContextPrompt } from "@/lib/ai/prompts";
import { classifyIntent, FALLBACK_INTENT, type IntentResult } from "@/lib/ai/intent/classify";
import { rankInsights } from "@/lib/ai/processors/rank";
import type { IntentType } from "@/lib/ai/processors/types";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";

const FINANCE_INTENTS = new Set<IntentType>(["finance", "spending_analysis", "subscriptions", "bills_payments"]);
const RELATIONSHIP_INTENTS = new Set<IntentType>(["relationship"]);
const VECTOR_INTENTS = new Set<IntentType>(["operational_summary", "search_lookup", "relationship", "commitments", "travel"]);

function activeIntentSet(intent: IntentResult): Set<IntentType> {
  return new Set([intent.primary, ...intent.secondary] as IntentType[]);
}

function needsVectorSearch(intent: IntentResult): boolean {
  const active = activeIntentSet(intent);
  return [...active].some((i) => VECTOR_INTENTS.has(i));
}

function intentToCategories(intent: IntentResult): string[] {
  const active = activeIntentSet(intent);
  const categories: string[] = [];

  const CATEGORY_MAP: Partial<Record<IntentType, string[]>> = {
    finance: ["finance", "spending_analysis"],
    spending_analysis: ["spending_analysis", "finance"],
    commitments: ["commitments", "productivity"],
    scheduling: ["scheduling"],
    productivity: ["productivity", "commitments"],
    relationship: ["relationship"],
    travel: ["travel", "scheduling"],
    subscriptions: ["subscriptions", "finance"],
    bills_payments: ["bills_payments", "finance"],
    reminders: ["reminders", "scheduling", "commitments"],
    operational_summary: [],
    search_lookup: [],
  };

  for (const intent of active) {
    const mapped = CATEGORY_MAP[intent] ?? [];
    categories.push(...mapped);
  }

  return [...new Set(categories)];
}

async function fetchOperationalInsights(intent: IntentResult, userId: string, supabase: any) {
  const isOperationalSummary = intent.primary === "operational_summary";
  const categories = intentToCategories(intent);

  let query = supabase
    .from("operational_insights")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
    .order("priority_score", { ascending: false })
    .limit(30);

  // For specific intents, filter to relevant categories
  // operational_summary and search_lookup get everything
  if (!isOperationalSummary && categories.length > 0) {
    query = query.in("category", categories);
  }

  const { data, error } = await query;
  if (error) {
    console.error("fetchOperationalInsights error:", error);
    return [];
  }
  return data ?? [];
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const body = await request.json();
    const messages: UIMessage[] = body.messages ?? [];

    const lastUserMsg = messages.filter((m) => m.role === "user").at(-1);
    const lastMessageText = lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as any).text ?? "")
      .join("") ?? "";

    // Stage 1: Intent classification (with timeout fallback)
    const intent = await classifyIntent(lastMessageText).catch(() => FALLBACK_INTENT);

    // Stage 2: Parallel fetch — precomputed insights + optional vector search
    const [{ data: userData }, rawInsights, vectorChunks] = await Promise.all([
      supabase.from("users").select("business_context").eq("id", user.id).single(),

      fetchOperationalInsights(intent, user.id, supabase).catch((e) => {
        console.error("fetchOperationalInsights failed:", e);
        return [];
      }),

      needsVectorSearch(intent)
        ? searchMemory({ userId: user.id, query: lastMessageText, matchCount: 12, daysBack: 90 }).catch((e) => {
            console.error("searchMemory failed:", e);
            return [];
          })
        : Promise.resolve([]),
    ]);

    // Stage 3: Rank insights (already scored — just sort and truncate)
    const rankedInsights = rankInsights(rawInsights, 15);

    // Stage 4: Build context prompt + stream
    const systemPrompt = askSystemPrompt(userData?.business_context ?? {});
    const contextBlock = askContextPrompt(
      rankedInsights,
      vectorChunks.map((c) => `[${c.source_type}] ${c.chunk_text}`),
      intent
    );

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openai("gpt-4o"),
      system: `${systemPrompt}\n\n${contextBlock}`,
      messages: modelMessages,
      maxOutputTokens: 1024,
    });

    return result.toUIMessageStreamResponse();
  } catch (e) {
    console.error("Ask AI route error:", e);
    return new Response(String(e), { status: 500 });
  }
}
