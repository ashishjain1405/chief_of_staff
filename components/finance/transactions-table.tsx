"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { ArrowUpRight, ChevronDown, X } from "lucide-react";
import { notSpendReason } from "@/lib/finance/spend";
import { matchesFor, planChange, recompute, type Rule, type Snapshot } from "@/lib/finance/rules";
import { changeTransaction, deleteRule, resetTransaction, undoChange, type ChangeResult, type Undo } from "@/app/(dashboard)/finance/actions";
import { categoryLabel, istDate, merchantLabel } from "./labels";
import { TransactionEditor } from "./transaction-editor";
import type { TransactionRow } from "./types";

const SHOWN = 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// A transfer is shown by who it went to: its "merchant" is usually the bank,
// the founder, or nothing ("Unknown merchant").
const TRANSFERS = new Set(["bank_transfer", "p2p_transfer"]);
const displayName = (r: TransactionRow) =>
  r.recipient_label && (!r.merchant_normalized || TRANSFERS.has(r.transaction_type ?? "")) ? `Transfer · ${r.recipient_label}` : merchantLabel(r.merchant_normalized);
const sourceNote = (s: string | null | undefined) => (s === "user" ? "set by you" : s === "rule" ? "your rule" : null);

// The founder's corrections apply at once: the change is shown before the
// server confirms it, and Undo puts back exactly what the action changed.
export function TransactionsTable({ rows, category, rules, counts }: {
  rows: TransactionRow[]; category?: string; rules: Rule[]; counts: Record<string, number>;
}) {
  const [view, apply] = useOptimistic(rows, (state: TransactionRow[], changes: Snapshot[]) => {
    const byId = new Map(changes.map((c) => [c.id, c]));
    return state.map((r) => (byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r));
  });
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; undo: Undo } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 10000);
    return () => clearTimeout(t);
  }, [toast]);

  const run = (optimistic: Snapshot[], action: () => Promise<ChangeResult>, message: (n: number) => string) => {
    setOpen(null);
    setFailed(false);
    startTransition(async () => {
      apply(optimistic);
      try {
        const result = await action();
        setToast({ message: message(result.changed), undo: result.undo });
      } catch {
        setFailed(true);
      }
    });
  };

  const undo = () => {
    if (!toast) return;
    const { undo: u } = toast;
    setToast(null);
    startTransition(async () => {
      apply(u.rows);
      await undoChange(u).catch(() => setFailed(true));
    });
  };

  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Transactions</h2>
          {category && (
            <Link href="/finance" scroll={false} aria-label={`Clear the ${categoryLabel(category)} filter`}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300">
              {categoryLabel(category)}
              <X className="size-3" aria-hidden />
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {view.length > SHOWN ? `Latest ${SHOWN} of ${view.length}` : `${view.length} in the last 6 months`} · select a category to change it
        </p>
      </header>

      {failed && <p className="mx-5 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">That change could not be saved, so nothing was changed. Try again.</p>}

      {view.length === 0 ? (
        <p className="px-5 pb-8 text-sm text-muted-foreground">No transactions here yet.</p>
      ) : (
        <div className="border-t border-border/60">
          <div className="hidden grid-cols-[minmax(0,1fr)_11rem_5rem_7rem] gap-4 px-5 py-2.5 text-xs text-muted-foreground sm:grid">
            <span>Merchant</span><span>Category</span><span>Date</span><span className="text-right">Amount</span>
          </div>
          <ul className="divide-y divide-border/60">
            {view.slice(0, SHOWN).map((r) => {
              const match = matchesFor(r, merchantLabel)[0] ?? null;
              const reason = notSpendReason(r);
              const toggle = () => setOpen(open === r.id ? null : r.id);
              const pill = (
                <button type="button" onClick={toggle} aria-expanded={open === r.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted/70 px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-500/10 dark:hover:text-sky-200">
                  <span className="truncate">{categoryLabel(r.category)}</span>
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
                        onClose={() => setOpen(null)}
                        onReset={() => run(recompute([r], rules, () => ({ category: true, counted: true })).after, () => resetTransaction(r.id), () => "Reset to automatic")}
                        onConfirm={(choice, scope) => {
                          const input = { id: r.id, field: choice.field, value: choice.value, scope, match: scope === "all" ? match ?? undefined : undefined };
                          run(planChange(view, rules, input).after, () => changeTransaction(input), (n) =>
                            choice.field === "category" ? `Moved ${plural(n, "transaction")} to ${categoryLabel(choice.value as string)}`
                              : `${choice.value ? "Counting" : "Not counting"} ${plural(n, "transaction")} as spend`);
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rules.length > 0 && (
        <div className="border-t border-border/60 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your rules ({rules.length})</p>
          <ul className="mt-2 divide-y divide-border/60">
            {rules.map((rule) => (
              <li key={rule.id ?? `${rule.match_type}:${rule.match_key}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 text-foreground">
                  <span className="font-medium">{rule.label}</span>
                  <span className="text-muted-foreground">
                    {rule.category ? ` → ${categoryLabel(rule.category)}` : ""}
                    {rule.counted !== null ? ` · ${rule.counted ? "always counted" : "never counted"}` : ""}
                  </span>
                </span>
                <button type="button" disabled={!rule.id}
                  onClick={() => rule.id && run(recompute(view, rules.filter((x) => x.id !== rule.id), () => ({})).after, () => deleteRule(rule.id!), (n) => `Removed the rule for ${rule.label}${n ? ` · ${plural(n, "transaction")} back to automatic` : ""}`)}
                  className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-md items-center justify-between gap-4 rounded-full bg-foreground px-5 py-3 text-sm text-background shadow-lg">
          <span className="truncate">{toast.message}</span>
          <button type="button" onClick={undo} className="shrink-0 font-semibold text-sky-300 hover:text-sky-200">Undo</button>
        </div>
      )}
    </section>
  );
}
