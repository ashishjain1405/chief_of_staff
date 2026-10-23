import { isAutomatedMail } from "@/lib/tasks/gate";

export type TaskPriority = "high" | "medium" | "low";

// Priority was `importance >= 0.85 ? "high" : "medium"`: nothing was ever low
// and almost nothing high, so all 70 open tasks read "medium". Importance alone
// cannot rank them either - a donation appeal and a "consider investing" offer
// scored 0.80, the water and electricity bills 0.50. Priority now comes from
// what the task is and who asks, with importance as the tie-breaker.

// Things that are optional or tied to an event: never above low, whoever sends them.
const OPTIONAL = /\b(vote|voting|e-?voting|postal ballot|annual (general )?meeting|agm|otp|verification code|survey|share your feedback|webinar|mastermind|enrol+|enroll|course|donat\w*|sharing meals|upgrade to|premium subscription|consider investing|sign[- ]?up|register (on|for))\b|\b(avail|enjoy)\b[^.]{0,25}\bdiscount\b/i;

// Money the founder owes. "dues", not "due": "renew before the due date" is not a bill.
const OWED = /\b(pay|payment|bill|emi|repay|dues)\b/i;

// A person writes from a personal mailbox; a company domain that is not
// flagged as automated is still a company (surveys, proxy votes, memberships).
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "outlook.com", "hotmail.com",
  "live.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "rediffmail.com",
]);
export const isPersonalSender = (email: string) => PERSONAL_DOMAINS.has((email.split("@")[1] ?? "").toLowerCase());

export function taskPriority(params: { title: string; importance: number; senderEmail: string; isBulk?: boolean; isFinancialDomain?: boolean }): TaskPriority {
  const { title, importance, senderEmail } = params;
  if (OPTIONAL.test(title)) return "low";
  if (OWED.test(title)) return "high";
  const person = isPersonalSender(senderEmail);
  if (person && importance >= 0.6) return "high";
  if (importance >= 0.85) return "high";
  if (!person && importance < 0.5) return "low";
  if (isAutomatedMail({ senderEmail, isBulk: params.isBulk, isFinancialDomain: params.isFinancialDomain }) && importance < 0.6) return "low";
  return "medium";
}

// A task tied to a date that has passed can no longer be done - the gift card
// lapsed, the webinar ended. Those, and anything long overdue, are for review,
// not for ranking. Shared by the Tasks page and the daily brief.
const DATE_BOUND = /\b(redeem|attend|join|register|vote|webinar|claim|expir\w*)\b/i;
export const STALE_DAYS = 14;

export function reviewReason(title: string, daysUntilDue: number | null): "lapsed" | "stale" | null {
  if (daysUntilDue === null || daysUntilDue >= 0) return null;
  if (DATE_BOUND.test(title)) return "lapsed";
  return daysUntilDue < -STALE_DAYS ? "stale" : null;
}
