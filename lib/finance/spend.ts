// Transaction types that are not spending. Paying a credit-card bill settles
// purchases already counted when they were made on the card, so including it
// counted them twice - card payments were 31% of the 30-day total.
const NOT_SPEND = new Set(["credit_card_payment"]);

export function countsAsSpend(t: { transaction_type?: string | null }): boolean {
  return !NOT_SPEND.has(t.transaction_type ?? "");
}
