import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

let _openai: OpenAI | null = null;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function embedText(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 1024,
  });
  return res.data[0].embedding;
}

// Chunk text into ~512 token windows (approx 4 chars/token)
export function chunkText(text: string, chunkSize = 2048, overlap = 200): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    start += chunkSize - overlap;
  }
  return chunks.filter((c) => c.length > 50);
}

export async function embedAndStoreChunks(params: {
  userId: string;
  sourceType: string;
  sourceId: string;
  text: string;
  metadata?: Record<string, any>;
}) {
  const { userId, sourceType, sourceId, text, metadata = {} } = params;
  const chunks = chunkText(text);

  // Delete old chunks for this source (re-embedding on update)
  await getSupabase()
    .from("memory_chunks")
    .delete()
    .eq("user_id", userId)
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i]);
    await getSupabase().from("memory_chunks").insert({
      user_id: userId,
      source_type: sourceType,
      source_id: sourceId,
      chunk_text: chunks[i],
      chunk_index: i,
      embedding,
      metadata,
    });
  }
}

export async function updateCommunicationEmbedding(commId: string, text: string) {
  const embedding = await embedText(text);
  await getSupabase()
    .from("communications")
    .update({ embedding })
    .eq("id", commId);
}

export async function updateMeetingEmbedding(meetingId: string, text: string) {
  const embedding = await embedText(text);
  await getSupabase()
    .from("meetings")
    .update({ embedding })
    .eq("id", meetingId);
}
