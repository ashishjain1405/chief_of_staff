-- Migration: Add operational_insights table for persistent AI state engine

CREATE TABLE IF NOT EXISTS operational_insights (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,

  -- Deduplication key (UNIQUE constraint — upsert target)
  state_key text NOT NULL,

  -- Classification
  category text NOT NULL,        -- maps to IntentType: finance, commitments, scheduling, etc.
  insight_type text NOT NULL,    -- spending_spike, overdue_task, stale_relationship, etc.

  -- Content
  title text NOT NULL,
  summary text NOT NULL,
  recommended_action text,
  entities text[] DEFAULT '{}',
  source_refs text[] DEFAULT '{}',

  -- Scoring
  priority_score float NOT NULL DEFAULT 0.5,
  urgency text NOT NULL DEFAULT 'medium', -- critical / high / medium / low

  -- Lifecycle
  status text NOT NULL DEFAULT 'active',  -- active / resolved / snoozed / acknowledged
  first_detected_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  snoozed_until timestamptz,
  expires_at timestamptz,

  -- Provenance
  confidence float DEFAULT 1.0,
  source_count int DEFAULT 1,
  generated_by text,
  explanation text,
  metadata jsonb DEFAULT '{}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, state_key)
);

ALTER TABLE operational_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "operational_insights_own" ON operational_insights
  USING (auth.uid() = user_id);

-- Primary query path: active insights for a user sorted by priority
CREATE INDEX operational_insights_active ON operational_insights
  (user_id, status, priority_score DESC)
  WHERE status = 'active';

-- Category-filtered queries
CREATE INDEX operational_insights_category ON operational_insights
  (user_id, category, status);

-- Expiry/lifecycle queries
CREATE INDEX operational_insights_expires ON operational_insights
  (user_id, expires_at)
  WHERE expires_at IS NOT NULL;
