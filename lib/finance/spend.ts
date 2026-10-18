// Paying a credit-card bill settles purchases already counted when they were
// made, so counting it double-counts them. But the extractor labels a purchase
// made WITH the card ("debited from your Credit Card towards ZOMATO") as
// credit_card_payment too - 104 of 110 such rows were purchases. Excluding the
// type wholesale hid ₹1.45 lakh of real spending, Zomato included. A bill
// payment is the one with no merchant, or the bank itself as the merchant.
// Short names only as the whole merchant: a prefix match took "HDFC ERGO GIC",
// an insurance premium, for the bank.
const BANK = /\bbank\b|^(sbi|pnb|icici|hdfc|axis|kotak|amex|american express|indusind|idfc|rbl)$/i;

export function isCardBillPayment(t: { transaction_type?: string | null; merchant_normalized?: string | null }): boolean {
  if (t.transaction_type !== "credit_card_payment") return false;
  return !t.merchant_normalized || BANK.test(t.merchant_normalized.trim());
}

export function countsAsSpend(t: { transaction_type?: string | null; merchant_normalized?: string | null; status?: string | null }): boolean {
  return !isCardBillPayment(t) && !isFailedTransaction(t);
}

// status is free text from extraction, so a failure arrives as "failed",
// "declined", "Cancelled"… The pages filtered with .neq("status", "failed"),
// which in SQL also drops every row whose status is NULL - ₹2.14 lakh of the
// last 30 days vanished that way, while Ask AI, with no filter, counted even
// the failed ones. Matched in code instead, so NULL means "no failure noted".
const FAILED = /^(failed|declined|cancell?ed|rejected|unsuccessful|reversed|(payment|transaction) (failed|declined))$/i;

export function isFailedTransaction(t: { status?: string | null }): boolean {
  return !!t.status && FAILED.test(t.status.trim());
}
