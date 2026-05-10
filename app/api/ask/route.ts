import { createClient, createClientWithToken } from "@/lib/supabase/server";
import { classifyIntent, FALLBACK_INTENT } from "@/lib/ai/intent/classify";
import { resolveEntities } from "@/lib/ai/retrieval/resolve";
import { buildRetrievalPlan } from "@/lib/ai/retrieval/plan";
import { executeRetrievalPlan } from "@/lib/ai/retrieval/execute";
import { aggregateTransactions } from "@/lib/ai/retrieval/aggregate";
import { unifiedRank, getRankingProfile, DEFAULT_DIVERSITY_CAPS } from "@/lib/ai/retrieval/rank";
import { decodeConversationContext, updateConversationContext, mergeContextWithIntent } from "@/lib/ai/retrieval/context";
import { buildTrace } from "@/lib/ai/retrieval/trace";
import { askSystemPrompt, askContextPrompt } from "@/lib/ai/prompts";
import { streamText, generateText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: Request) {
  const startTime = Date.now();
  const isEvalMode = new URL(request.url).searchParams.get("eval") === "true";

  try {
    let supabase;
    let user;
    if (isEvalMode) {
      const token = request.headers.get("Authorization")?.replace("Bearer ", "");
      if (!token) return new Response("Unauthorized", { status: 401 });
      supabase = await createClientWithToken(token);
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } else {
      supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      user = data.user;
    }
    if (!user) return new Response("Unauthorized", { status: 401 });

    const body = await request.json();
    const messages: UIMessage[] = body.messages ?? [];

    const lastUserMsg = messages.filter((m) => m.role === "user").at(-1);
    const lastMessageText = lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => (p as any).text ?? "")
      .join("") ?? "";

    // Stage 1: Decode conversational context from prior messages
    const prevContext = decodeConversationContext(messages);

    // Stage 2: Intent + entities + temporal + weights (single gpt-4o-mini call)
    const rawIntent = await classifyIntent(lastMessageText, prevContext).catch(() => FALLBACK_INTENT);
    const intent = mergeContextWithIntent(prevContext, rawIntent);
    const newContext = updateConversationContext(prevContext, intent);

    // Stage 3: Parallel — resolve entities + fetch user context
    const [resolvedResult, userResult] = await Promise.allSettled([
      resolveEntities(intent.entities, intent.temporal, user.id, supabase as any),
      supabase.from("users").select("business_context").eq("id", user.id).single(),
    ]);

    const resolved = resolvedResult.status === "fulfilled"
      ? resolvedResult.value
      : { contactIds: [], merchantNames: [], resolvedDateRange: null, temporalConfidence: 1.0 };

    const userData = userResult.status === "fulfilled"
      ? (userResult.value as any).data
      : null;

    const needsClarification = resolved.temporalConfidence < 0.6;

    // Stage 4: Build plan + execute (budget-capped, allSettled)
    const plan = buildRetrievalPlan(intent, resolved, lastMessageText);
    const { rawResults, sourceStatuses, budgetExhausted } = await executeRetrievalPlan(
      plan, user.id, lastMessageText, supabase
    );

    // Stage 5: Structured aggregation (if finance aggregation step is in plan)
    const needsAggregation = plan.some((s) => s.source === "aggregated_finance");
    const aggregated = needsAggregation
      ? await aggregateTransactions(user.id, {
          dateRange: resolved.resolvedDateRange,
          categories: intent.entities.categories,
          merchantNames: resolved.merchantNames,
        }, supabase).catch(() => null)
      : null;

    // Record aggregated_finance in sourceStatuses so trace reflects real count
    // Remove any placeholder entry from executeRetrievalPlan (it falls through to default: return [])
    if (needsAggregation) {
      const idx = sourceStatuses.findIndex((s) => s.source === "aggregated_finance");
      if (idx !== -1) sourceStatuses.splice(idx, 1);
      sourceStatuses.push({
        source: "aggregated_finance",
        count: aggregated?.transaction_count ?? 0,
        success: aggregated !== null,
      });
    }

    // Stage 6: Unified ranking — single pass over all sources
    const rankingProfile = getRankingProfile(intent.primary);
    const rankedItems = unifiedRank(
      rawResults,
      aggregated,
      lastMessageText,
      intent.entities,
      intent.temporal,
      rankingProfile,
      DEFAULT_DIVERSITY_CAPS,
      20
    );

    // Stage 7: Trace (dev logging)
    const trace = buildTrace(
      lastMessageText, intent, plan, sourceStatuses, rankedItems, startTime, budgetExhausted
    );
    console.log("[ask-trace]", JSON.stringify(trace));

    // Stage 8: Build prompt + stream
    const clarificationNote = needsClarification
      ? "The time reference in the query is ambiguous. Ask the user to clarify the time period if needed."
      : undefined;

    const systemPrompt = askSystemPrompt(userData?.business_context ?? {}, clarificationNote);
    const contextBlock = askContextPrompt(rankedItems, intent);

    const modelMessages = await convertToModelMessages(messages);

    if (isEvalMode) {
      const { text } = await generateText({
        model: openai("gpt-4o"),
        system: `${systemPrompt}\n\n${contextBlock}`,
        messages: modelMessages,
        maxOutputTokens: 1024,
      });
      return Response.json({ response: text, trace });
    }

    const result = streamText({
      model: openai("gpt-4o"),
      system: `${systemPrompt}\n\n${contextBlock}`,
      messages: modelMessages,
      maxOutputTokens: 1024,
    });

    // Attach context metadata to response for next-turn retrieval
    // Frontend should store this and send it back in subsequent messages
    const response = result.toUIMessageStreamResponse();
    response.headers.set(
      "X-Assistant-Context",
      JSON.stringify({ context: newContext, sources_used: sourceStatuses.filter(s => s.success).map(s => s.source) })
    );
    return response;
  } catch (e) {
    console.error("Ask AI route error:", e);
    return new Response(String(e), { status: 500 });
  }
}
