import { z } from "zod";

// ─────────────────────────────────────────
// Email Triage (Claude Haiku)
// ─────────────────────────────────────────
export const emailTriageSchema = z.object({
  summary: z.string().describe("2-sentence summary of the email"),
  sentiment: z.enum(["positive", "neutral", "negative", "urgent"]),
  importance_score: z.number().min(0).max(1),
  requires_action: z.boolean(),
  action_description: z.string().nullable(),
  entities_mentioned: z.array(z.string()).describe("Company names, deal names, project names"),
  follow_up_deadline: z.string().nullable().describe("ISO date if a deadline is mentioned"),
});

export type EmailTriage = z.infer<typeof emailTriageSchema>;

export function emailTriagePrompt(businessContext: any, senderInfo: string, body: string): string {
  return `You are an AI chief of staff for a founder. Analyze this email and return a JSON object.

Business context: ${JSON.stringify(businessContext)}
Sender: ${senderInfo}

Email body:
${body.substring(0, 3000)}

Return ONLY valid JSON matching this schema:
{
  "summary": "string (2 sentences)",
  "sentiment": "positive|neutral|negative|urgent",
  "importance_score": 0.0-1.0,
  "requires_action": true|false,
  "action_description": "string or null",
  "entities_mentioned": ["string"],
  "follow_up_deadline": "ISO date or null"
}`;
}

// ─────────────────────────────────────────
// Meeting Summary (Claude Sonnet)
// ─────────────────────────────────────────
export const meetingSummarySchema = z.object({
  executive_summary: z.string().describe("3-5 sentence executive summary"),
  key_decisions: z.array(z.object({
    description: z.string(),
    context: z.string(),
  })),
  action_items: z.array(z.object({
    description: z.string(),
    owner: z.string(),
    due_date: z.string().nullable(),
  })),
  commitments: z.array(z.object({
    description: z.string(),
    committed_by: z.string(),
    to_whom: z.string().nullable(),
    due_date: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })),
  follow_up_emails_needed: z.array(z.object({
    to: z.string(),
    re: z.string(),
  })),
  sentiment: z.enum(["productive", "tense", "unclear", "routine"]),
});

export type MeetingSummary = z.infer<typeof meetingSummarySchema>;

export function meetingSummaryPrompt(
  title: string,
  attendees: string,
  transcript: string,
  businessContext: any
): string {
  return `You are an AI chief of staff. Summarize this meeting and extract all action items and commitments.

Business context: ${JSON.stringify(businessContext)}
Meeting: ${title}
Attendees: ${attendees}

Transcript:
${transcript.substring(0, 80000)}

Return ONLY valid JSON matching this schema:
{
  "executive_summary": "string",
  "key_decisions": [{"description": "string", "context": "string"}],
  "action_items": [{"description": "string", "owner": "string", "due_date": "ISO date or null"}],
  "commitments": [{"description": "string", "committed_by": "string", "to_whom": "string or null", "due_date": "ISO date or null", "confidence": 0.0-1.0}],
  "follow_up_emails_needed": [{"to": "email", "re": "topic"}],
  "sentiment": "productive|tense|unclear|routine"
}`;
}

// ─────────────────────────────────────────
// Commitment Extraction from Email (Claude Sonnet)
// ─────────────────────────────────────────
export const commitmentExtractionSchema = z.array(z.object({
  description: z.string(),
  committed_by: z.enum(["founder", "other"]),
  to_whom: z.string().nullable(),
  due_date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
}));

export function commitmentExtractionPrompt(body: string, senderEmail: string): string {
  return `Extract any commitments or promises from this email. Look for phrases like "I'll send", "We'll have", "I'll introduce", "I'll follow up", "Let me get back to you", "I'll connect you", "We'll deliver", "I'll review".

Only extract commitments made by the founder (email author/recipient) or the sender.

Email from: ${senderEmail}
Body:
${body.substring(0, 3000)}

Return ONLY a JSON array:
[{"description": "string", "committed_by": "founder|other", "to_whom": "email or name or null", "due_date": "ISO date or null", "confidence": 0.0-1.0}]

Return [] if no commitments found.`;
}

// ─────────────────────────────────────────
// Daily Brief (Claude Sonnet)
// ─────────────────────────────────────────
export function dailyBriefPrompt(context: {
  pendingTasks: any[];
  upcomingMeetings: any[];
  actionableEmails: any[];
  overdueCommitments: any[];
  overdueFollowUps: any[];
  businessContext: any;
  relevantMemory: string[];
}): string {
  return `You are the founder's chief of staff. Compile a morning brief for today.

Business context: ${JSON.stringify(context.businessContext)}

Today's meetings (${context.upcomingMeetings.length}):
${JSON.stringify(context.upcomingMeetings.slice(0, 5))}

Pending tasks due soon (${context.pendingTasks.length}):
${JSON.stringify(context.pendingTasks.slice(0, 10))}

Emails needing action (${context.actionableEmails.length}):
${JSON.stringify(context.actionableEmails.slice(0, 8))}

Overdue commitments (${context.overdueCommitments.length}):
${JSON.stringify(context.overdueCommitments.slice(0, 5))}

Overdue follow-ups (${context.overdueFollowUps.length}):
${JSON.stringify(context.overdueFollowUps.slice(0, 5))}

Recent context:
${context.relevantMemory.slice(0, 10).join("\n---\n")}

Write a concise, actionable morning brief as a chief of staff would. Lead with the 3 most important things to do today. Then cover meetings, then follow-ups. End with a suggested first action.

Format as markdown with these sections: ## Today's Top Priorities, ## Meetings, ## Follow-Ups & Commitments, ## Quick Wins`;
}

// ─────────────────────────────────────────
// Ask Anything / RAG system prompt
// ─────────────────────────────────────────
export function askSystemPrompt(businessContext: any): string {
  return `You are the founder's AI chief of staff. You have access to their emails, meetings, contacts, tasks, commitments, and relationships.

Business context: ${JSON.stringify(businessContext)}

Answer questions concisely and helpfully. When referencing specific emails or meetings, mention key details. Prioritize actionable insights over summaries.`;
}

export function askContextPrompt(
  vectorResults: string[],
  structuredContext: {
    pendingTasks: any[];
    upcomingMeetings: any[];
    actionableEmails: any[];
    overdueCommitments: any[];
    overdueFollowUps: any[];
  }
): string {
  return `Relevant context from memory:
${vectorResults.join("\n---\n")}

Structured data:
Pending tasks: ${JSON.stringify(structuredContext.pendingTasks.slice(0, 5))}
Upcoming meetings: ${JSON.stringify(structuredContext.upcomingMeetings.slice(0, 3))}
Actionable emails: ${JSON.stringify(structuredContext.actionableEmails.slice(0, 5))}
Overdue commitments: ${JSON.stringify(structuredContext.overdueCommitments.slice(0, 5))}
Overdue follow-ups: ${JSON.stringify(structuredContext.overdueFollowUps.slice(0, 5))}`;
}

// ─────────────────────────────────────────
// Draft Reply (Claude Sonnet)
// ─────────────────────────────────────────
export function draftReplyPrompt(
  emailSubject: string,
  emailBody: string,
  senderName: string,
  contactHistory: string,
  businessContext: any
): string {
  return `You are drafting a reply on behalf of the founder. Write in a professional but direct tone.

Business context: ${JSON.stringify(businessContext)}

Email to reply to:
From: ${senderName}
Subject: ${emailSubject}
Body: ${emailBody.substring(0, 2000)}

Recent history with this contact:
${contactHistory}

Write a reply draft. Be concise. Do not include a subject line. Start directly with the salutation.`;
}
