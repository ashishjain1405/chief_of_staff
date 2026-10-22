// What counts as spending, shared by the finance pages, the spend API, Ask AI
// and the finance insights so they can never disagree.
//
// Totals once summed every transaction type, so moving money was reported as
// spending it: a ₹3 lakh bank transfer became "your largest spend", and ₹13
// lakh of September's ₹16.4 lakh was transfers. Money that only moves between
// your own accounts, into investments or back to a lender is not spending.
const NOT_SPEND: Record<string, string> = {
  bank_transfer: "transfer",
  p2p_transfer: "transfer",
  wallet_topup: "wallet top-up",
  atm_withdrawal: "cash withdrawal",
  investment: "investment",
  loan_payment: "loan payment",
  emi: "loan payment",
  salary_credit: "income",
  mandate_setup: "mandate setup",
};

// Money coming back reduces spending rather than adding to it.
const CREDITS = new Set(["refund", "cashback"]);

// Paying a credit-card bill settles purchases already counted when they were
// made. But the extractor labels a purchase made WITH the card ("debited from
// your Credit Card towards ZOMATO") credit_card_payment too - 104 of 110 such
// rows were purchases. A bill payment is the one with no merchant, or the bank
// itself as the merchant. Short names only as the whole merchant: a prefix
// match took "HDFC ERGO GIC", an insurance premium, for the bank.
const BANK = /\bbank\b|^(sbi|pnb|icici|hdfc|axis|kotak|amex|american express|indusind|idfc|rbl)$/i;

// Buying a gift voucher only moves money into a balance, like a wallet top-up.
// It is spent when the voucher is: an Uber voucher from GYFTR became Uber Cash
// rides, which count as transport. Counting both put about ₹52k of Aug-Oct
// spending in twice.
const VOUCHER_SELLERS = new Set(["GYFTR"]);

// status is free text from extraction, so a failure arrives as "failed",
// "declined", "Cancelled"… The pages filtered with .neq("status", "failed"),
// which in SQL also drops every row whose status is NULL. Matched in code
// instead, so NULL means "no failure noted".
const FAILED = /^(failed|declined|cancell?ed|rejected|unsuccessful|reversed|(payment|transaction) (failed|declined))$/i;

type Txn = { transaction_type?: string | null; merchant_normalized?: string | null; status?: string | null; amount?: number | string | null; category?: string | null };

export function isFailedTransaction(t: { status?: string | null }): boolean {
  return !!t.status && FAILED.test(t.status.trim());
}

export function isCardBillPayment(t: Txn): boolean {
  if (t.transaction_type !== "credit_card_payment") return false;
  return !t.merchant_normalized || BANK.test(t.merchant_normalized.trim());
}

// Why a row is left out of spending, or null if it counts.
export function notSpendReason(t: Txn): string | null {
  if (isFailedTransaction(t)) return "failed";
  if (isCardBillPayment(t)) return "card bill payment";
  if (VOUCHER_SELLERS.has(t.merchant_normalized?.trim() ?? "")) return "gift voucher";
  // The type alone misses investments paid another way: an IPO application by
  // UPI to NSE was a "upi_payment" and an ETF buy a "purchase", both counted as
  // spending, and dividends typed "refund" were subtracted from it. Extraction
  // gets the category right, so it decides.
  if (t.category === "investments") return "investment";
  return NOT_SPEND[t.transaction_type ?? ""] ?? null;
}

export function countsAsSpend(t: Txn): boolean {
  return notSpendReason(t) === null;
}

// Signed contribution to spending: positive for spend, negative for refunds
// and cashback, zero for anything that is not spending.
export function spendAmount(t: Txn): number {
  if (!countsAsSpend(t)) return 0;
  const amount = Number(t.amount ?? 0);
  return CREDITS.has(t.transaction_type ?? "") ? -amount : amount;
}
