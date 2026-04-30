-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────
-- USERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  onboarding_complete boolean DEFAULT false,
  business_context jsonb DEFAULT '{}',
  preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_own') THEN
    CREATE POLICY "users_own" ON users USING (auth.uid() = id);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- INTEGRATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[],
  external_account_id text,
  webhook_id text,
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'integrations' AND policyname = 'integrations_own') THEN
    CREATE POLICY "integrations_own" ON integrations USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- RAW EVENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source text NOT NULL,
  event_type text NOT NULL,
  external_id text NOT NULL,
  raw_payload jsonb NOT NULL,
  processed boolean DEFAULT false,
  processing_attempts int DEFAULT 0,
  processing_error text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, source, external_id)
);

ALTER TABLE raw_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'raw_events' AND policyname = 'raw_events_own') THEN
    CREATE POLICY "raw_events_own" ON raw_events USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS raw_events_unprocessed ON raw_events (user_id, processed, created_at) WHERE processed = false;

-- ─────────────────────────────────────────
-- CONTACTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  organization text,
  title text,
  relationship_type text,
  importance_score float DEFAULT 0.5,
  last_interaction_at timestamptz,
  interaction_count int DEFAULT 0,
  notes text,
  tags text[],
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, email)
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'contacts_own') THEN
    CREATE POLICY "contacts_own" ON contacts USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS contacts_importance ON contacts (user_id, importance_score DESC);
CREATE INDEX IF NOT EXISTS contacts_last_interaction ON contacts (user_id, last_interaction_at DESC);

-- ─────────────────────────────────────────
-- COMMUNICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  thread_id text,
  contact_id uuid REFERENCES contacts,
  subject text,
  body text,
  body_summary text,
  direction text,
  channel_metadata jsonb DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  is_read boolean DEFAULT false,
  requires_action boolean DEFAULT false,
  action_taken boolean DEFAULT false,
  importance_score float,
  sentiment text,
  embedding vector(1024),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, source, external_id)
);

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'communications' AND policyname = 'communications_own') THEN
    CREATE POLICY "communications_own" ON communications USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS communications_action ON communications (user_id, requires_action, occurred_at DESC) WHERE requires_action = true AND action_taken = false;
CREATE INDEX IF NOT EXISTS communications_occurred ON communications (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS communications_embedding_hnsw ON communications USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

-- ─────────────────────────────────────────
-- MEETINGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  title text,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  attendees jsonb DEFAULT '[]',
  location text,
  meeting_url text,
  recording_url text,
  transcript text,
  transcript_summary text,
  action_items jsonb DEFAULT '[]',
  decisions jsonb DEFAULT '[]',
  follow_ups_generated boolean DEFAULT false,
  status text DEFAULT 'scheduled',
  metadata jsonb DEFAULT '{}',
  embedding vector(1024),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, source, external_id)
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meetings' AND policyname = 'meetings_own') THEN
    CREATE POLICY "meetings_own" ON meetings USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS meetings_time ON meetings (user_id, start_time);
CREATE INDEX IF NOT EXISTS meetings_embedding_hnsw ON meetings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

-- ─────────────────────────────────────────
-- TASKS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  source_type text,
  source_id uuid,
  contact_id uuid REFERENCES contacts,
  due_date timestamptz,
  priority text DEFAULT 'medium',
  status text DEFAULT 'pending',
  snoozed_until timestamptz,
  reminder_sent_at timestamptz,
  ai_reasoning text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'tasks_own') THEN
    CREATE POLICY "tasks_own" ON tasks USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tasks_pending ON tasks (user_id, status, due_date) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS tasks_snoozed ON tasks (user_id, snoozed_until) WHERE status = 'snoozed';

-- ─────────────────────────────────────────
-- RELATIONSHIPS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationships (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts ON DELETE CASCADE,
  category text NOT NULL,
  health_score float DEFAULT 0.5,
  follow_up_cadence_days int DEFAULT 14,
  follow_up_due timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, contact_id, category)
);

ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'relationships' AND policyname = 'relationships_own') THEN
    CREATE POLICY "relationships_own" ON relationships USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS relationships_followup ON relationships (user_id, follow_up_due);
