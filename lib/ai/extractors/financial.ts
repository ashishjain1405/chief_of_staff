import OpenAI from "openai";
import { z } from "zod";
import type { SenderType } from "@/lib/finance/senders";

const financialExtractionSchema = z.object({
  is_financial_email: z.boolean(),
  confidence: z.number().min(0).max(1),
  transaction: z
    .object({
      // Whether money actually moved. Payment reminders are financial emails,
      // and without this field every renewal quote became a "payment": 11
      // PolicyBazaar reminders were counted as ₹44k of spending.
      event_kind: z.enum(["completed", "requested", "scheduled", "failed", "promotional"]),
      transaction_type: z.enum([
        "purchase", "bill_payment", "subscription", "subscription_renewal",
        "refund", "salary_credit", "bank_transfer", "upi_payment", "wallet_payment",
        "wallet_topup", "p2p_transfer", "investment", "atm_withdrawal", "cashback",
        "failed_transaction", "emi", "credit_card_payment", "loan_payment",
        "insurance_payment", "rent_payment", "recharge", "utility_payment",
        "travel_booking", "food_order", "autopay_debit", "mandate_setup",
        "mandate_debit", "tax_payment", "unknown",
      ]),
      category: z.enum([
        "ecommerce", "groceries", "food_delivery", "restaurants", "transport",
        "travel", "subscriptions", "payments", "investments", "insurance",
        "healthcare", "education", "productivity", "electronics", "telecom",
        "fitness", "gaming", "home_services", "furniture", "shopping", "fuel",
        "utilities", "rent", "salary", "banking", "tax", "entertainment",
        "software", "ai_tools", "beauty", "eyewear", "jewelry", "internet",
        "pharmacy", "unknown",
      ]),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
      merchant_name: z.string().nullable(),
      merchant_normalized: z.string().nullable(),
      bank_name: z.string().nullable(),
      payment_method: z.string().nullable(),
      transaction_datetime: z.string().nullable(),
      due_date: z.string().nullable(),
      transaction_id: z.string().nullable(),
      reference_id: z.string().nullable(),
      upi_id: z.string().nullable(),
      masked_account: z.string().nullable(),
      is_recurring: z.boolean(),
      recurring_frequency: z.string().nullable(),
      status: z.string().nullable(),
      sender_type: z.string().nullable(),
      raw_sender: z.string().nullable(),
    })
    .nullable(),
});

export type FinancialExtraction = z.infer<typeof financialExtractionSchema>;

function buildPrompt(senderEmail: string, senderType: SenderType, subject: string, body: string): string {
  return `You are a financial data extractor. This email is from a ${senderType} sender.

From: ${senderEmail}
Subject: ${subject}
Body:
${body.substring(0, 3000)}

Determine whether this email contains any of the following:
- financial transaction, billing event, payment reminder, subscription charge
- refund, salary credit, investment activity, or any monetary event

A financial email includes but is not limited to:
merchant transaction, ecommerce order, food delivery payment, grocery purchase,
restaurant bill, bank transaction, UPI payment, wallet payment, card payment,
credit card statement, debit alert, credit alert, recurring subscription,
EMI reminder, EMI deduction, bill due reminder, utility payment, telecom recharge,
internet bill, rent payment, salary credit, refund, cashback, failed transaction,
insurance payment, investment order, SIP investment, mutual fund transaction,
stock trade confirmation, loan payment, travel booking, hotel booking, airline booking,
gaming purchase, educational purchase, healthcare payment, pharmacy order,
software subscription, SaaS invoice, tax payment, recharge confirmation,
autopay notification, mandate setup, mandate debit, FASTag recharge, toll payment,
wallet top-up, P2P transfer, bank transfer, suspicious financial activity

EXTRACTION RULES:
- Extract only explicitly stated information. Never infer or hallucinate amounts, merchants, dates, or IDs.
- If data is unavailable, use null.
- Amounts must be numeric only (no currency symbols).
- Dates must use ISO-8601 format.
- If uncertain, set confidence low.
- If the email is purely promotional with no real transaction, set is_financial_email=false.
- Credit card statements and payment reminders are financial emails.
- Refund amounts are positive numbers; transaction_type handles directionality.
- If multiple transactions exist, extract only the primary one.

EVENT KIND - decide this first; it says whether money actually moved:
- "completed": money has moved. A debit or credit alert, "payment successful", a paid receipt or order confirmation, a refund processed, salary credited, an investment executed.
- "requested": money is owed or asked for and has NOT been paid. A bill or EMI due, a payment reminder, a renewal notice quoting a premium or price, a credit-card statement showing an amount due, an invoice awaiting payment. The amount is the amount due.
- "scheduled": an automatic charge that will happen later - "will renew on", "will be debited on", "autopay scheduled". The amount is the amount that will be charged.
- "failed": a payment that was attempted and did not go through - declined, failed, reversed.
- "promotional": no payment owed or made - offers, cashback offers, discounts, loyalty points or store credit about to expire, price quotes for something not yet bought.
A renewal reminder is "requested" even when it shows a price and a "Renew now" button: quoting a price is not a payment.
A declined or failed payment is "failed" even when the email asks you to update your card or retry.
Store credit, gift-card balance, cashback or points that are about to expire are "promotional" even when phrased as a reminder: nothing is owed. Use "completed" only when the email states the money was paid, debited, credited or refunded.

DATES:
- transaction_datetime is when money moved. Set it only for "completed" and "failed"; otherwise null.
- due_date is when payment is due or will be taken. Copy the year from the email; if the email gives no year, use the year the email was sent - never an earlier one.

Set transaction to null if is_financial_email is false.`;
}

const financialJsonSchema = z.toJSONSchema(financialExtractionSchema);

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

export async function extractFinancialTransaction(
  senderEmail: string,
  senderType: SenderType,
  subject: string,
  body: string
): Promise<FinancialExtraction> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 800,
    messages: [{ role: "user", content: buildPrompt(senderEmail, senderType, subject, body) }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "financial_extraction",
        strict: true,
        schema: financialJsonSchema as Record<string, unknown>,
      },
    },
  });

  const text = response.choices[0].message.content ?? "{}";
  return JSON.parse(text) as FinancialExtraction;
}
