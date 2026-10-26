"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, X } from "lucide-react";
import { filtersHref, toggleCategory, type Filters } from "@/lib/finance/periods";

type Option = { key: string; label: string };
// More chips than this wrap onto a second line and push the page about on
// every click; the rest are a count that opens the menu.
const CHIPS = 3;
const pill = "inline-flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 text-sm text-foreground shadow-sm transition-colors hover:bg-muted";

// Period, categories and Spending/All, kept in the address so the page (a
// server component) reads them and links, Back and reloads keep them.
export function FilterBar({ filters, period, defaultPeriod, options, categories }: {
  filters: Filters;
  period: string; // the resolved period key
  defaultPeriod: string;
  options: { rolling: Option[]; months: Option[] };
  categories: { key: string; label: string; total: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const menu = useRef<HTMLDetailsElement>(null);

  // The category menu closes on a click anywhere else.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const go = (next: Partial<Filters>) => {
    const f = { ...filters, ...next };
    startTransition(() => router.replace(filtersHref({ ...f, period: f.period === defaultPeriod ? undefined : f.period }), { scroll: false }));
  };
  const nameOf = (key: string) => categories.find((c) => c.key === key)?.label ?? key;
  const summary = !filters.cats.length ? "All categories" : filters.cats.length === 1 ? nameOf(filters.cats[0]) : `${filters.cats.length} categories`;
  const filtered = period !== defaultPeriod || filters.cats.length > 0 || filters.show === "all";
  // In the menu's order (by spend), not the order they were picked: picking
  // appended to the end, so the chips reshuffled on every click.
  const selected = [...categories.map((c) => c.key).filter((k) => filters.cats.includes(k)), ...filters.cats.filter((k) => !categories.some((c) => c.key === k))];
  const allSelected = categories.length > 0 && categories.every((c) => filters.cats.includes(c.key));
  const menuAction = "rounded px-1.5 py-0.5 font-medium text-sky-700 hover:underline disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline dark:text-sky-300";

  return (
    <section aria-label="Filters" aria-busy={pending} className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <span className="sr-only">Period</span>
          <select value={period} onChange={(e) => go({ period: e.target.value })} className={`${pill} appearance-none pr-8 font-medium`}>
            <optgroup label="Rolling">
              {options.rolling.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
            <optgroup label="Month">
              {options.months.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </label>

        <details ref={menu} className="relative">
          <summary className={`${pill} cursor-pointer list-none font-medium`}>
            {summary}
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </summary>
          <div className="absolute left-0 z-30 mt-2 max-h-80 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border/70 bg-card p-1.5 pt-0 shadow-lg">
            <div className="sticky top-0 z-10 -mx-1.5 mb-1 flex items-center justify-between border-b border-border/60 bg-card px-3 py-2 text-xs">
              <button type="button" disabled={allSelected} onClick={() => go({ cats: categories.map((c) => c.key) })} className={menuAction}>Select all</button>
              <button type="button" disabled={!filters.cats.length} onClick={() => go({ cats: [] })} className={menuAction}>Clear</button>
            </div>
            {categories.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">No spending in this period.</p>}
            {categories.map((c) => (
              <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted">
                <input type="checkbox" checked={filters.cats.includes(c.key)} onChange={() => go({ cats: toggleCategory(filters.cats, c.key) })} className="accent-sky-600" />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.total}</span>
              </label>
            ))}
          </div>
        </details>

        <div role="group" aria-label="Show" className="inline-flex h-9 items-center rounded-full border border-border/70 bg-card p-0.5 shadow-sm">
          {(["spend", "all"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={filters.show === s} onClick={() => go({ show: s })}
              className={`h-full rounded-full px-3.5 text-sm transition-colors ${filters.show === s ? "bg-sky-600 font-medium text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {s === "spend" ? "Spending" : "All"}
            </button>
          ))}
        </div>

        {filtered && (
          <button type="button" onClick={() => go({ period: defaultPeriod, cats: [], show: "spend" })} className="px-2 text-sm font-medium text-sky-700 hover:underline dark:text-sky-300">
            Clear all
          </button>
        )}
        {pending && <span className="text-xs text-muted-foreground" role="status">Updating…</span>}
      </div>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected categories">
          {selected.slice(0, CHIPS).map((c) => (
            <li key={c}>
              <button type="button" onClick={() => go({ cats: filters.cats.filter((x) => x !== c) })} aria-label={`Remove ${nameOf(c)}`}
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300">
                {nameOf(c)}
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          {selected.length > CHIPS && (
            <li>
              <button type="button" onClick={() => { if (menu.current) menu.current.open = true; }}
                className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                +{selected.length - CHIPS} more
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
