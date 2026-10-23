import { useState } from "react";
import { CATEGORY_OPTIONS, type Match } from "@/lib/finance/rules";
import { notSpendReason } from "@/lib/finance/spend";
import { categoryLabel } from "./labels";
import type { TransactionRow } from "./types";

type Choice = { field: "category"; value: string } | { field: "counted"; value: boolean };

const OPTIONS = [...CATEGORY_OPTIONS].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
const chip = "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

// Pick a category or counting, then confirm the scope: this transaction and
// every other one from the same merchant or UPI payee (the default), or only
// this one.
export function TransactionEditor({ row, match, sharing, onConfirm, onReset, onClose }: {
  row: TransactionRow;
  match: Match | null;
  sharing: number;
  onConfirm: (choice: Choice, scope: "one" | "all") => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [scope, setScope] = useState<"one" | "all">(match ? "all" : "one");
  const counted = notSpendReason(row) === null;
  const custom = (row.category_source && row.category_source !== "auto") || row.counted_source;

  if (choice) {
    const title = choice.field === "category" ? `Move to ${categoryLabel(choice.value)}` : choice.value ? "Count this as spend" : "Don't count this as spend";
    const all = match?.type === "upi" ? `This and all payments to ${match.label}` : `This and all ${match?.label} transactions`;
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <fieldset className="space-y-2 text-sm text-foreground">
          {match && (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name={`scope-${row.id}`} checked={scope === "all"} onChange={() => setScope("all")} className="mt-1 accent-sky-600" />
              <span>{all} <span className="text-muted-foreground">({sharing} so far, and all future ones)</span></span>
            </label>
          )}
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" name={`scope-${row.id}`} checked={scope === "one"} onChange={() => setScope("one")} className="mt-1 accent-sky-600" />
            <span>Only this one</span>
          </label>
        </fieldset>
        <div className="flex gap-2">
          <button type="button" onClick={() => onConfirm(choice, scope)} className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700">
            Confirm
          </button>
          <button type="button" onClick={() => setChoice(null)} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {OPTIONS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => c !== row.category && setChoice({ field: "category", value: c })}
              aria-pressed={c === row.category}
              className={`${chip} ${c === row.category ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              {categoryLabel(c)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Counting</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => !counted && setChoice({ field: "counted", value: true })} aria-pressed={counted}
            className={`${chip} ${counted ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" : "border-border bg-background text-foreground hover:bg-muted"}`}>
            Count as spend
          </button>
          <button type="button" onClick={() => counted && setChoice({ field: "counted", value: false })} aria-pressed={!counted}
            className={`${chip} ${!counted ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" : "border-border bg-background text-foreground hover:bg-muted"}`}>
            Don&apos;t count
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {custom && (
          <button type="button" onClick={onReset} className="rounded-full px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-muted dark:text-sky-300">
            Reset this one to automatic
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          Close
        </button>
      </div>
    </div>
  );
}
