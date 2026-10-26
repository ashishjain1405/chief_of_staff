"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { notSpendReason } from "@/lib/finance/spend";
import { matchesFor, planChange, recompute, rulesWithout, type Rule, type Snapshot, type UserCategory } from "@/lib/finance/rules";
import {
  changeTransaction, deleteCategory, deleteRule, renameCategory, resetTransaction, undoChange, type ChangeResult, type Undo,
} from "@/app/(dashboard)/finance/actions";
import { categoryLabel, istDate, merchantLabel } from "./labels";
import { TransactionEditor } from "./transaction-editor";
import { YourCategories, YourRules } from "./your-choices";
import { SORT_WORD, TransactionsHeader, sortRows, type Sort } from "./transactions-header";
import type { TransactionRow } from "./types";

const PAGE = 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A transfer is shown by who it went to: its "merchant" is usually the bank,
// the founder, or nothing ("Unknown merchant").
const TRANSFERS = new Set(["bank_transfer", "p2p_transfer"]);
const displayName = (r: TransactionRow) =>
  r.recipient_label && (!r.merchant_normalized || TRANSFERS.has(r.transaction_type ?? "")) ? `Transfer · ${r.recipient_label}` : merchantLabel(r.merchant_normalized);
const sourceNote = (s: string | null | undefined) => (s === "user" ? "set by you" : s === "rule" ? "your rule" : null);
const FAILED = "That change could not be saved, so nothing was changed. Try again.";

