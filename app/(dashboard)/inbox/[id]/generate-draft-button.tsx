"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface Draft {
  id: string;
  draft_text: string;
  status: string;
  created_at: string;
}

export default function GenerateDraftButton({
  communicationId,
  initialDrafts,
}: {
  communicationId: string;
  initialDrafts: Draft[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState<Record<string, string>>({});

  async function generateDraft() {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId }),
      });
      const { draft } = await res.json();
      if (draft) {
        setDrafts((prev) => [draft, ...prev]);
        setEditing(draft.id);
        setEditText((prev) => ({ ...prev, [draft.id]: draft.draft_text }));
        toast.success("Draft generated");
      }
    } catch {
      toast.error("Failed to generate draft");
    } finally {
      setLoading(false);
    }
  }

  async function sendReply(draft: Draft) {
    const body = editText[draft.id] ?? draft.draft_text;
    setSending(draft.id);
    try {
      const res = await fetch("/api/actions/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId, draftId: draft.id, body }),
      });
      if (!res.ok) throw new Error("Send failed");
      setDrafts((prev) =>
        prev.map((d) => (d.id === draft.id ? { ...d, status: "sent" } : d))
      );
      setEditing(null);
      toast.success("Reply sent");
    } catch {
      toast.error("Failed to send reply");
    } finally {
      setSending(null);
    }
  }

  function startEdit(draft: Draft) {
    setEditing(draft.id);
    setEditText((prev) => ({ ...prev, [draft.id]: draft.draft_text }));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Draft Replies
        </p>
        <Button size="sm" variant="outline" onClick={generateDraft} disabled={loading}>
          {loading ? "Generating..." : "Generate Draft"}
        </Button>
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drafts yet. Click "Generate Draft" to create an AI reply.</p>
      ) : (
        drafts.map((draft) => (
          <div key={draft.id} className="rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b">
              <Badge
                variant={draft.status === "sent" ? "outline" : "secondary"}
                className="text-xs"
              >
                {draft.status === "sent" ? "Sent" : draft.status === "pending_review" ? "Draft" : draft.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(draft.created_at).toLocaleString()}
              </span>
            </div>

            <div className="p-4">
              {editing === draft.id && draft.status !== "sent" ? (
                <Textarea
                  value={editText[draft.id] ?? draft.draft_text}
                  onChange={(e) =>
                    setEditText((prev) => ({ ...prev, [draft.id]: e.target.value }))
                  }
                  rows={8}
                  className="text-sm font-sans resize-none"
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{draft.draft_text}</p>
              )}
            </div>

            {draft.status !== "sent" && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t bg-muted/10">
                {editing === draft.id ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => sendReply(draft)}
                      disabled={sending === draft.id}
                    >
                      {sending === draft.id ? "Sending..." : "Send Reply"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(draft)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => sendReply(draft)}
                      disabled={sending === draft.id}
                    >
                      {sending === draft.id ? "Sending..." : "Send Reply"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
