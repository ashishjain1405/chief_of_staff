import {
  NO_TASK_CATEGORIES,
  AUTOMATED_ONLY_NO_TASK_CATEGORIES,
} from "@/lib/inbox/categories";
import { replyHead } from "@/lib/email/quoted";

const normalize = (email: string) => email.trim().toLowerCase();

// Shared by the worker and the task-extraction eval so the two cannot drift
// apart. The inbox grouping and the worker's block list already did drift once,
// which is how "other" ended up producing a "Book your pass for TechSparks"
// task, and an eval that reimplements the rule would hide exactly that.
// Only consulted for AUTOMATED_ONLY_NO_TASK_CATEGORIES, so a false positive
// costs nothing outside "transactions" and "account_security" - categories a
// human almost never sends. The narrow no-reply/alerts pattern let
// info@account.netflix.com through, and "change your password if the new
// device access was not authorized" is the same conditional disclaimer as a
// bank alert. One leading segment is allowed - googleplay-noreply@,
// order-update@, nps-alerts@ - which across 333 contacts matched 13 more
// addresses, none of them a person.
const AUTOMATED_LOCAL_PARTS =
  /^([a-z0-9]+[.+-])?(no-?reply|donotreply|do-?not-?reply|alerts?|notifications?|info|support|service|accounts?|updates?|hello|team|care|admin|mailer|bounce|news)([.+-]|$)/i;

export function isAutomatedSender(senderEmail: string): boolean {
  const local = senderEmail.split("@")[0] ?? "";
  return AUTOMATED_LOCAL_PARTS.test(local.trim());
}

// The local-part pattern misses senders like evoting@nsdl.com,
// jfsinvestor@kfintech.com and hi@mail.outskill.com. All of them carry
// List-Unsubscribe, which a person replying on a thread does not, so the bulk
// header widens the net without catching human mail.
export function isAutomatedMail(params: {
  senderEmail: string;
  isBulk?: boolean;
  isFinancialDomain?: boolean;
}): boolean {
  return isAutomatedSender(params.senderEmail) || !!params.isBulk || !!params.isFinancialDomain;
}

// Founder decision: being on Cc is not an ask. "Piyush, please test the
// extension" with the founder copied became the founder's task, and no
// wording of the triage prompt stopped it. Applies only when Cc was captured
// (ingest stores it from now on) and the founder is not named in the body.
export function ccOnlyWithoutAsk(params: {
  to: string;
  cc: string | null | undefined;
  founderEmail: string | null | undefined;
  founderFirstName: string | null | undefined;
  body: string;
}): boolean {
  const founder = params.founderEmail?.trim().toLowerCase();
  const name = params.founderFirstName?.trim();
  if (!founder || !name || !params.cc) return false;
  const onCc = params.cc.toLowerCase().includes(founder);
  const onTo = params.to.toLowerCase().includes(founder);
  const named = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(params.body);
  return onCc && !onTo && !named;
}

// A person writes from a personal mailbox; a company domain that is not
// flagged as automated is still a company (surveys, proxy votes, memberships).
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "rediffmail.com",
]);
export const isPersonalSender = (email: string) => PERSONAL_DOMAINS.has((email.split("@")[1] ?? "").toLowerCase());

