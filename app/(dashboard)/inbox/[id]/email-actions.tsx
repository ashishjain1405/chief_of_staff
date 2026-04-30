"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function EmailActions({
  communicationId,
  hasUnsubscribe,
}: {
  communicationId: string;
  hasUnsubscribe: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  async function markSpam() {
    setLoading("spam");
    try {
      const res = await fetch("/api/actions/mark-spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Marked as spam");
      router.push("/inbox");
    } catch {
      toast.error("Failed to mark as spam");
    } finally {
      setLoading(null);
    }
  }

  async function markDone() {
    setLoading("done");
    try {
      const res = await fetch("/api/actions/mark-done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Marked as done");
      router.push("/inbox");
    } catch {
      toast.error("Failed to mark as done");
    } finally {
      setLoading(null);
    }
  }

  async function unsubscribe() {
    setLoading("unsub");
    try {
      const res = await fetch("/api/actions/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast.success("Unsubscribed successfully");
      router.push("/inbox");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to unsubscribe");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={markDone} disabled={loading !== null}>
        {loading === "done" ? "Saving..." : "Mark Done"}
      </Button>
      {hasUnsubscribe && (
        <Button
          size="sm"
          variant="outline"
          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          onClick={unsubscribe}
          disabled={loading !== null}
        >
          {loading === "unsub" ? "Unsubscribing..." : "Unsubscribe"}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="text-red-600 hover:text-red-700 hover:bg-red-50"
        onClick={markSpam}
        disabled={loading !== null}
      >
        {loading === "spam" ? "Marking..." : "Mark Spam"}
      </Button>
    </div>
  );
}
