-- Categories the founder creates on the Finance page ("Family", "Office
-- supplies"), alongside the built-in ones. key is what transactions and rules
-- store in their category column - a plain slug, never one of the built-in
-- keys - and label is how it is shown. Additive and idempotent.
CREATE TABLE IF NOT EXISTS user_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, key)
);
CREATE UNIQUE INDEX IF NOT EXISTS user_categories_label ON user_categories (user_id, lower(label));

ALTER TABLE user_categories ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_categories' AND policyname = 'user_categories_own') THEN
    CREATE POLICY "user_categories_own" ON user_categories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_categories_updated_at') THEN
    CREATE TRIGGER user_categories_updated_at BEFORE UPDATE ON user_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
