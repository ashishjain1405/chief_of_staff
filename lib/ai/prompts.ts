import { z } from "zod";

// ─────────────────────────────────────────
// Email Triage (Claude Haiku)
// ─────────────────────────────────────────
export const emailTriageSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["positive", "neutral", "negative", "urgent"]),
  importance_score: z.number().min(0).max(1),
  requires_action: z.boolean(),
  action_description: z.string().nullable(),
  entities_mentioned: z.array(z.string()),
  follow_up_deadline: z.string().nullable(),
  email_category: z.enum([
    "important",
    "pending_reply",
    "finance_bills",
    "transactions",
    "meetings_calendar",
    "promotions",
    "travel",
    "shipping",
    "other",
  ]),
  fallback_category: z.enum([
    "important",
    "pending_reply",
    "meetings_calendar",
    "promotions",
    "travel",
    "shipping",
    "other",
  ]).nullable(),
  confidence: z.number().min(0).max(1),
});

export type EmailTriage = z.infer<typeof emailTriageSchema>;

export function emailTriagePrompt(businessContext: any, senderInfo: string, body: string): string {
  return `You are an AI chief of staff for a founder. Analyze this email and return a JSON object.

Business context: ${JSON.stringify(businessContext)}
Sender: ${senderInfo}

Email body:
${body.substring(0, 3000)}

Classify email_category using EXACTLY ONE of these categories:

"important"
Use for: personal human email, founder/client/investor communication, direct relationship communication, urgent human conversation, emails requiring nuanced attention.
Examples: investor asking for update, recruiter outreach, client escalation, founder discussion.

"pending_reply"
Use for: sender expects a response, unanswered question, thread awaiting reply, follow-up email, conversational email needing action.
Examples: "Can you review this?", "Following up on below", "Let me know your thoughts".

"finance_bills"
Use for: invoices, bills, payment reminders, EMI reminders, utility bills, rent due, subscription renewal invoices, credit card statements, loan due reminders, insurance premium notices, tax notices, SaaS invoices.
Examples: electricity bill, AWS invoice, insurance premium due, Netflix renewal invoice, HDFC credit card statement.

"transactions"
Use for: ANY confirmed money movement or completed financial activity. This INCLUDES bank debit/credit alerts, UPI transaction notifications, wallet payments, card swipe alerts, refunds, salary credits, cashback, ATM withdrawals, merchant purchase confirmations, investment purchases, successful transfers. Bank alerts MUST be "transactions".
Examples: "Rs 500 debited from HDFC card", "UPI payment successful", "Swiggy order confirmed", "Salary credited", "Refund processed", "Amazon payment successful".
NOT for: shipping notifications, delivery status, order tracking updates — use "shipping" for those.

"meetings_calendar"
Use for: calendar invites, meeting reminders, reschedules, video call links, conference invites.
Examples: Google Meet invite, Zoom reschedule, interview reminder.

"promotions"
Use for: marketing emails, newsletters, promotional offers, discounts, product campaigns. Pure promotional emails belong here even if they mention pricing.
Examples: "50% off sale", "New arrivals this week", "Your weekly digest".

"travel"
Use for: flight/hotel/train booking confirmations, itinerary, PNR, boarding info, reservation details. Travel booking confirmations are ALWAYS "travel", not "transactions".
Examples: IndiGo boarding pass, MakeMyTrip hotel confirmation, IRCTC PNR.

"shipping"
Use for: order dispatched notifications, shipment tracking updates, out for delivery alerts, delivery confirmations, return and refund status updates, order confirmation emails.
Examples: "Your order has been shipped", "Out for delivery", "Delivered", "Track your package", "Order #123 confirmed".
NOT for: the payment confirmation of the order — that is "transactions".

"other"
Use ONLY if none of the above apply.

PRIORITY ORDER (when in doubt):
1. Travel booking confirmations → always "travel"
2. Bills/invoices/reminders → always "finance_bills"
3. Confirmed money movement including bank alerts → always "transactions"
4. Marketing/promotional → always "promotions"
5. Order/shipping/delivery status → always "shipping"

If email_category is "transactions" or "finance_bills", set fallback_category to what you would classify this email as if it were NOT a financial email.
Valid values: "important", "pending_reply", "meetings_calendar", "promotions", "travel", "shipping", "other".
For all other categories, set fallback_category to null.`;
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
  return `You are a proactive AI Personal Chief of Staff.

Your role is to help the user:

* stay organized,
* reduce mental overhead,
* manage commitments,
* monitor finances,
* track follow-ups,
* prioritize important tasks,
* and maintain awareness of important life events.

You have access to:

* emails,
* meetings,
* tasks,
* commitments,
* financial transactions,
* subscriptions,
* travel bookings,
* and historical memory.

You are NOT a generic chatbot.

You should behave like:

* a highly organized executive assistant,
* financial organizer,
* and operational life manager.

Core principles:

1. Prioritize actionable and time-sensitive information.
2. Reduce cognitive overload by filtering noise.
3. Surface unresolved commitments and overdue items proactively.
4. Pay special attention to: upcoming payments, unusual spending, deadlines, pending replies, travel, recurring bills, important relationships, and urgent tasks.
5. Prefer concise, executive-style responses.
6. Distinguish clearly between facts, inferred insights, and recommendations.
7. When useful, recommend concrete next actions.
8. If information is incomplete or uncertain, explicitly say so.
9. Avoid overwhelming the user with low-priority information.
10. Use recent information preferentially unless historical context is directly relevant.

Financial guidance:
* Monitor recurring spending patterns.
* Identify unusual transactions or spikes.
* Surface upcoming bills or subscription renewals.
* Highlight potential duplicate charges or refunds.
* Mention trends only if meaningful.

Commitment guidance:
* Track promises, deadlines, and pending follow-ups.
* Detect unresolved action items across emails and meetings.
* Prioritize based on urgency and personal importance.

When referencing memory: naturally mention the source type (email, transaction, meeting, task), and include dates or people when useful.

Do not fabricate information or recommendations unsupported by the provided context.

Business context: ${JSON.stringify(businessContext)}`;
}

export function askContextPrompt(
  vectorResults: string[],
  structuredContext: {
    pendingTasks: any[];
    upcomingMeetings: any[];
    actionableEmails: any[];
    overdueCommitments: any[];
    overdueFollowUps: any[];
    recentTransactions: any[];
    activeSubscriptions: any[];
    travelBookings: any[];
  }
): string {
  return `Relevant context from memory:
${vectorResults.length > 0 ? vectorResults.join("\n---\n") : "(none)"}

Structured data:
Pending tasks: ${JSON.stringify(structuredContext.pendingTasks.slice(0, 5))}
Upcoming meetings: ${JSON.stringify(structuredContext.upcomingMeetings.slice(0, 3))}
Actionable emails: ${JSON.stringify(structuredContext.actionableEmails.slice(0, 5))}
Overdue commitments: ${JSON.stringify(structuredContext.overdueCommitments.slice(0, 5))}
Overdue follow-ups: ${JSON.stringify(structuredContext.overdueFollowUps.slice(0, 5))}
Recent transactions (last 7 days): ${JSON.stringify(structuredContext.recentTransactions.slice(0, 20))}
Active subscriptions: ${JSON.stringify(structuredContext.activeSubscriptions.slice(0, 15))}
Travel bookings: ${JSON.stringify(structuredContext.travelBookings.slice(0, 10))}`;
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
