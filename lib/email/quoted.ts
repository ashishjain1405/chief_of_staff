// A reply carries the entire thread beneath it, and triage classifies whatever
// it is handed. Kamal's question "If the tools exist, how do you plan to
// differentiate?" sits above 4000 characters of quoted wire-transfer history,
// so triage returned category "transactions" and requires_action false - no
// task for a direct question. The reverse happens too: "Prototypes are best
// viewed on Desktop" inherited the thread's investment ask and raised one.
//
// Applied to the triage input only. The stored body keeps the full thread,
// which summaries, embeddings and financial extraction all still need - a
// forwarded bank alert has its amount inside the quoted part.

// Below this much new text, assume the split went wrong - a bottom-posted
// reply, or a forward whose substance is entirely inside the quote - and hand
// back the original rather than triaging near-nothing.
const MIN_REMAINING_CHARS = 20;

const CUT_PATTERNS: RegExp[] = [
  // Gmail: "On Tue, Sep 8, 2026 at 11:46 AM piyush tyagi <x@y.com> wrote:".
  // Not line-anchored, because the header wraps across lines in real mail.
  /\bOn\s[\s\S]{0,200}?\bwrote:/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/im,
  // Outlook's divider, then its header block.
  /^\s*_{10,}\s*$/m,
  /^\s*From:\s.*\n\s*(Sent|Date):\s/im,
  // First quoted line.
  /^\s*>/m,
];

export function stripQuotedReply(body: string): string {
  if (!body) return body;
  const text = body.replace(/\r\n/g, "\n");

  let cut = text.length;
  for (const pattern of CUT_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }

  const head = text.slice(0, cut).trim();
  return head.replace(/\s/g, "").length >= MIN_REMAINING_CHARS ? head : body;
}
