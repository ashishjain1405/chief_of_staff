import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";

export async function getGmailClient(userId: string) {
  const auth = await getAuthenticatedClient(userId);
  return google.gmail({ version: "v1", auth });
}

export async function fetchEmailById(userId: string, messageId: string) {
  const gmail = await getGmailClient(userId);
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return data;
}

export async function fetchHistorySince(userId: string, startHistoryId: string) {
  const gmail = await getGmailClient(userId);
  const { data } = await gmail.users.history.list({
    userId: "me",
    startHistoryId,
    historyTypes: ["messageAdded"],
  });
  return data.history ?? [];
}

// Below this, a text/plain part is assumed to be boilerplate rather than
// content - plenty of senders ship one holding only an unsubscribe line.
const MIN_USEFUL_CHARS = 100;

function decodePart(part: any): string {
  const data = part?.body?.data;
  return data ? Buffer.from(data, "base64").toString("utf-8") : "";
}

function stripHtml(html: string): string {
  return (
    html
      // Normalise line endings first: the collapse rules below match \n, so
      // CRLF markup came out as long runs of "\r\n \r\n \r\n".
      .replace(/\r\n?/g, "\n")
      // Contents as well as the tags. Stripping only tags left the CSS between
      // <style>...</style> behind as plain text, which is how 41% of stored
      // bodies ended up starting with "@media screen and ...".
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      // <[^>]+> only matches a comment up to its first '>', so bodies and
      // trailing '-->' leaked through.
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Keep block structure: the model reads a receipt far better as lines
      // than as one collapsed run of text.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function collectTextParts(payload: any, out: { plain: string[]; html: string[] }) {
  if (!payload) return;
  const mime = payload.mimeType ?? "";

  if (mime === "text/plain") {
    const t = decodePart(payload);
    if (t) out.plain.push(t);
  } else if (mime === "text/html") {
    const t = decodePart(payload);
    if (t) out.html.push(t);
  } else if (!payload.parts) {
    // Single-part message with some other mime type - treat as markup.
    const t = decodePart(payload);
    if (t) out.html.push(t);
  }

  for (const p of payload.parts ?? []) collectTextParts(p, out);
}

export function parseEmailBody(payload: any): string {
  // Gather every candidate across the tree rather than returning the first
  // non-empty part found depth-first, which picked whichever branch happened to
  // come first - including a near-empty text/plain sibling of the real content.
  const found = { plain: [] as string[], html: [] as string[] };
  collectTextParts(payload, found);

  const byLength = (a: string, b: string) => b.length - a.length;
  const plain = found.plain.map((t) => t.replace(/\r\n/g, "\n").trim()).sort(byLength)[0] ?? "";

  if (plain.length >= MIN_USEFUL_CHARS) return plain;

  const stripped = stripHtml(found.html.sort(byLength)[0] ?? "");
  // Never return less than we already had: protects genuinely short
  // transactional emails ("Your payment was successful", ~75 chars).
  return stripped.length >= plain.length ? stripped : plain;
}

export function parseEmailHtml(payload: any): string {
  if (!payload) return "";

  // text/html preferred for rendering
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  // multipart: recurse, but collect html as fallback
  if (payload.parts) {
    let htmlFallback = "";
    for (const part of payload.parts) {
      const result = parseEmailHtml(part);
      if (result && !htmlFallback) htmlFallback = result;
    }
    if (htmlFallback) return htmlFallback;
  }

  // text/plain fallback — wrap in <pre> for formatting
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    const text = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
  }

  return "";
}

export function extractHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function watchGmailInbox(userId: string): Promise<{ historyId: string; expiration: string }> {
  const gmail = await getGmailClient(userId);
  const { data } = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID}/topics/gmail-push`,
      labelIds: ["INBOX"],
    },
  });
  return { historyId: data.historyId!, expiration: data.expiration! };
}

export async function stopGmailWatch(userId: string) {
  const gmail = await getGmailClient(userId);
  await gmail.users.stop({ userId: "me" });
}

export async function sendEmail(
  userId: string,
  { to, subject, body, threadId }: { to: string; subject: string; body: string; threadId?: string }
) {
  const gmail = await getGmailClient(userId);
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n");

  const encoded = Buffer.from(message).toString("base64url");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded, threadId },
  });
}
