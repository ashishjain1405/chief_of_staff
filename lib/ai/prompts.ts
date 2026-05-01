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
    "travel",
    "account_security",
    "finance_bills",
    "transactions",
    "subscriptions_memberships",
    "receipts_documents",
    "legal_government",
    "meetings_calendar",
    "shipping_orders",
    "productivity_tools",
    "career",
    "social",
    "newsletters",
    "news",
    "learning",
    "entertainment",
    "fitness",
    "system_notifications",
    "promotions",
    "important",
    "pending_reply",
    "other",
  ]),
  fallback_category: z.enum([
    "travel",
    "account_security",
    "receipts_documents",
    "legal_government",
    "meetings_calendar",
    "shipping_orders",
    "productivity_tools",
    "career",
    "social",
    "newsletters",
    "news",
    "learning",
    "entertainment",
    "fitness",
    "system_notifications",
    "promotions",
    "important",
    "pending_reply",
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

Classify email_category using EXACTLY ONE of these 22 categories:

"travel"
Flight/hotel/train/bus booking confirmations, PNR, boarding pass, itinerary, check-in reminders, reservation details. Travel booking confirmations are ALWAYS "travel", never "transactions".
Examples: IndiGo boarding pass, MakeMyTrip hotel confirmation, IRCTC PNR, Airbnb booking.

"account_security"
OTPs, login alerts, password reset links, suspicious activity warnings, 2FA codes, device authorization, account verification emails.
Examples: "Your OTP is 123456", "New login to your account", "Password changed", "Verify your email".

"finance_bills"
Invoices, bills due, payment reminders, EMI reminders, utility bills, rent due, credit card statements, loan due notices, insurance premium notices, tax notices, SaaS invoices — i.e. money owed or upcoming charges.
Examples: Electricity bill, AWS invoice, Netflix renewal invoice, HDFC credit card statement, LIC premium due.
NOT for: actual confirmed charges — those are "transactions".

"transactions"
ANY confirmed money movement or completed financial activity. Bank debit/credit alerts, UPI transaction notifications, wallet payments, card swipe alerts, refunds, salary credits, cashback, ATM withdrawals, investment confirmations (SIP, mutual fund, stock trade). Bank alerts MUST be "transactions". Investment transactions (SIP processed, order executed) stay "transactions".
Examples: "Rs 500 debited from HDFC", "UPI payment successful", "Salary credited", "SIP of Rs 5000 executed", "Refund processed".
NOT for: shipping notifications — use "shipping_orders". NOT for: travel booking charges — use "travel".

"subscriptions_memberships"
Renewal reminders, membership expiry notices, subscription confirmation emails, plan upgrade/downgrade notices — when the charge has NOT yet occurred (upcoming or pending).
Examples: "Your Netflix subscription renews in 3 days", "Spotify Premium expires on...", "Your Notion plan will auto-renew".
Disambiguation: If the charge is already confirmed (bank debit alert) → "transactions". If it's a reminder or upcoming renewal notice → "subscriptions_memberships".
Applies to: netflix.com, spotify.com, notion.so, adobe.com, openai.com, canva.com, grammarly.com, primevideo.com, hotstar.com.

"receipts_documents"
PDF invoices received as attachments, signed contracts, salary slips, GST bills, monthly account statements, policy documents, appointment letters, official receipts from merchants.
Examples: Salary slip PDF, GST invoice, contract signed, bank statement PDF, insurance policy document.

"legal_government"
GST notices, income tax notices, Aadhaar/PAN/KYC updates, government compliance emails, EPFO, MCA, legal notices, court summons, regulatory emails.
Examples: Income tax refund notice, GST portal alert, EPFO passbook update, Aadhaar OTP (use "account_security" if it's just an OTP).

"meetings_calendar"
Calendar invites, meeting reminders, reschedule notifications, video call links, conference invites.
Examples: Google Meet invite, Zoom reschedule, interview calendar invite, webinar registration confirmation.

"shipping_orders"
Order dispatched, shipment tracking, out for delivery, delivered, return initiated, refund status, order confirmation emails from merchants.
Examples: "Your order has been shipped", "Out for delivery", "Delivered", "Track your Flipkart order".
NOT for: payment confirmation of the order — that is "transactions".

"productivity_tools"
Automated notifications from work tools: GitHub PR reviews, Jira tickets, Slack/Teams alerts, Vercel deployments, Notion comments, Linear issues, Asana tasks, Trello activity.
Applies to: github.com, gitlab.com, vercel.com, linear.app, atlassian.net, slack.com, notion.so (non-billing), asana.com, trello.com.
Disambiguation: billing email from a productivity tool → "finance_bills" or "transactions", not "productivity_tools".

"career"
Recruiter outreach, interview invites, job application status updates, job alerts, offer letters, background check requests.
Examples: "Opportunity at Stripe", "Interview scheduled", "Your application was reviewed", "Offer letter attached".
Disambiguation for linkedin.com: if keywords include "recruiter", "job", "opportunity", "apply", "interview" → "career"; else → "social".

"social"
Notifications from social networks: LinkedIn activity (non-recruiting), Instagram, Twitter/X, Facebook, Reddit, Discord, WhatsApp.
Examples: "Someone liked your post", "You have a new connection", "New message on Reddit".

"newsletters"
Recurring editorial or informational emails from publications, Substack writers, curated digests. Sent on a schedule, not triggered by user action.
Examples: Morning Brew, The Ken, a16z newsletter, YC updates, Substack posts, Product Hunt digest.
Applies to: substack.com, beehiiv.com, ghost.io, convertkit.com, mailerlite.com, mailchimp.com (when editorial, not marketing blast).

"news"
Real-time news alerts, breaking news, stock/market alerts, sports scores, weather alerts, price alerts.
Examples: "Markets down 2%", "Breaking: RBI rate cut", "Your price alert triggered", "Sensex update".

"learning"
Course updates, lesson reminders, certification emails, webinar invites, assignment notifications, skill-building platforms.
Examples: Coursera course update, Udemy lecture reminder, certification earned, upGrad assignment due.
Applies to: coursera.org, udemy.com, upgrad.com, scaler.com, skillshare.com, edx.org.

"entertainment"
Content recommendations, new episode alerts, gaming notifications, streaming platform updates (non-billing).
Examples: "New episodes available on Netflix", "Spotify Wrapped", "New game release", "Your Steam wishlist item is on sale".
Disambiguation: renewal reminder from netflix.com/spotify.com → "subscriptions_memberships". New content alert → "entertainment".

"fitness"
Doctor appointment confirmations, lab reports, pharmacy order confirmations, workout summaries, gym membership (non-billing), health app digests.
Examples: Lab report ready, doctor appointment reminder, pharmacy order dispatched, gym class booked.

"system_notifications"
Automated system alerts from cloud/infra: AWS billing/usage alerts, storage warnings, app maintenance notices, server downtime, error monitoring alerts, security scan results.
Examples: "AWS billing alert", "Vercel deployment failed", "Google Drive storage 90% full", "Sentry: new error".

"promotions"
Purchase-intent marketing: sale announcements, discount coupons, promotional campaigns, product launch emails, flash sale alerts — mass-sent marketing emails.
Examples: "50% off today only", "Exclusive offer for you", "New collection launched", "Use code SAVE20".
NOT for: newsletters (editorial content) or social notifications.

"important"
Personal human emails requiring nuanced attention: investor/client/founder communication, direct relationship emails, urgent personal correspondence, emails that don't fit any automated category.
Examples: Investor asking for an update, client escalation, personal email from a colleague, board member message.

"pending_reply"
Sender clearly expects a response: unanswered question, thread awaiting reply, follow-up on a previous conversation, introduction expecting acknowledgement.
Examples: "Can you review this?", "Following up on below", "Let me know your thoughts", "Awaiting your response".

"other"
Use ONLY if none of the 21 categories above apply.

PRIORITY ORDER (resolve conflicts by checking top-down):
1. Travel booking confirmations → always "travel"
2. OTPs and login/security alerts → always "account_security"
3. Bills/invoices/upcoming charges → always "finance_bills"
4. Confirmed money movement (bank alerts, UPI, salary, SIP) → always "transactions"
5. Subscription renewal reminders (not yet charged) → "subscriptions_memberships"
6. PDF receipts and official documents → "receipts_documents"
7. Government/legal notices → "legal_government"
8. Calendar invites and meeting reminders → "meetings_calendar"
9. Order/shipping/delivery status → "shipping_orders"
10. Work tool notifications (GitHub, Jira, Vercel) → "productivity_tools"
11. Recruiter/job emails → "career"
12. Social network notifications → "social"
13. Editorial newsletters → "newsletters"
14. Breaking news/market alerts → "news"
15. Course/learning platform updates → "learning"
16. Content/gaming recommendations → "entertainment"
17. Health/fitness notifications → "fitness"
18. Cloud/infra system alerts → "system_notifications"
19. Mass marketing and discount campaigns → "promotions"
20. Personal human emails needing attention → "important"
21. Sender awaiting a reply → "pending_reply"
22. Everything else → "other"

Set fallback_category ONLY when email_category is "transactions", "finance_bills", or "subscriptions_memberships". Set it to what you would classify this email as if it were NOT a financial/subscription email. Valid values: "travel", "account_security", "receipts_documents", "legal_government", "meetings_calendar", "shipping_orders", "productivity_tools", "career", "social", "newsletters", "news", "learning", "entertainment", "fitness", "system_notifications", "promotions", "important", "pending_reply", "other".
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
  insights: Array<{
    category: string;
    insight_type: string;
    urgency: string;
    priority_score: number;
    title: string;
    summary: string;
    recommended_action?: string | null;
    explanation?: string;
    entities?: string[];
    generated_by?: string;
  }>,
  vectorChunks: string[],
  intent: { primary: string; secondary: string[] }
): string {
  const sections: string[] = [];

  sections.push(`Query intent: ${intent.primary}${intent.secondary.length > 0 ? ` (also: ${intent.secondary.join(", ")})` : ""}`);

  if (insights.length > 0) {
    sections.push("## Priority Insights (sorted by urgency and importance)");
    for (const insight of insights.slice(0, 15)) {
      const urgencyTag = insight.urgency.toUpperCase();
      let entry = `[${urgencyTag}] ${insight.title}\n  ${insight.summary}`;
      if (insight.recommended_action) {
        entry += `\n  → ${insight.recommended_action}`;
      }
      if (insight.explanation) {
        entry += `\n  (${insight.explanation})`;
      }
      sections.push(entry);
    }
  } else {
    sections.push("## Priority Insights\n(No active insights found)");
  }

  if (vectorChunks.length > 0) {
    sections.push("## Relevant Memory");
    sections.push(vectorChunks.join("\n---\n"));
  }

  return sections.join("\n\n");
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