// The founder's corrections apply at once: the change is shown before the
// server confirms it, and Undo puts back exactly what the action changed.
export function TransactionsTable({ rows, summary, hidden, rules, categories, counts }: {
  rows: TransactionRow[]; summary: string; hidden?: { count: number; href: string };
  rules: Rule[]; categories: UserCategory[]; counts: Record<string, number>;
}) {
  const [view, apply] = useOptimistic(rows, (state: TransactionRow[], changes: Snapshot[]) => {
    const byId = new Map(changes.map((c) => [c.id, c]));
    return state.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r));
  });
  const [cats, applyCats] = useOptimistic(categories, (state: UserCategory[], c: { id: string; label: string | null }) =>
    c.label === null ? state.filter((x) => x.id !== c.id) : state.map((x) => (x.id === c.id ? { ...x, label: c.label! } : x)));
  const names = Object.fromEntries(cats.map((c) => [c.key, c.label]));
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undo?: Undo } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [shown, setShown] = useState(PAGE);
  const sorted = sortRows(view, sort);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = (optimistic: Snapshot[], action: () => Promise<Partial<ChangeResult> & { changed: number }>, message: (n: number) => string) => {
    setOpen(null);
    setFailed(null);
    startTransition(async () => {
      apply(optimistic);
      try {
        const result = await action();
        setToast({ message: message(result.changed), undo: result.undo });
      } catch {
        setFailed(FAILED);
      }
    });
  };

  const undo = () => {
    if (!toast?.undo) return;
    const { undo: u } = toast;
    setToast(null);
    startTransition(async () => {
      apply(u.rows);
      await undoChange(u).catch(() => setFailed(FAILED));
    });
  };

  const rename = (c: UserCategory, label: string) => {
    setFailed(null);
    startTransition(async () => {
      applyCats({ id: c.id, label });
      const result = await renameCategory(c.id, label).catch(() => ({ error: FAILED }));
      if (result.error) setFailed(result.error);
    });
  };
  const remove = (c: UserCategory) => {
    applyCats({ id: c.id, label: null });
    run(recompute(view, rulesWithout(rules, c.key), (r) => ({ category: r.category === c.key })).after, () => deleteCategory(c.id),
      (n) => `Deleted ${c.label}${n ? ` · ${plural(n, "transaction")} back to automatic` : ""}`);
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Transactions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {view.length > shown ? `${SORT_WORD[sort]} ${shown} of ${view.length} · ` : ""}select a category to change it
        </p>
      </header>

      {hidden && (
        <p className="mx-5 mb-3 text-xs text-muted-foreground">
          {hidden.count} not counted (transfers, card bills) hidden ·{" "}
          <Link href={hidden.href} scroll={false} className="font-medium text-sky-700 hover:underline dark:text-sky-300">Show</Link>
        </p>
      )}

      {failed && <p className="mx-5 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{failed}</p>}

      {view.length === 0 ? (
        <p className="px-5 pb-8 text-sm text-muted-foreground">No transactions match these filters.</p>
      ) : (
        <div className="border-t border-border/60">
          <TransactionsHeader sort={sort} onSort={setSort} />
          <ul className="divide-y divide-border/60">
            {sorted.slice(0, shown).map((r) => {
              const match = matchesFor(r, merchantLabel)[0] ?? null;
              const reason = notSpendReason(r);
              const toggle = () => setOpen(open === r.id ? null : r.id);
              const pill = (
                <button type="button" onClick={toggle} aria-expanded={open === r.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/70 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-500/10 dark:hover:text-sky-200">
                  <span className="truncate">{categoryLabel(r.category, names)}</span>
                  {sourceNote(r.category_source) && <span className="shrink-0 text-[10px] opacity-75">· {sourceNote(r.category_source)}</span>}
                  <ChevronDown className="size-3 shrink-0 opacity-60" aria-hidden />
                </button>
              );
              return (
                <li key={r.id}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_5rem_7rem]">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{displayName(r)}</span>
                        {r.communication_ids?.[0] && (
                          <Link href={`/inbox/${r.communication_ids[0]}`} aria-label="Open the email" className="shrink-0 text-muted-foreground hover:text-foreground">
                            <ArrowUpRight className="size-3.5" aria-hidden />
                          </Link>
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="sm:hidden">{pill}</span>
                        <span className="sm:hidden">{istDate(r.transaction_datetime)}</span>
                        {reason ? (
                          <button type="button" onClick={toggle} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-500/10 dark:hover:text-sky-200">
                            Not counted · {reason}
                          </button>
                        ) : r.counted_override ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Counted · {sourceNote(r.counted_source)}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden min-w-0 sm:block">{pill}</span>
                    <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{istDate(r.transaction_datetime)}</span>
                    <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-foreground">
                      {r.currency && r.currency !== "INR" ? `${r.currency} ` : "₹"}{Math.round(r.amount ?? 0).toLocaleString("en-IN")}
                    </span>
                  </div>
                  {open === r.id && (
                    <div className="border-t border-border/60 bg-muted/30 px-5 py-4">
                      <TransactionEditor
                        row={r}
                        match={match}
                        sharing={match ? counts[`${match.type}:${match.key}`] ?? 1 : 1}
                        categories={cats}
                        onClose={() => setOpen(null)}
                        onReset={() => run(recompute([r], rules, () => ({ category: true, counted: true })).after, () => resetTransaction(r.id), () => "Reset to automatic")}
                        onConfirm={(choice, scope) => {
                          const input = { id: r.id, field: choice.field, value: choice.value, scope, match: scope === "all" ? match ?? undefined : undefined };
                          run(planChange(view, rules, input).after, () => changeTransaction(input), (n) =>
                            choice.field === "category" ? `Moved ${plural(n, "transaction")} to ${categoryLabel(choice.value as string, names)}`
                              : `${choice.value ? "Counting" : "Not counting"} ${plural(n, "transaction")} as spend`);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {view.length > shown && (
            <div className="border-t border-border/60 px-5 py-3 text-center">
              <button type="button" onClick={() => setShown(shown + PAGE)} className="rounded-full px-4 py-1.5 text-sm font-medium text-sky-700 hover:bg-muted dark:text-sky-300">
                Show {Math.min(PAGE, view.length - shown)} more
              </button>
            </div>
          )}
        </div>
      )}

      <YourCategories categories={cats} counts={counts} onRename={rename} onDelete={remove} />
      <YourRules rules={rules} names={names}
        onRemove={(rule) => rule.id && run(recompute(view, rules.filter((x) => x.id !== rule.id), () => ({})).after, () => deleteRule(rule.id!),
          (n) => `Removed the rule for ${rule.label}${n ? ` · ${plural(n, "transaction")} back to automatic` : ""}`)} />

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-full bg-foreground px-5 py-3 text-sm text-background shadow-lg">
          <span className="truncate">{toast.message}</span>
          {toast.undo && <button type="button" onClick={undo} className="shrink-0 font-semibold text-sky-300 hover:text-sky-200">Undo</button>}
        </div>
      )}
    </section>
  );
}
