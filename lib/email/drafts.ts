// Addresses that never read replies. Deliberately narrow - info@, hello@ and
// team@ are often people at small companies - so a real sender is not refused.
const NO_REPLY_SENDER = /^([a-z0-9]+[.+-])?(no-?reply|do-?not-?reply|donotreply|mailer-daemon)([.+-]|$)/i;

export function isNoReplySender(email: string): boolean {
  return NO_REPLY_SENDER.test((email.split("@")[0] ?? "").trim());
}

// "Send Reply" sends the text exactly as written, so a placeholder left in it
// reaches the recipient. Every draft once ended "[Your Name], Chief of Staff
// to [Founder's Name]". Checked on the server against the text actually sent.
const PLACEHOLDER = /\{\{|\}\}|\[[^\]\n]{0,60}\b(name|your|founder|insert|date|company|recipient)\b[^\]\n]{0,60}\]/i;

export function findPlaceholder(text: string): string | null {
  return PLACEHOLDER.exec(text)?.[0] ?? null;
}