// Asks that are never the founder's task, whatever triage decides. Founder
// decision: votes, AGMs and webinars are not tasks - yet a Tesla proxy vote
// still became one on 19 Oct, so the prompt needs a backstop. One-time codes
// expire in minutes. Events, votes, surveys and offers count only from
// companies: a person asking for a board vote is a real ask.
const ONE_TIME_CODE = /\b(otp|verification code|one[- ]time (password|code))\b/i;
// Checked on the email's subject as well as the task title: "Attend the EGM"
// says neither "vote" nor "AGM". Narrow on purpose - the founder's decision is
// about shareholder votes and meetings, and the subject of a colleague's mail
// ("Re: survey results") must not block a real ask.
const SHAREHOLDER_VOTE = /\b(vote|voting|e-?voting|postal ballot|proxy|agm|egm|(annual|extraordinary) general meeting|annual meeting|shareholders?'? meeting)\b/i;
const COMPANY_NOT_A_TASK = /\b(webinar|mastermind|masterclass|register (on|for)|enrol+|enroll|course|survey|share your feedback|donat\w*|sharing meals|upgrade to|premium subscription|consider investing)\b/i;
export const isShareholderVote = (text: string) => SHAREHOLDER_VOTE.test(text);
// "Contact Myntra if you need to reschedule", "reset your password if you did
// not authorise this": a company's conditional notice, not an ask - 2 of the 4
// tasks created between 20 and 23 Oct.
const CONDITIONAL = /\bif you (need|did not|didn'?t|have not|haven'?t|want|wish|did)\b/i;

export function noiseReason(title: string, senderEmail: string, subject = ""): "one-time code" | "shareholder vote" | "not a task" | "conditional notice" | null {
  if (ONE_TIME_CODE.test(title)) return "one-time code";
  if (isPersonalSender(senderEmail)) return null;
  if (SHAREHOLDER_VOTE.test(title) || SHAREHOLDER_VOTE.test(subject)) return "shareholder vote";
  if (COMPANY_NOT_A_TASK.test(title)) return "not a task";
  if (CONDITIONAL.test(title)) return "conditional notice";
  return null;
}

// An email with nothing written in it is not an ask. Muskan's "Indian Express
// SEO - Doc 2" had an empty body and an attachment; triage invented "a matter
// that requires his attention" and it became a high-priority task, while her
// "Doc 1" a minute earlier was judged no action. Gmail leaves inline
// attachments as "[image: Guide.png]", and a reply's quoted history is not the
// sender's words.
const ATTACHMENT_PLACEHOLDER = /\[(image|cid|file|attachment)[^\]]*\]/gi;
const DEVICE_SIGNOFF = /^\s*(sent from my|get outlook for)\b.*$/gim;
// A forward is the exception: the forwarded email is the message - the
// founder's Aadhaar task came from a bare "Fwd:" of Sushil's request.
const FORWARDED = /^\s*-{2,}\s*Forwarded message\s*-{2,}/im;
export function hasMessageText(body: string): boolean {
  const words = (text: string) => /\p{L}{2,}/u.test(text.replace(ATTACHMENT_PLACEHOLDER, " ").replace(DEVICE_SIGNOFF, " "));
  if (FORWARDED.test(body)) return words(body.replace(FORWARDED, " ").replace(/^\s*(from|date|subject|to|cc):.*$/gim, " "));
  return words(replyHead(body));
}

export function taskCategoryAllowed(category: string, senderEmail: string): boolean {
  if (NO_TASK_CATEGORIES.has(category)) return false;

  // Conditioned on the sender: the category alone over-blocks. A human email in
  // an investment thread saying "make the international wire transfer as
  // discussed" was classified "transactions", and a flat block dropped it.
  if (AUTOMATED_ONLY_NO_TASK_CATEGORIES.has(category)) {
    return !isAutomatedSender(senderEmail);
  }
  return true;
}

// Whether an email should produce a task, given triage's verdict. Deliberately
// not a function of importance_score: that is a noisy magnitude which belongs
// to priority, and gating on `>= 0.7` dropped genuine "reply to Kamal about the
// marketing plan" tasks the moment the action guidance was tightened.
//
// Thread grouping and per-email idempotency are NOT decided here - they need
// database state, so they stay in the worker.
export function shouldCreateTask(params: {
  category: string;
  requiresAction: boolean;
  senderEmail: string;
  founderEmail?: string | null;
  isFinancialDomain?: boolean;
  isBulk?: boolean;
  ccOnlyWithoutAsk?: boolean;
  // triage's action_description, the task's title-to-be, and the email's subject and body.
  title?: string | null;
  subject?: string | null;
  body?: string | null;
}): boolean {
  const { category, requiresAction, senderEmail, founderEmail, isFinancialDomain = false, isBulk = false } = params;
  if (!requiresAction) return false;
  if (params.ccOnlyWithoutAsk) return false;
  if (noiseReason(params.title ?? "", senderEmail, params.subject ?? "")) return false;
  if (typeof params.body === "string" && !hasMessageText(params.body)) return false;

  // Mail the founder wrote themselves. The backfill's Gmail query was not
  // scoped to the inbox, so it pulled in 12 of the founder's own messages and
  // stored them with direction "inbound" - triage then read "I am in for $51
  // as well, would prefer the 1st idea" as an incoming ask and raised a task
  // for work the founder had just finished doing. Compared on address rather
  // than direction because direction is the field that is wrong.
  if (founderEmail && senderEmail && normalize(senderEmail) === normalize(founderEmail)) {
    return false;
  }

  if (NO_TASK_CATEGORIES.has(category)) return false;
  if (AUTOMATED_ONLY_NO_TASK_CATEGORIES.has(category)) {
    return !isAutomatedMail({ senderEmail, isBulk, isFinancialDomain });
  }
  return true;
}
