import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

async function markDone(formData: FormData) {
  "use server";
  const id = formData.get("id") as string;
  const { createServiceClient } = await import("@/lib/supabase/server");
  const supabase = await createServiceClient();
  await supabase.from("commitments").update({ status: "done" }).eq("id", id);
}

export default async function CommitmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: commitments } = await supabase
    .from("commitments")
    .select(`
      id, description, due_date, status, source_type, extracted_by, ai_confidence,
      contacts(name, email)
    `)
    .eq("user_id", user.id)
    .order("due_date", { ascending: true })
    .order("created_at", { ascending: false });

  const all = commitments ?? [];
  const pending = all.filter((c) => c.status === "pending");
  const overdue = all.filter((c) => c.status === "overdue");
  const done = all.filter((c) => c.status === "done");

  function StatusBadge({ status }: { status: string }) {
    if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
    if (status === "done") return <Badge variant="outline" className="text-green-600 border-green-300">Done</Badge>;
    return <Badge variant="secondary">Pending</Badge>;
  }

  function CommitmentRow({ c }: { c: any }) {
    const contact = c.contacts as any;
    const isOverdue = c.status === "overdue";

    return (
      <div className={`flex items-start gap-4 p-4 border-b last:border-0 ${isOverdue ? "bg-red-50/50" : ""}`}>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">{c.description}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            {contact?.name && <span>To: {contact.name}</span>}
            {c.source_type && <span>· Source: {c.source_type}</span>}
            {c.extracted_by === "ai" && c.ai_confidence && (
              <span>· AI confidence: {Math.round(c.ai_confidence * 100)}%</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <StatusBadge status={c.status} />
            {c.due_date && (
              <p className={`text-xs mt-1 ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
                {new Date(c.due_date).toLocaleDateString()}
              </p>
            )}
          </div>
          {c.status !== "done" && (
            <form action={markDone}>
              <input type="hidden" name="id" value={c.id} />
              <Button type="submit" variant="outline" size="sm">
                Mark done
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Commitments</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Things you&apos;ve committed to — extracted automatically from emails and meetings.
        </p>
      </div>

      {overdue.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-red-600 mb-2">Overdue ({overdue.length})</h2>
          <div className="rounded-lg border border-red-200 overflow-hidden">
            {overdue.map((c) => (
              <CommitmentRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Pending ({pending.length})</h2>
          <div className="rounded-lg border overflow-hidden">
            {pending.map((c) => (
              <CommitmentRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">Done ({done.length})</h2>
          <div className="rounded-lg border overflow-hidden opacity-70">
            {done.slice(0, 10).map((c) => (
              <CommitmentRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      )}

      {all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          No commitments tracked yet.
          <br />
          <span className="text-xs">Connect Gmail to start extracting commitments from emails automatically.</span>
        </div>
      )}
    </div>
  );
}
