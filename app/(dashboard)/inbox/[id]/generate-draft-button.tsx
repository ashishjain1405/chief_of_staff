"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
        toast.success("Draft generated");
      }
    } catch {
      toast.error("Failed to generate draft");
    } finally {
      setLoading(false);
    }
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
        <p className="text-sm text-muted-foreground">No drafts yet.</p>
      ) : (
        drafts.map((draft) => (
          <div key={draft.id} className="rounded-lg border p-4 space-y-2">
            <p className="text-sm whitespace-pre-wrap">{draft.draft_text}</p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{draft.status}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(draft.created_at).toLocaleString()}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
