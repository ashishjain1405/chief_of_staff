import { useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { CATEGORY_NAME_MAX, cleanCategoryName, type Rule, type UserCategory } from "@/lib/finance/rules";
import { builtInCategory, categoryLabel } from "./labels";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const heading = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const quiet = "shrink-0 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground";

// Categories and rules, in a panel over the page rather than under the
// transaction list, where they sat after hundreds of rows.
export function ChoicesPanel({ open, onClose, hasCategories, hasRules, children }: {
  open: boolean; onClose: () => void; hasCategories: boolean; hasRules: boolean; children: ReactNode;
}) {
  if (!open) return null;
  const hint = "px-5 py-4 text-sm leading-relaxed text-muted-foreground";
  return (
    <div role="dialog" aria-modal="true" aria-label="Categories and rules" className="fixed inset-0 z-50" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/30" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">Categories &amp; rules</h2>
          <button type="button" autoFocus onClick={onClose} aria-label="Close" className="-mr-2 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto [&>div:first-child]:border-t-0">
          {children}
          {!hasCategories && <p className={hint}>No categories of your own yet. Add one from any transaction&apos;s category menu with <span className="font-medium text-foreground">+ New category</span>.</p>}
          {!hasRules && <p className={hint}>No rules yet. A rule is made when you change a transaction and choose <span className="font-medium text-foreground">This and all…</span></p>}
        </div>
      </aside>
    </div>
  );
}

export function YourRules({ rules, names, onRemove }: { rules: Rule[]; names: Record<string, string>; onRemove: (rule: Rule) => void }) {
  if (!rules.length) return null;
  return (
    <div className="border-t border-border/60 px-5 py-4">
      <p className={heading}>Your rules ({rules.length})</p>
      <ul className="mt-2 divide-y divide-border/60">
        {rules.map((rule) => (
          <li key={rule.id ?? `${rule.match_type}:${rule.match_key}`} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 text-foreground">
              <span className="font-medium">{rule.label}</span>
              <span className="text-muted-foreground">
                {rule.category ? ` → ${categoryLabel(rule.category, names)}` : ""}
                {rule.counted !== null ? ` · ${rule.counted ? "always counted" : "never counted"}` : ""}
              </span>
            </span>
            <button type="button" disabled={!rule.id} onClick={() => onRemove(rule)} className={quiet}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The founder's own categories: rename in place, or delete - its
// transactions go back to their automatic category.
export function YourCategories({ categories, counts, onRename, onDelete }: {
  categories: UserCategory[]; counts: Record<string, number>;
  onRename: (c: UserCategory, label: string) => void; onDelete: (c: UserCategory) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!categories.length) return null;

  const label = cleanCategoryName(name);
  const problem = !label ? null
    : builtInCategory(label) ? `${categoryLabel(builtInCategory(label))} is already a category`
    : categories.some((c) => c.id !== editing && c.label.toLowerCase() === label.toLowerCase()) ? `You already have ${label}` : null;
  const save = (e: FormEvent, c: UserCategory) => {
    e.preventDefault();
    if (!label || problem) return;
    setEditing(null);
    if (label !== c.label) onRename(c, label);
  };

  return (
    <div className="border-t border-border/60 px-5 py-4">
      <p className={heading}>Your categories ({categories.length})</p>
      <ul className="mt-2 divide-y divide-border/60">
        {[...categories].sort((a, b) => a.label.localeCompare(b.label)).map((c) => {
          const n = counts[`category:${c.key}`] ?? 0;
          if (editing === c.id) {
            return (
              <li key={c.id} className="py-2">
                <form onSubmit={(e) => save(e, c)} className="flex flex-wrap items-center gap-2">
                  <input autoFocus value={name} maxLength={CATEGORY_NAME_MAX} aria-label={`New name for ${c.label}`}
                    onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                    className="h-8 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-sky-400 sm:max-w-xs" />
                  <button type="submit" disabled={!label || !!problem} className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className={quiet}>Cancel</button>
                  {problem && <p className="w-full text-xs text-rose-700 dark:text-rose-300">{problem}</p>}
                </form>
              </li>
            );
          }
          return (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-0 text-foreground">
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground"> · {plural(n, "transaction")}</span>
              </span>
              {confirming === c.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-muted-foreground">{n ? `${plural(n, "transaction")} go back to automatic` : "Delete it?"}</span>
                  <button type="button" onClick={() => { setConfirming(null); onDelete(c); }} className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10">Delete</button>
                  <button type="button" onClick={() => setConfirming(null)} className={quiet}>Keep</button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => { setEditing(c.id); setName(c.label); setConfirming(null); }} className={quiet}>Rename</button>
                  <button type="button" onClick={() => setConfirming(c.id)} className={quiet}>Delete</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
