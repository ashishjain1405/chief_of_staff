-- Who a transfer went to, or came from, read from the bank's alert
-- (lib/finance/recipient.ts): "account …5389", "Hemant Kumar Jain". Bank
-- alerts name no merchant, so without it no rule could match "every transfer
-- to this account". Additive and idempotent.
ALTER TABLE transactions_raw        ADD COLUMN IF NOT EXISTS recipient_key text;
ALTER TABLE transactions_raw        ADD COLUMN IF NOT EXISTS recipient_label text;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS recipient_key text;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS recipient_label text;
