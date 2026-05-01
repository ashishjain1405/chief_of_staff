export type SenderType =
  | "BANK"
  | "MERCHANT"
  | "WALLET"
  | "UPI"
  | "BILLER"
  | "PAYMENT_GATEWAY"
  | "INVESTMENT_PLATFORM"
  | "UNKNOWN";

const BANK_DOMAINS = new Set([
  "sbi.co.in", "onlinesbi.sbi", "alerts.sbi.co.in", "inb.sbi", "sbicard.com",
  "pnb.co.in", "netpnb.com", "bankofbaroda.in", "bobibanking.com",
  "canarabank.com", "unionbankofindia.co.in", "indianbank.in", "bankofindia.co.in",
  "centralbankofindia.co.in", "ucobank.com", "iob.in",
  "hdfcbank.com", "hdfcbank.net", "alerts.hdfcbank.com",
  "icicibank.com", "icicibankmail.com",
  "axisbank.com", "alerts.axisbank.com",
  "kotak.com", "kotakmahindra.com",
  "indusind.com", "yesbank.in", "idfcfirstbank.com", "aubank.in",
  "rblbank.com", "federalbank.co.in", "southindianbank.com", "ktkbank.com",
  "kvb.co.in", "tmbnet.in", "cityunionbank.com", "dcbbank.com",
  "ujjivansfb.in", "equitasbank.com", "janabank.com", "esafbank.com",
  "suryodaybank.com",
  "americanexpress.com",
  "bajajfinserv.in", "tatacapital.com", "adityabirlafinance.com",
  "lendingkart.com", "navi.com",
]);

const UPI_DOMAINS = new Set([
  "paytm.com",
  "gpay.com", "googlepay.in", "payments.google.com",
  "phonepe.com", "phonepe.in",
]);

const WALLET_DOMAINS = new Set([
  "mobikwik.com", "freecharge.in", "amazonpay.in",
]);

const PAYMENT_GATEWAY_DOMAINS = new Set([
  "razorpay.com", "cashfree.com", "payu.in", "ccavenue.com", "juspay.in",
]);

const INVESTMENT_DOMAINS = new Set([
  "zerodha.com", "coin.zerodha.com", "groww.in", "upstox.com",
  "angelone.in", "5paisa.com", "kuvera.in", "paytmmoney.com",
]);

const FINANCIAL_KEYWORDS = [
  "debited", "credited", "charged", "paid", "payment", "purchase", "purchased",
  "spent", "spend", "spending", "transfer", "transferred", "withdraw", "withdrawal",
  "deposit", "deposited", "refund", "cashback", "reward points",
  "order confirmed", "order placed", "order shipped", "order delivered",
  "booking confirmed", "booking id",
  "invoice", "receipt", "bill", "billed", "billing", "statement", "amount due",
  "outstanding", "balance", "due date", "overdue",
  "subscription", "renewal", "renewed", "renewing", "emi", "instalment",
  "mandate", "auto-debit", "auto-pay", "standing instruction",
  "upi", "neft", "imps", "rtgs", "debit card", "credit card", "wallet", "recharge",
  "transaction",
];

function extractDomain(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : email.toLowerCase();
}

export function classifySender(email: string): SenderType {
  const domain = extractDomain(email);
  if (BANK_DOMAINS.has(domain)) return "BANK";
  if (UPI_DOMAINS.has(domain)) return "UPI";
  if (WALLET_DOMAINS.has(domain)) return "WALLET";
  if (PAYMENT_GATEWAY_DOMAINS.has(domain)) return "PAYMENT_GATEWAY";
  if (INVESTMENT_DOMAINS.has(domain)) return "INVESTMENT_PLATFORM";
  return "UNKNOWN";
}

export function isKnownFinancialDomain(email: string): boolean {
  const domain = extractDomain(email);
  return (
    BANK_DOMAINS.has(domain) ||
    UPI_DOMAINS.has(domain) ||
    WALLET_DOMAINS.has(domain) ||
    PAYMENT_GATEWAY_DOMAINS.has(domain) ||
    INVESTMENT_DOMAINS.has(domain)
  );
}

export function hasFinancialKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return FINANCIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

export function shouldRunStage1(
  emailCategory: string | null,
  subject: string,
  bodySnippet: string
): boolean {
  if (emailCategory === "finance_bills" || emailCategory === "transactions") return true;
  if (hasFinancialKeywords(subject + " " + bodySnippet)) return true;
  return false;
}
