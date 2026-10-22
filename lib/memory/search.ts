import { createClient } from "@supabase/supabase-js";
import { embedText } from "./embed";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface MemoryChunk {
  id: string;
  chunk_text: string;
  source_type: string;
  source_id: string;
  metadata: Record<string, any>;
  similarity: number;
}

// Exported so the calibration eval measures the value actually in use.
export const DEFAULT_MATCH_THRESHOLD = 0.4;

export async function searchMemory(params: {
  userId: string;
  query: string;
  matchThreshold?: number;
  matchCount?: number;
  daysBack?: number;
}): Promise<MemoryChunk[]> {
  const {
    userId,
    query,
    // Calibrated against this corpus, not guessed: known-relevant chunks score
    // 0.65-0.86 for specific queries but only ~0.53 median (p25 0.44) once the
    // query is vague, which is how people actually search. At 0.5 only 8/18
    // vague queries could reach their answer; at 0.4 it is 13/18, and 0.4 is
    // the lowest value where abstract queries ("what should I focus on today")
    // still correctly return nothing - they top out at 0.393.
    //
    // Going lower trades recall for noise, and precision is already handled
    // downstream: vector_search is capped at 2 items and the ranker blends
    // similarity, so a weak chunk competes for 2 of 20 prompt slots. A chunk
    // filtered out here can never be ranked at all.
    //
    // Re-derive with: npm run eval:retrieval
    matchThreshold = DEFAULT_MATCH_THRESHOLD,
    matchCount = 15,
    daysBack = 90,
  } = params;

  const embedding = await embedText(query);

  const { data, error } = await getSupabase().rpc("match_memory_chunks", {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_user_id: userId,
    days_back: daysBack,
  });

  if (error) throw error;
  return data ?? [];
}
