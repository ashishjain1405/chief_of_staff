import OpenAI from "openai";
import { z } from "zod";
import { emailTriagePrompt, emailTriageSchema, type EmailTriage } from "./prompts";
import { meetingSummaryPrompt, meetingSummarySchema, type MeetingSummary } from "./prompts";
import { commitmentExtractionPrompt, commitmentExtractionSchema } from "./prompts";

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const triageJsonSchema = z.toJSONSchema(emailTriageSchema);

export async function triageEmail(
  businessContext: any,
  senderInfo: string,
  body: string
): Promise<EmailTriage> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 700,
    messages: [
      { role: "user", content: emailTriagePrompt(businessContext, senderInfo, body) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "email_triage",
        strict: true,
        schema: triageJsonSchema as Record<string, unknown>,
      },
    },
  });

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
    model: "gpt-4o",
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
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content ?? "";
}

export async function generateDailyBrief(prompt: string): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  return response.choices[0].message.content ?? "";
}
