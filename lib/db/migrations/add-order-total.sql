-- The full value of an order paid partly from store credit, a gift card or a
-- wallet balance (Myntra Credit, Zomato Money). amount stays what the card,
-- bank or UPI was charged, so it still matches the card alert; spending counts
-- the larger of the two (lib/finance/spend). Additive and idempotent.
ALTER TABLE transactions_raw        ADD COLUMN IF NOT EXISTS order_total numeric;
ALTER TABLE transactions_normalized ADD COLUMN IF NOT EXISTS order_total numeric;
