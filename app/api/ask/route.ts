import { createClient } from "@/lib/supabase/server";
import { searchMemory, getStructuredContext } from "@/lib/memory/search";
import { askSystemPrompt, askContextPrompt } from "@/lib/ai/prompts";
import { streamText, convertToModelMessages, type UIMessage } from "ai";
import { openai } from "@ai-sdk/openai";

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

    const [{ data: userData }, memoryChunks, structured] = await Promise.all([
      supabase.from("users").select("business_context").eq("id", user.id).single(),
      searchMemory({ userId: user.id, query: lastMessageText, matchCount: 15, daysBack: 90 }).catch((e) => {
        console.error("searchMemory failed:", e);
        return [];
      }),
      getStructuredContext(user.id).catch((e) => {
        console.error("getStructuredContext failed:", e);
        return { pendingTasks: [], upcomingMeetings: [], actionableEmails: [], overdueCommitments: [], overdueFollowUps: [], recentTransactions: [], activeSubscriptions: [], travelBookings: [] };
      }),
    ]);

    const systemPrompt = askSystemPrompt(userData?.business_context ?? {});
    const contextBlock = askContextPrompt(
      memoryChunks.map((c) => `[${c.source_type}] ${c.chunk_text}`),
      structured
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
