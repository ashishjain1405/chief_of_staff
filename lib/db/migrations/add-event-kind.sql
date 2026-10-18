-- Whether a financial email records money that actually moved.
--   completed   - paid, debited, credited, refunded
--   requested   - owed or asked for: bill due, renewal quote, statement
--   scheduled   - an automatic charge that will happen later
--   failed      - attempted and declined
--   promotional - offers, expiring credit; nothing owed or paid
-- Only 'completed' rows are normalized into transactions_normalized and counted
-- as spend. Before this, renewal reminders were stored as payments: 11
-- PolicyBazaar quotes added ₹44k of spending that never happened.
ALTER TABLE transactions_raw ADD COLUMN IF NOT EXISTS event_kind text;
