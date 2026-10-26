import Link from "next/link";
import { cn } from "@/lib/utils";
import { inr, inrCompact } from "./labels";

export type Column = {
  key: string;
  label: string;
  value: number;
  href?: string;
  // default: every bar alike; accent/soft: one bar emphasised, the rest receding.
  tone?: "default" | "accent" | "soft";
};

// One hue throughout: the columns are one series, so colour carries no
// identity. Steps validated with the dataviz palette script (>= 3:1 for the
// bar, >= 2:1 for the receding step) on light and dark card surfaces.
const TONE: Record<NonNullable<Column["tone"]>, string> = {
  default: "bg-[#5b93e6]",
  accent: "bg-[#3a7bd5] dark:bg-[#5b93e6]",
  soft: "bg-[#86b6ef] dark:bg-[#2c5a9e]",
};

// Round steps (10K, 20K, 50K...) with three to five intervals, so the axis
// reads ₹0 · ₹10K · ₹20K · ₹30K rather than ₹12.5K · ₹37.5K.
function axis(value: number): number[] {
  if (value <= 0) return [0, 1];
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const m of [magnitude / 10, magnitude]) {
    for (const f of [1, 2, 2.5, 5]) {
      const step = f * m;
      const n = Math.ceil(value / step);
      if (n >= 3 && n <= 5) return Array.from({ length: n + 1 }, (_, i) => i * step);
    }
  }
  return [0, value];
}

export function ColumnChart({ columns, label }: { columns: Column[]; label: string }) {
  const ticks = axis(Math.max(0, ...columns.map((c) => c.value)));
  const max = ticks[ticks.length - 1];

  return (
    <figure aria-label={label} lang="en" className="w-full">
      <div className="flex gap-2 sm:gap-3">
        {/* Y axis: compact ticks, aligned to the gridlines */}
        <div className="relative h-56 w-9 shrink-0 sm:w-11" aria-hidden>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-0 translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ bottom: `${(t / max) * 100}%` }}
            >
              {inrCompact(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden>
            {ticks.map((t) => (
              <div
                key={t}
                className={cn("absolute inset-x-0 border-t", t === 0 ? "border-border" : "border-border/50")}
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
          </div>

          <div className="relative flex justify-around gap-0.5 sm:gap-2">
            {columns.map((c, i) => (
              <ColumnBar key={c.key} column={c} max={max} edge={i === 0 ? "start" : i === columns.length - 1 ? "end" : undefined} />
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

// Edge columns anchor their tooltip inward so it never runs past the card.
const TOOLTIP_X = {
  start: "left-0",
  end: "right-0",
  center: "left-1/2 -translate-x-1/2",
};

// A single word too long for the column ("Entertainment", "Uncategorised")
// was clipped, and browsers do not reliably hyphenate it, so it is set a step smaller.
const LONG_WORD = 10;

function ColumnBar({ column: c, max, edge }: { column: Column; max: number; edge?: "start" | "end" }) {
  const pct = c.value > 0 ? Math.max((c.value / max) * 100, 1.5) : 0;
  const longWord = c.label.split(/\s+/).some((w) => w.length > LONG_WORD);
  const body = (
    <>
      <div className="relative flex h-56 w-full items-end justify-center">
        <div className="relative w-full max-w-6" style={{ height: `${pct}%` }}>
          <div
            className={cn(
              "h-full w-full rounded-t-[4px] transition-opacity duration-150 group-hover:opacity-80 group-focus-visible:opacity-80",
              TONE[c.tone ?? "default"]
            )}
          />
          {/* Every column carries its value; it gives way to the tooltip on hover. */}
          <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
            {inrCompact(c.value)}
          </span>
          <span
            role="tooltip"
            className={cn("pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg", TOOLTIP_X[edge ?? "center"], " bg-foreground px-2.5 py-1.5 text-center opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100")}
          >
            <span className="block text-xs font-semibold text-background">{inr(c.value)}</span>
            <span className="block text-[11px] text-background/70">{c.label}</span>
          </span>
        </div>
      </div>
      <span className={cn("mt-2 line-clamp-2 w-full text-center leading-tight hyphens-auto [overflow-wrap:anywhere] text-muted-foreground group-hover:text-foreground sm:px-0.5", longWord ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]")}>
        {c.label}
      </span>
    </>
  );

  // The whole column - bar, air above it and its label - is the hit target.
  const className =
    "group flex min-w-0 flex-1 flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
  return c.href ? (
    <Link href={c.href} className={className} aria-label={`${c.label}: ${inr(c.value)}`} scroll={false}>
      {body}
    </Link>
  ) : (
    <div className={className} tabIndex={0} aria-label={`${c.label}: ${inr(c.value)}`}>
      {body}
    </div>
  );
}

// The table-view twin: every value reachable without hovering.
export function ChartTable({ columns, valueHeader }: { columns: Column[]; valueHeader: string }) {
  return (
    <details className="group/table mt-4">
      <summary className="cursor-pointer list-none text-xs text-muted-foreground transition-colors hover:text-foreground">
        <span className="group-open/table:hidden">View as table</span>
        <span className="hidden group-open/table:inline">Hide table</span>
      </summary>
      <table className="mt-3 w-full text-xs">
        <tbody className="divide-y divide-border/60">
          {columns.map((c) => (
            <tr key={c.key}>
              <td className="py-1.5 text-muted-foreground">{c.label}</td>
              <td className="py-1.5 text-right tabular-nums text-foreground">{inr(c.value)}</td>
            </tr>
          ))}
        </tbody>
        <caption className="sr-only">{valueHeader}</caption>
      </table>
    </details>
  );
}
