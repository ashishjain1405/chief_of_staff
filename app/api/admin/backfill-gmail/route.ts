import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enqueueGmailImport } from "@/lib/queues";

const ADMIN_SECRET = process.env.ADMIN_SECRET;

// Queues the 90-day Gmail history import for every connected account. The
// worker does the reading (worker/jobs/import-gmail-history); this used to run
// it inside the request, which a serverless function cuts off.
export async function POST(request: Request) {
  const { secret } = await request.json().catch(() => ({}));
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: integrations } = await supabase
    .from("integrations")
    .select("user_id")
    .eq("provider", "google");

  if (!integrations?.length) {
    return NextResponse.json({ message: "No Google integrations found" });
  }

  await Promise.all(integrations.map((i) => enqueueGmailImport(i.user_id)));
  return NextResponse.json({ message: "Import queued", users: integrations.length });
}
