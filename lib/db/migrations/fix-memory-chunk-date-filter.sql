-- match_memory_chunks filtered on mc.created_at, which is when the chunk was
-- inserted, not when the email arrived. executeRetrievalPlan passes
-- daysBack: 90 meaning "the last 90 days of mail", so the filter never did
-- what the caller intended:
--
--   * After a backfill every chunk shares one insertion date, so the window
--     was a no-op and mail of any age was searchable by accident.
--   * Conversely, once chunks age past the window they drop out of semantic
--     search regardless of how recent the underlying email is.
--   * Temporal intent in Ask ("what did they say last year") could never
--     actually constrain vector results.
--
-- metadata->>'occurred_at' is the email's own timestamp and is already written
-- by embedAndStoreChunks and read back by the ranker.
--
-- The regex guard matters: a single malformed date would otherwise raise a
-- cast error and take down semantic search for every query, and this codebase
-- has already shipped date-parsing bugs (DD-MM-YY read as YY-MM-DD). Rows with
-- a missing or unparseable timestamp fall back to created_at rather than
-- disappearing.

CREATE OR REPLACE FUNCTION match_memory_chunks(
  query_embedding vector(1024),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  days_back int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  chunk_text text,
  source_type text,
  source_id uuid,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    mc.id,
    mc.chunk_text,
    mc.source_type,
    mc.source_id,
    mc.metadata,
    1 - (mc.embedding <=> query_embedding) AS similarity
  FROM memory_chunks mc
  WHERE mc.user_id = p_user_id
    AND COALESCE(
          CASE
            WHEN mc.metadata->>'occurred_at' ~ '^\d{4}-\d{2}-\d{2}'
              THEN (mc.metadata->>'occurred_at')::timestamptz
          END,
          mc.created_at
        ) > now() - (days_back || ' days')::interval
    AND 1 - (mc.embedding <=> query_embedding) > match_threshold
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;
