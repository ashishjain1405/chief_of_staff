import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import GenerateDraftButton from "./generate-draft-button";
import EmailActions from "./email-actions";

function formatEmailBody(body: string): string {
  // Strip trailing quoted reply lines (lines starting with ">")
  const lines = body.split("\n");
  const quoteStart = lines.findIndex((l) => l.trim().startsWith(">"));
  const trimmed = quoteStart > 0 ? lines.slice(0, quoteStart) : lines;
  return trimmed.join("\n").trim();
}

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: email } = await supabase
    .from("communications")
    .select("*, contacts(name, email, organization)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!email) notFound();

  const { data: drafts } = await supabase
    .from("drafts")
    .select("id, draft_text, status, created_at")
    .eq("communication_id", id)
    .order("created_at", { ascending: false });

  const contact = email.contacts as any;
  const metadata = email.channel_metadata as any ?? {};
  const fromRaw = metadata?.from ?? contact?.name ?? "Unknown";
  const toRaw = metadata?.to ?? "";
  const body = email.body ? formatEmailBody(email.body) : "";

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/inbox">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
        <EmailActions
          communicationId={id}
          hasUnsubscribe={!!metadata?.list_unsubscribe}
        />
      </div>

      {/* Email card */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold leading-snug">{email.subject ?? "(no subject)"}</h1>
            <div className="flex items-center gap-1.5 shrink-0">
              {email.sentiment && (
                <Badge variant="outline" className="text-xs">{email.sentiment}</Badge>
              )}
              {email.requires_action && !email.action_taken && (
                <Badge variant="secondary" className="text-xs">Needs Action</Badge>
              )}
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-8 shrink-0">From</span>
              <span className="font-medium">{fromRaw}</span>
            </div>
            {toRaw && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-8 shrink-0">To</span>
                <span>{toRaw}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-muted-foreground w-8 shrink-0">Date</span>
              <span>{new Date(email.occurred_at).toLocaleString("en-US", {
                weekday: "short", year: "numeric", month: "short",
                day: "numeric", hour: "2-digit", minute: "2-digit"
              })}</span>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        {email.body_summary && (
          <div className="px-5 py-3 bg-muted/40 border-b flex gap-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-0.5 shrink-0">AI</span>
            <p className="text-sm text-muted-foreground">{email.body_summary}</p>
          </div>
        )}

        {/* Body */}
        <div className="p-5">
          <div className="text-sm leading-relaxed whitespace-pre-wrap text-foreground font-sans">
            {body || "No body content"}
          </div>
        </div>
      </div>

      <GenerateDraftButton communicationId={id} initialDrafts={drafts ?? []} />
    </div>
  );
}
