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
    matchThreshold = 0.75,
    matchCount = 15,
    daysBack = 30,
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

export async function getStructuredContext(userId: string) {
  const now = new Date();
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [tasks, meetings, emails, commitments, followUps] = await Promise.all([
    getSupabase()
      .from("tasks")
      .select("title, description, due_date, priority, ai_reasoning")
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("due_date", in3Days)
      .order("due_date")
      .limit(10),

    getSupabase()
      .from("meetings")
      .select("title, start_time, end_time, attendees")
      .eq("user_id", userId)
      .gte("start_time", now.toISOString())
      .lte("start_time", in24h)
      .order("start_time")
      .limit(5),

    getSupabase()
      .from("communications")
      .select("subject, body_summary, occurred_at, sentiment, channel_metadata")
      .eq("user_id", userId)
      .eq("requires_action", true)
      .eq("action_taken", false)
      .order("importance_score", { ascending: false })
      .limit(5),

    getSupabase()
      .from("commitments")
      .select("description, due_date, to_contact_id, contacts(name, email)")
      .eq("user_id", userId)
      .in("status", ["pending", "overdue"])
      .lte("due_date", in7Days)
      .order("due_date")
      .limit(5),

    getSupabase()
      .from("relationships")
      .select("category, follow_up_due, contacts(name, email)")
      .eq("user_id", userId)
      .lte("follow_up_due", now.toISOString())
      .order("follow_up_due")
      .limit(5),
  ]);

  return {
    pendingTasks: tasks.data ?? [],
    upcomingMeetings: meetings.data ?? [],
    actionableEmails: emails.data ?? [],
    overdueCommitments: commitments.data ?? [],
    overdueFollowUps: followUps.data ?? [],
  };
}
