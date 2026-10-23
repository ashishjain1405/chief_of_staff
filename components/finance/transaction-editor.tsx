import { useState, useTransition, type FormEvent } from "react";
import { CATEGORY_NAME_MAX, CATEGORY_OPTIONS, isCustomCategory, type Match, type UserCategory } from "@/lib/finance/rules";
import { notSpendReason } from "@/lib/finance/spend";
import { createCategory } from "@/app/(dashboard)/finance/actions";
import { categoryLabel } from "./labels";
import type { TransactionRow } from "./types";

type Choice = { field: "category"; value: string } | { field: "counted"; value: boolean };

const OPTIONS = [...CATEGORY_OPTIONS].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
const chip = "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

// Pick a category (or add one) or counting, then confirm the scope: this
// transaction and every other one from the same merchant or UPI payee (the
// default), or only this one.
export function TransactionEditor({ row, match, sharing, categories, onConfirm, onReset, onClose }: {
  row: TransactionRow;
  match: Match | null;
  sharing: number;
  categories: UserCategory[];
  onConfirm: (choice: Choice, scope: "one" | "all") => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [scope, setScope] = useState<"one" | "all">(match ? "all" : "one");
  // One just added, until the refreshed page brings it in.
  const [added, setAdded] = useState<{ key: string; label: string } | null>(null);
  const counted = notSpendReason(row) === null;
  const custom = (row.category_source && row.category_source !== "auto") || row.counted_source;
  const mine = added && isCustomCategory(added.key) && !categories.some((c) => c.key === added.key) ? [...categories, added] : categories;
  const names = Object.fromEntries(mine.map((c) => [c.key, c.label]));
  const options = [...mine.map((c) => c.key).sort((a, b) => names[a].localeCompare(names[b])), ...OPTIONS];

  if (choice) {
    const title = choice.field === "category" ? `Move to ${categoryLabel(choice.value, names)}` : choice.value ? "Count this as spend" : "Don't count this as spend";
    const all = match?.type === "upi" ? `This and all payments to ${match.label}`
      : match?.type === "recipient" ? `This and all transfers to or from ${match.label}`
      : `This and all ${match?.label} transactions`;
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
          {options.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => c !== row.category && setChoice({ field: "category", value: c })}
              aria-pressed={c === row.category}
              className={`${chip} ${c === row.category ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200" : "border-border bg-background text-foreground hover:bg-muted"}`}
            >
              {categoryLabel(c, names)}
            </button>
          ))}
          <NewCategory onAdded={(c) => {
            setAdded(c);
            if (c.key !== row.category) setChoice({ field: "category", value: c.key });
          }} />
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

// Named inline; a name that is already a category picks that one.
function NewCategory({ onAdded }: { onAdded: (c: { key: string; label: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const close = () => { setOpen(false); setName(""); setError(null); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${chip} border-dashed border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground`}>
        + New category
      </button>
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createCategory(name).catch(() => ({ error: "Could not add the category. Try again." }));
      if ("error" in result) return setError(result.error);
      close();
      onAdded(result);
    });
  };
  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 pt-1">
      <input autoFocus value={name} maxLength={CATEGORY_NAME_MAX} placeholder="Category name, e.g. Family" aria-label="New category name"
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Escape" && close()}
        className="h-8 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-sky-400 sm:max-w-xs" />
      <button type="submit" disabled={pending || !name.trim()} className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50">
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={close} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
        Cancel
      </button>
      {error && <p className="w-full text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </form>
  );
}
