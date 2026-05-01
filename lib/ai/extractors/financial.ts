import OpenAI from "openai";
import { z } from "zod";
import type { SenderType } from "@/lib/finance/senders";

const financialExtractionSchema = z.object({
  is_financial_email: z.boolean(),
  confidence: z.number().min(0).max(1),
  transaction: z
    .object({
      transaction_type: z.enum([
        "purchase", "bill_payment", "subscription", "refund", "salary_credit",
        "bank_transfer", "upi_payment", "wallet_payment", "investment",
        "atm_withdrawal", "cashback", "failed_transaction", "emi",
        "credit_card_payment", "loan_payment", "insurance_payment", "unknown",
      ]),
      category: z.enum([
        "food_delivery", "groceries", "shopping", "travel", "transport", "fuel",
        "utilities", "rent", "subscriptions", "insurance", "healthcare",
        "education", "entertainment", "investments", "banking", "salary",
        "tax", "emi", "telecom", "ecommerce", "restaurants", "unknown",
      ]),
      amount: z.number().nullable(),
      currency: z.string().nullable(),
      merchant_name: z.string().nullable(),
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

Determine if this is a financial email (transaction confirmation, invoice, bill, payment alert, etc.) and extract structured data.

Return ONLY valid JSON:
{
  "is_financial_email": true/false,
  "confidence": 0.0-1.0,
  "transaction": {
    "transaction_type": "purchase|bill_payment|subscription|refund|salary_credit|bank_transfer|upi_payment|wallet_payment|investment|atm_withdrawal|cashback|failed_transaction|emi|credit_card_payment|loan_payment|insurance_payment|unknown",
    "category": "food_delivery|groceries|shopping|travel|transport|fuel|utilities|rent|subscriptions|insurance|healthcare|education|entertainment|investments|banking|salary|tax|emi|telecom|ecommerce|restaurants|unknown",
    "amount": number or null,
    "currency": "INR" or other currency code or null,
    "merchant_name": "string or null",
    "bank_name": "string or null",
    "payment_method": "string or null",
    "transaction_datetime": "ISO datetime or null",
    "due_date": "ISO date or null",
    "transaction_id": "string or null",
    "reference_id": "string or null",
    "upi_id": "string or null",
    "masked_account": "last 4 digits or masked number or null",
    "is_recurring": true/false,
    "recurring_frequency": "monthly|weekly|annual|null",
    "status": "success|failed|pending|null",
    "raw_sender": "${senderEmail}"
  }
}

Set transaction to null if is_financial_email is false.`;
}

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
    response_format: { type: "json_object" },
  });

  const text = response.choices[0].message.content ?? "{}";
  return financialExtractionSchema.parse(JSON.parse(text));
}
