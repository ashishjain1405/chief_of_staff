import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import GenerateDraftButton from "./generate-draft-button";

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

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/inbox">
          <Button variant="ghost" size="sm">← Back</Button>
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{email.subject ?? "(no subject)"}</h1>
        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
          <span>From: {contact?.name ?? metadata?.from ?? "Unknown"}</span>
          {contact?.organization && <span>· {contact.organization}</span>}
          <span>· {new Date(email.occurred_at).toLocaleString()}</span>
          {email.sentiment && (
            <Badge variant="outline" className="text-xs">{email.sentiment}</Badge>
          )}
          {email.requires_action && !email.action_taken && (
            <Badge variant="secondary" className="text-xs">Needs Action</Badge>
          )}
        </div>
      </div>

      {email.body_summary && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Summary</p>
          <p className="text-sm">{email.body_summary}</p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Full Email</p>
        <div className="rounded-lg border p-4 text-sm whitespace-pre-wrap font-mono bg-background max-h-96 overflow-y-auto">
          {email.body ?? "No body content"}
        </div>
      </div>

      <GenerateDraftButton communicationId={id} initialDrafts={drafts ?? []} />
    </div>
  );
}
