import { createClient } from "@/lib/supabase/server";
import { searchMemory, getStructuredContext } from "@/lib/memory/search";
import { askSystemPrompt, askContextPrompt } from "@/lib/ai/prompts";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }> =
    body.messages ?? [];

  const lastUserMsg = messages.filter((m) => m.role === "user").at(-1);
  const lastMessageText =
    lastUserMsg?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("") ?? "";

  const { data: userData } = await supabase
    .from("users")
    .select("business_context")
    .eq("id", user.id)
    .single();

  const [memoryChunks, structured] = await Promise.all([
    searchMemory({ userId: user.id, query: lastMessageText, matchCount: 15 }),
    getStructuredContext(user.id),
  ]);

  const systemPrompt = askSystemPrompt(userData?.business_context ?? {});
  const contextBlock = askContextPrompt(
    memoryChunks.map((c) => `[${c.source_type}] ${c.chunk_text}`),
    structured
  );

  const coreMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        m.parts
          ?.filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("") ?? "",
    }));

  const result = streamText({
    model: openai("gpt-4o"),
    system: `${systemPrompt}\n\n${contextBlock}`,
    messages: coreMessages,
    maxOutputTokens: 1024,
  });

  return result.toTextStreamResponse();
}
