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

export function countsAsSpend(t: { transaction_type?: string | null; merchant_normalized?: string | null }): boolean {
  return !isCardBillPayment(t);
}
