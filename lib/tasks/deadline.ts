// A follow-up deadline cannot fall before the email that asked for it. Triage
// sometimes lifts an unrelated date out of the body - a compliance cutoff, a
// statement period, a past effective date - and returns it as the deadline.
// That creates a task born overdue by years which then pins itself to the top
// of any oldest-first list: one Paytm KYC notice that arrived 2026-09-02 came
// back with a 2024-06-30 deadline and held slot 1 of the dashboard.
//
// Null rather than clamped to the email date, which would fabricate a deadline
// of "the day it arrived" and make the task instantly overdue. An undated task
// is honest - we do not know when it is due.
export function resolveFollowUpDeadline(
  extracted: string | null,
  referenceAt: string | null
): string | null {
  if (!extracted) return null;
  const parsed = new Date(extracted);
  if (Number.isNaN(parsed.getTime())) return null;
  if (!referenceAt) return extracted;

  const reference = new Date(referenceAt).getTime();
  if (Number.isNaN(reference)) return extracted;

  // Compare against end of the deadline's day, so a bare date ("2026-09-02"
  // parsed as midnight) on the same day the email arrived still counts.
  const endOfDueDay = new Date(parsed);
  endOfDueDay.setUTCHours(23, 59, 59, 999);
  return endOfDueDay.getTime() < reference ? null : extracted;
}
