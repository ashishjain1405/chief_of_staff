import OpenAI from "openai";
import { z } from "zod";
import type { SenderType } from "@/lib/finance/senders";

const financialExtractionSchema = z.object({
  is_financial_email: z.boolean(),
  confidence: z.number().min(0).max(1),
  transaction: z
    .object({
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
