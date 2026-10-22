import OpenAI from "openai";
import { stripQuotedReply } from "@/lib/email/quoted";
import { withAiRetry } from "@/lib/ai/retry";
import { z } from "zod";
import { emailTriagePrompt, emailTriageSchema, type EmailTriage } from "./prompts";
import { meetingSummaryPrompt, meetingSummarySchema, type MeetingSummary } from "./prompts";
import { commitmentExtractionPrompt, commitmentExtractionSchema } from "./prompts";
import { dailyBriefJsonSchema, dailyBriefSchema, type DailyBriefJudgement } from "./prompts";

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const triageJsonSchema = z.toJSONSchema(emailTriageSchema);

export async function triageEmail(
  businessContext: any,
  senderInfo: string,
  body: string,
  recipientInfo?: string,
  isBulk?: boolean,
  sentAt?: string | null
): Promise<EmailTriage> {
  const client = getClient();

  // Strip the quoted thread here, at the triage boundary, rather than in the
  // caller: every consumer of triage wants the new message, and doing it in
  // one place keeps the worker and the task-extraction eval from diverging.
  // The stored body is untouched, since summaries, embeddings and financial
  // extraction all still need the full thread.
  const newContent = stripQuotedReply(body);

  const response = await withAiRetry(() => client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 700,
    // Triage is classification, not generation, and this call had no
    // temperature at all - so it ran at the default 1.0. The same email came
    // back "important", "other" and "transactions" across runs, and since
    // task creation is gated on category, identical mail produced a task or
    // not depending on the sample. classifyIntent already pins this to 0.
    temperature: 0,
    messages: [
      { role: "user", content: emailTriagePrompt(businessContext, senderInfo, newContent, recipientInfo, isBulk, sentAt) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "email_triage",
        strict: true,
        schema: triageJsonSchema as Record<string, unknown>,
      },
    },
  }), "triageEmail");

  const text = response.choices[0].message.content ?? "{}";
  return JSON.parse(text) as EmailTriage;
}

export async function summarizeMeeting(
  title: string,
  attendees: string,
  transcript: string,
  businessContext: any
): Promise<MeetingSummary> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    messages: [
      { role: "user", content: meetingSummaryPrompt(title, attendees, transcript, businessContext) },
    ],
    response_format: { type: "json_object" },
  });

  const text = response.choices[0].message.content ?? "{}";
  return meetingSummarySchema.parse(JSON.parse(text));
}

export async function extractCommitments(body: string, senderEmail: string) {
  const client = getClient();
  const response = await client.chat.completions.create({
    // gpt-4o-mini: this ran on gpt-4o and was ~17x the cost per call, making it
    // the single largest line item when reprocessing the mailbox despite
    // firing on a minority of emails.
    model: "gpt-4o-mini",
    max_tokens: 512,
    messages: [
      { role: "user", content: commitmentExtractionPrompt(body, senderEmail) },
    ],
    response_format: { type: "json_object" },
  });

  const text = response.choices[0].message.content ?? "[]";
  // GPT with json_object wraps arrays — unwrap if needed
  const parsed = JSON.parse(text);
  const arr = Array.isArray(parsed) ? parsed : parsed.commitments ?? [];
  return commitmentExtractionSchema.parse(arr);
}

export async function generateDraft(prompt: string): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    // At the default 1.0 one draft in five still slipped - a "[Founder's
    // Name]" sign-off, a reply to an automated email.
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content ?? "";
}

// Null when the reply does not parse; the brief then falls back to ranking by
// due date rather than going out empty.
export async function generateDailyBrief(prompt: string): Promise<DailyBriefJudgement | null> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    // At the default 1.0 the same inputs gave a different top three, and now
    // and then an invented "accounts team", from one run to the next.
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "daily_brief", strict: true, schema: dailyBriefJsonSchema as Record<string, unknown> },
    },
  });
  try {
    const parsed = dailyBriefSchema.safeParse(JSON.parse(response.choices[0].message.content ?? "{}"));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
