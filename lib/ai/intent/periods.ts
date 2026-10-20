import {
  addDays, addMonths, addQuarters, addWeeks, addYears, endOfDay, endOfMonth, endOfQuarter, endOfWeek,
  startOfDay, startOfMonth, startOfQuarter, startOfWeek, subDays,
} from "date-fns";
import type { ConversationContext, TemporalAnchor } from "../retrieval/types";
import { temporalToDateRange } from "../retrieval/resolve";

// Periods the model names well but resolves badly. It picks a period token
// reliably and does date arithmetic unreliably: "this quarter" came back as
// July-September, "on Friday" as a Wednesday, "next week" starting on a
// Friday, and "the month before" as the same month again. These phrases are
// resolved here and take precedence over the model; months, years and the
// listed relative tokens stay with the model, which gets them right.

const range = (from: Date, to: Date): TemporalAnchor => ({
  type: "absolute",
  dateRange: { from: from.toISOString(), to: to.toISOString() },
});

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// A qualifier is required so a name in passing ("my Monday standup notes")
// does not turn into a date filter.
const WEEKDAY = /\b(last|next|this|coming|on|by|until|till|for)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const PAST_TENSE = /\b(did|was|were|had|happened|spent|paid|received|got|sent|bought|went|met)\b/i;

function weekday(query: string, now: Date): TemporalAnchor | null {
  const m = WEEKDAY.exec(query);
  if (!m) return null;
  const target = WEEKDAYS.indexOf(m[2].toLowerCase());
  const today = now.getDay();
  const qualifier = m[1].toLowerCase();
  const past = qualifier === "last" || (["on", "for"].includes(qualifier) && PAST_TENSE.test(query));
  const offset = past
    ? -(((today - target) + 7) % 7 || 7)
    : ((target - today) + 7) % 7;
  const day = addDays(now, offset);
  return range(startOfDay(day), endOfDay(day));
}

const SHIFT = /\b(?:the\s+)?(month|week|quarter|year)\s+(before|after)\b|\b(before|after)\s+that\b|\bsame\s+(?:period|time)\s+last\s+year\b/i;

// Shifts the previous turn's period: "and the month before?" after a question
// about September means August, not last month again.
function shift(query: string, context: ConversationContext | null | undefined): TemporalAnchor | null {
  const m = SHIFT.exec(query);
  if (!m) return null;
  const prev = temporalToDateRange(context?.active_temporal ?? null);
  if (!prev) return null;
  const from = new Date(prev.from);
  const to = new Date(prev.to);
  if (/same/i.test(m[0])) return range(addYears(from, -1), addYears(to, -1));

  const dir = /after/i.test(m[2] ?? m[3] ?? "") ? 1 : -1;
  const isCalendarMonth = startOfMonth(from).getTime() === from.getTime() && endOfMonth(from).getTime() <= to.getTime() + 1000;
  const unit = (m[1]?.toLowerCase() ?? (isCalendarMonth ? "month" : "span"));
  if (unit === "month") { const d = addMonths(from, dir); return range(startOfMonth(d), endOfMonth(d)); }
  if (unit === "week") { const d = addWeeks(from, dir); return range(startOfWeek(d), endOfWeek(d)); }
  if (unit === "quarter") { const d = addQuarters(from, dir); return range(startOfQuarter(d), endOfQuarter(d)); }
  if (unit === "year") return range(addYears(from, dir), addYears(to, dir));
  const span = to.getTime() - from.getTime();
  return dir < 0
    ? range(new Date(from.getTime() - span - 1), new Date(from.getTime() - 1))
    : range(new Date(to.getTime() + 1), new Date(to.getTime() + span + 1));
}

export function deterministicPeriod(
  query: string,
  context?: ConversationContext | null,
  now = new Date()
): TemporalAnchor | null {
  const shifted = shift(query, context);
  if (shifted) return shifted;
  if (/\byesterday\b/i.test(query)) { const d = subDays(now, 1); return range(startOfDay(d), endOfDay(d)); }
  if (/\btomorrow\b/i.test(query)) { const d = addDays(now, 1); return range(startOfDay(d), endOfDay(d)); }
  if (/\bnext\s+week\b/i.test(query)) { const d = addWeeks(now, 1); return range(startOfWeek(d), endOfWeek(d)); }
  if (/\bthis\s+quarter\b/i.test(query)) return { type: "relative", relativePeriod: "this_quarter" };
  if (/\b(?:last|previous|past)\s+quarter\b/i.test(query)) return { type: "relative", relativePeriod: "last_quarter" };
  return weekday(query, now);
}
