-- The founder's own categories and counting decisions, per transaction and as
-- rules for a merchant or UPI payee. Additive and idempotent: existing rows
-- keep their category, marked automatic, and count exactly as before.
--
-- category stays the category that applies, so every reader - including Ask
-- AI's SQL category filters - sees the founder's choice with no change.
--   category_auto     what extraction and the merchant dictionary gave; a reset
--                     or a deleted rule returns to it
--   category_source   'auto' | 'rule' | 'user'  - regrouping never overwrites 'user'
--   counted_override  null = the spend rules decide; true = count; false = don't
--   counted_source    'rule' | 'user' when counted_override is set
--   upi_key           the payee's UPI handle as tail + provider ("4694@ybl"), so
--                     "9773774694@ybl" and "******4694@ybl" are one payee

ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS category_auto text;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS category_source text NOT NULL DEFAULT 'auto';
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS counted_override boolean;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS counted_source text;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS upi_key text;
UPDATE transactions_normalized SET category_auto = category WHERE category_auto IS NULL;

CREATE TABLE IF NOT EXISTS transaction_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_type  text NOT NULL CHECK (match_type IN ('merchant', 'upi', 'recipient')),
  match_key   text NOT NULL,
  label       text NOT NULL,   -- shown in "Your rules": "BookMyShow", "UPI …4694@ybl"
  category    text,            -- null: the rule does not set the category
  counted     boolean,         -- null: the rule does not set counting
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, match_type, match_key)
);

ALTER TABLE transaction_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_rules' AND policyname = 'transaction_rules_own') THEN
    CREATE POLICY "transaction_rules_own" ON transaction_rules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transaction_rules_updated_at') THEN
    CREATE TRIGGER transaction_rules_updated_at BEFORE UPDATE ON transaction_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
