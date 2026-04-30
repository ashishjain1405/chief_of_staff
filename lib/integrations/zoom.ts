import crypto from "crypto";

let zoomTokenCache: { token: string; expiresAt: number } | null = null;

export async function getZoomAccessToken(): Promise<string> {
  if (zoomTokenCache && Date.now() < zoomTokenCache.expiresAt - 60000) {
    return zoomTokenCache.token;
  }

  const credentials = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}` },
    }
  );

  const data = await res.json();
  zoomTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export function verifyZoomWebhook(
  body: string,
  signature: string,
  timestamp: string
): boolean {
  const message = `v0:${timestamp}:${body}`;
  const hash = crypto
    .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN!)
    .update(message)
    .digest("hex");
  return `v0=${hash}` === signature;
}

export async function getMeetingRecordings(meetingId: string): Promise<any> {
  const token = await getZoomAccessToken();
  const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function downloadTranscript(downloadUrl: string): Promise<string> {
  const token = await getZoomAccessToken();
  const res = await fetch(`${downloadUrl}?access_token=${token}`);
  if (!res.ok) throw new Error(`Transcript download failed: ${res.status}`);
  return res.text();
}

export function parseVttTranscript(vttText: string): string {
  const lines = vttText.split("\n");
  const textLines: string[] = [];
  let skip = true;

  for (const line of lines) {
    // Skip WEBVTT header and timestamps
    if (line.startsWith("WEBVTT") || line.match(/^\d{2}:\d{2}/) || line.trim() === "") {
      skip = line.match(/^\d{2}:\d{2}/) ? false : skip;
      continue;
    }
    if (line.match(/^\d+$/) || line.trim() === "") continue;
    if (!skip) textLines.push(line.trim());
  }

  return textLines.join(" ").replace(/\s+/g, " ").trim();
}
