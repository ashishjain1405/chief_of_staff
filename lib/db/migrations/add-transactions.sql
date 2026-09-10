-- Finance tables and the inbox category-count RPC.
--
-- These three objects were created directly in the Supabase dashboard and never
-- committed, so they existed only in the live instance. Reconstructed here from
-- how the code reads and writes them (worker/jobs/summarize-communication.ts,
-- lib/finance/dedup.ts, app/(dashboard)/inbox/page.tsx) after a disk-full crash
-- made the instance unrecoverable. Column types follow the writes; the uuid[]
-- types and the unique index below match what the live table had.

-- One row per financial email. Upserted on communication_id, so re-processing an
-- email overwrites rather than duplicating.
CREATE TABLE IF NOT EXISTS transactions_raw (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  communication_id    uuid NOT NULL UNIQUE REFERENCES communications(id) ON DELETE CASCADE,
  is_financial_email  boolean NOT NULL DEFAULT false,
  confidence          numeric,
  transaction_type    text,
  category            text,
  amount              numeric,
  currency            text DEFAULT 'INR',
  merchant_name       text,
  merchant_normalized text,
  bank_name           text,
  payment_method      text,
  transaction_datetime timestamptz,
  due_date            timestamptz,
  transaction_id      text,
  reference_id        text,
  upi_id              text,
  masked_account      text,
  is_recurring        boolean NOT NULL DEFAULT false,
  recurring_frequency text,
  status              text,
  sender_type         text,
  raw_sender          text,
  -- Set when signals conflict (e.g. "not financial" but an amount was found).
  -- Dedup deliberately ignores these rows.
  needs_review        boolean NOT NULL DEFAULT false,
  extracted_at        timestamptz DEFAULT now(),
  created_at          timestamptz DEFAULT now()
);

-- runDedup scans by user + these flags within a datetime window.
CREATE INDEX IF NOT EXISTS transactions_raw_dedup_scan
  ON transactions_raw (user_id, is_financial_email, needs_review, transaction_datetime);

-- One row per real-world transaction, after grouping the raw rows that describe
-- it (bank alert + merchant receipt + UPI confirmation are one purchase).
CREATE TABLE IF NOT EXISTS transactions_normalized (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_source      text,
  merchant_normalized text,
  amount              numeric NOT NULL,
  currency            text NOT NULL DEFAULT 'INR',
  category            text,
  transaction_type    text,
  transaction_datetime timestamptz NOT NULL,
  is_recurring        boolean NOT NULL DEFAULT false,
  recurring_frequency text,
  status              text,
  raw_transaction_ids uuid[] NOT NULL DEFAULT '{}',
  communication_ids   uuid[] NOT NULL DEFAULT '{}',
  -- Lets the UI distinguish a transaction corroborated by two sources from a
  -- single-source guess.
  merchant_email_present boolean NOT NULL DEFAULT false,
  bank_email_present     boolean NOT NULL DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_normalized_user_time
  ON transactions_normalized (user_id, transaction_datetime DESC);

-- One normalized transaction per (user, set of source emails). Without this, a
-- check-then-insert race produced 694 duplicate rows out of 729, inflating the
-- finance dashboard roughly 20x. Partial because seeded eval fixtures have empty
-- communication_ids and would otherwise collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_txn_normalized_source
  ON transactions_normalized (user_id, communication_ids)
  WHERE communication_ids IS NOT NULL
    AND array_length(communication_ids, 1) > 0;

-- Sidebar counts per email_category. Done as an RPC so the inbox page gets all
-- counts in one round trip instead of one query per category.
CREATE OR REPLACE FUNCTION get_category_counts(p_user_id uuid)
RETURNS TABLE (email_category text, cnt bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT c.email_category, count(*) AS cnt
  FROM communications c
  WHERE c.user_id = p_user_id
    AND c.email_category IS NOT NULL
  GROUP BY c.email_category;
$$;

ALTER TABLE transactions_raw        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions_normalized ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own transactions_raw" ON transactions_raw
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "own transactions_normalized" ON transactions_normalized
  FOR ALL USING (auth.uid() = user_id);
