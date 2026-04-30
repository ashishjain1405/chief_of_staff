import { getOAuthClient, saveTokens } from "@/lib/integrations/google";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      new URL("/settings?error=google_auth_failed", process.env.NEXT_PUBLIC_APP_URL!)
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/login", process.env.NEXT_PUBLIC_APP_URL!));
  }

  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Fetch Google account email to store as external_account_id
  const { google } = await import("googleapis");
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const { data: googleUser } = await oauth2.userinfo.get();

  await saveTokens(user.id, tokens, googleUser.email ?? undefined);

  // Start Gmail Pub/Sub watch if project ID is configured
  if (process.env.GOOGLE_CLOUD_PROJECT_ID) {
    try {
      const { watchGmailInbox } = await import("@/lib/integrations/gmail");
      const { historyId, expiration } = await watchGmailInbox(user.id);
      const { createServiceClient } = await import("@/lib/supabase/server");
      const serviceSupabase = await createServiceClient();
      await serviceSupabase
        .from("integrations")
        .update({
          metadata: {
            last_history_id: historyId,
            watch_expires_at: new Date(Number(expiration)).toISOString(),
          },
        })
        .eq("user_id", user.id)
        .eq("provider", "google");
    } catch (e) {
      console.error("Gmail watch setup failed:", e);
    }
  }

  // Check if onboarding is complete to redirect appropriately
  const { data: profile } = await supabase
    .from("users")
    .select("onboarding_complete")
    .eq("id", user.id)
    .single();

  const destination = profile?.onboarding_complete
    ? "/settings?connected=google"
    : "/onboarding?connected=google";

  return NextResponse.redirect(new URL(destination, process.env.NEXT_PUBLIC_APP_URL!));
}
