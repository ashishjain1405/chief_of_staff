const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "on", "in", "at", "by", "with", "from",
  "and", "or", "your", "you", "my", "it", "its", "is", "be", "this", "that",
  "before", "after", "now",
  // Timing words say when, not what - the same renewal restated as "before the
  // due date" and "before midnight" is one task.
  "due", "date", "expiry", "expires", "expire", "expired", "deadline", "today",
  "tomorrow", "tonight", "midnight", "soon", "days", "day",
  // "Let Rajvi know when to book" is "reply to Rajvi to schedule".
  "let", "when", "if",
]);

// The same ask in other words: five "schedule the next session with Rajvi"
// tasks survived because "book", "arrange" and "let ... know" share no letters
// with "schedule" and "reply".
const SYNONYMS: Record<string, string> = {
  book: "schedule", arrange: "schedule", plan: "schedule", fix: "schedule",
  respond: "reply", revert: "reply", answer: "reply", know: "reply", confirm: "reply",
  vehicle: "car", motor: "car", renewal: "renew", avail: "get", enjoy: "get",
};

// A different month or amount is a different ask: September's and
// October's electricity bills are two tasks, however alike their titles.
const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi;
const AMOUNTS = /\b\d{3,}\b/g;
const tokens = (title: string, re: RegExp) => new Set((title.toLowerCase().match(re) ?? []).map((t) => t.slice(0, 3)));
const disjoint = (x: Set<string>, y: Set<string>) => x.size > 0 && y.size > 0 && ![...x].some((t) => y.has(t));
const differs = (a: string, b: string) => disjoint(tokens(a, MONTHS), tokens(b, MONTHS)) || disjoint(tokens(a, AMOUNTS), tokens(b, AMOUNTS));

function keywords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map((w) => SYNONYMS[w] ?? w)
  );
}

// Strictly above half, so "Reply to Kamal" and "Reply to Kamal with the
// marketing plan" (exactly 0.5) stay separate asks.
const THRESHOLD = 0.5;

export function isSimilarTaskTitle(a: string, b: string): boolean {
  if (differs(a, b)) return false;
  const ka = keywords(a);
  const kb = keywords(b);
  if (ka.size === 0 || kb.size === 0) return false;
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared++;
  return shared / (ka.size + kb.size - shared) > THRESHOLD;
}
