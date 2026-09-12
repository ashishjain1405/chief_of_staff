import {
  NO_TASK_CATEGORIES,
  AUTOMATED_ONLY_NO_TASK_CATEGORIES,
} from "@/lib/inbox/categories";

const normalize = (email: string) => email.trim().toLowerCase();

// Shared by the worker and the task-extraction eval so the two cannot drift
// apart. The inbox grouping and the worker's block list already did drift once,
// which is how "other" ended up producing a "Book your pass for TechSparks"
// task, and an eval that reimplements the rule would hide exactly that.
export function isAutomatedSender(senderEmail: string): boolean {
  return /no-?reply|alerts?@|notification|donotreply/i.test(senderEmail);
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
}): boolean {
  const { category, requiresAction, senderEmail, founderEmail, isFinancialDomain = false } = params;
  if (!requiresAction) return false;

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
    return !(isAutomatedSender(senderEmail) || isFinancialDomain);
  }
  return true;
}
