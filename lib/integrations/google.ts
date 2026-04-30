import { google } from "googleapis";
import { encrypt, decrypt } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/server";

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

export function getAuthUrl(): string {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  });
}

export async function saveTokens(
  userId: string,
  tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    id_token?: string | null;
  },
  email?: string
) {
  const supabase = await createServiceClient();
  await supabase.from("integrations").upsert(
    {
      user_id: userId,
      provider: "google",
      access_token: tokens.access_token ? encrypt(tokens.access_token) : null,
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      token_expires_at: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      scopes: [
        "gmail.readonly",
        "gmail.send",
        "gmail.modify",
        "calendar.readonly",
        "calendar.events",
      ],
      is_active: true,
      ...(email ? { external_account_id: email } : {}),
    },
    { onConflict: "user_id,provider" }
  );
}

export async function getAuthenticatedClient(userId: string) {
  const supabase = await createServiceClient();
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "google")
    .single();

  if (!integration) throw new Error("Google not connected");

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: integration.access_token ? decrypt(integration.access_token) : undefined,
    refresh_token: integration.refresh_token ? decrypt(integration.refresh_token) : undefined,
    expiry_date: integration.token_expires_at
      ? new Date(integration.token_expires_at).getTime()
      : undefined,
  });

  // Auto-refresh if expiring within 5 minutes
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    await saveTokens(userId, credentials);
  }

  return oauth2Client;
}
