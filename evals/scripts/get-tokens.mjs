import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://lcdfdyjikdnlealjxoij.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZGZkeWppa2RubGVhbGp4b2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0ODYyOTUsImV4cCI6MjA5MzA2MjI5NX0.8xoINIfbSbAQvgYSmWc6VCmtpeFNJrBQWmPZJXk53gM";

if (!SERVICE_ROLE_KEY) {
  console.error("Run with: SUPABASE_SERVICE_ROLE_KEY=... node evals/scripts/get-tokens.mjs");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const USERS = [
  { email: "eval-a@test.local", password: "EvalPassword123!" },
  { email: "eval-b@test.local", password: "EvalPassword123!" },
];

for (const { email, password } of USERS) {
  // Find existing user by listing and filtering
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => u.email === email);

  let userId;

  if (existing) {
    // Confirm + reset password on existing user
    const { data: updated, error } = await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      password,
    });
    if (error) { console.error(`Update ${email}:`, error.message); continue; }
    userId = existing.id;
    console.log(`\nUpdated + confirmed: ${email}`);
  } else {
    // Create fresh with confirmation
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) { console.error(`Create ${email}:`, error.message); continue; }
    userId = created.user.id;
    console.log(`\nCreated: ${email}`);
  }

  // Sign in to get token
  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr) { console.error(`Sign in ${email}:`, signInErr.message); continue; }

  console.log(`USER_ID:      ${userId}`);
  console.log(`ACCESS_TOKEN: ${session.session.access_token}`);
}
