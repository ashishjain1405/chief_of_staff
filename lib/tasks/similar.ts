const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "on", "in", "at", "by", "with", "from",
  "and", "or", "your", "you", "my", "it", "its", "is", "be", "this", "that",
  "before", "after", "now",
  // Timing words say when, not what - the same renewal restated as "before the
  // due date" and "before midnight" is one task.
  "due", "date", "expiry", "expires", "expire", "expired", "deadline", "today",
  "tomorrow", "tonight", "midnight", "soon", "days", "day",
]);

function keywords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
  );
}

// Strictly above half, so "Reply to Kamal" and "Reply to Kamal with the
// marketing plan" (exactly 0.5) stay separate asks.
const THRESHOLD = 0.5;

export function isSimilarTaskTitle(a: string, b: string): boolean {
  const ka = keywords(a);
  const kb = keywords(b);
  if (ka.size === 0 || kb.size === 0) return false;
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared++;
  return shared / (ka.size + kb.size - shared) > THRESHOLD;
}
