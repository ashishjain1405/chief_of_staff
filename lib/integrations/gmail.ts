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

export function parseEmailBody(payload: any): string {
  if (!payload) return "";

  // text/plain preferred
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  // multipart: recurse
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = parseEmailBody(part);
      if (text) return text;
    }
  }

  // fallback to html body
  if (payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64").toString("utf-8");
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
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