CREATE INDEX IF NOT EXISTS relationships_category ON relationships (user_id, category, health_score DESC);

-- ─────────────────────────────────────────
-- COMMITMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commitments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  description text NOT NULL,
  to_contact_id uuid REFERENCES contacts,
  source_type text,
  source_id uuid,
  due_date timestamptz,
  status text DEFAULT 'pending',
  extracted_by text DEFAULT 'ai',
  ai_confidence float,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'commitments' AND policyname = 'commitments_own') THEN
    CREATE POLICY "commitments_own" ON commitments USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS commitments_pending ON commitments (user_id, status, due_date) WHERE status IN ('pending', 'overdue');

-- ─────────────────────────────────────────
-- MEMORY CHUNKS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_chunks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id uuid,
  chunk_text text NOT NULL,
  chunk_index int DEFAULT 0,
  embedding vector(1024),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE memory_chunks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_chunks' AND policyname = 'memory_chunks_own') THEN
    CREATE POLICY "memory_chunks_own" ON memory_chunks USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS memory_chunks_source ON memory_chunks (user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS memory_chunks_recent ON memory_chunks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw ON memory_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

-- ─────────────────────────────────────────
-- BUSINESS ENTITIES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_entities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  entity_type text NOT NULL,
  name text NOT NULL,
  status text,
  description text,
  owner_contact_id uuid REFERENCES contacts,
  last_mentioned_at timestamptz,
  mention_count int DEFAULT 1,
  metadata jsonb DEFAULT '{}',
  embedding vector(1024),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE business_entities ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'business_entities' AND policyname = 'business_entities_own') THEN
    CREATE POLICY "business_entities_own" ON business_entities USING (auth.uid() = user_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS business_entities_name ON business_entities (user_id, entity_type, name);

-- ─────────────────────────────────────────
-- DAILY BRIEFS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_briefs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  brief_date date NOT NULL,
  content jsonb DEFAULT '{}',
  raw_markdown text,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, brief_date)
);

ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_briefs' AND policyname = 'daily_briefs_own') THEN
    CREATE POLICY "daily_briefs_own" ON daily_briefs USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- DRAFTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  communication_id uuid NOT NULL REFERENCES communications ON DELETE CASCADE,
  draft_text text NOT NULL,
  status text DEFAULT 'pending_review',
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'drafts' AND policyname = 'drafts_own') THEN
    CREATE POLICY "drafts_own" ON drafts USING (auth.uid() = user_id);
  END IF;
END $$;

-- ─────────────────────────────────────────
-- UPDATED_AT triggers
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at') THEN
    CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'integrations_updated_at') THEN
    CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'contacts_updated_at') THEN
    CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'communications_updated_at') THEN
    CREATE TRIGGER communications_updated_at BEFORE UPDATE ON communications FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'meetings_updated_at') THEN
    CREATE TRIGGER meetings_updated_at BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tasks_updated_at') THEN
    CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'relationships_updated_at') THEN
    CREATE TRIGGER relationships_updated_at BEFORE UPDATE ON relationships FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'commitments_updated_at') THEN
    CREATE TRIGGER commitments_updated_at BEFORE UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'business_entities_updated_at') THEN
    CREATE TRIGGER business_entities_updated_at BEFORE UPDATE ON business_entities FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ─────────────────────────────────────────
-- Auto-create user profile on signup
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION handle_new_user();
  END IF;
END $$;

-- ─────────────────────────────────────────
-- Vector search helper function
-- ─────────────────────────────────────────
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
    AND mc.created_at > now() - (days_back || ' days')::interval
    AND 1 - (mc.embedding <=> query_embedding) > match_threshold
  ORDER BY mc.embedding <=> query_embedding
  LIMIT match_count;
$$;
