import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type Sort = "newest" | "largest" | "smallest";

// Amount cycles largest first, smallest first, then back to newest; Date goes
// straight back to newest.
const nextAmountSort = (s: Sort): Sort => (s === "largest" ? "smallest" : s === "smallest" ? "newest" : "largest");

export const SORT_WORD: Record<Sort, string> = { newest: "Latest", largest: "Largest", smallest: "Smallest" };

// Rows arrive newest first; equal amounts keep that order.
export function sortRows<T extends { amount: number | null; transaction_datetime: string }>(rows: T[], sort: Sort): T[] {
  if (sort === "newest") return rows;
  const dir = sort === "largest" ? -1 : 1;
  return [...rows].sort((a, b) => dir * ((a.amount ?? 0) - (b.amount ?? 0)) || b.transaction_datetime.localeCompare(a.transaction_datetime));
}

const button = "items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function TransactionsHeader({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) {
  const byAmount = sort !== "newest";
  const Arrow = sort === "largest" ? ArrowDown : ArrowUp;
  const amountLabel = sort === "largest" ? "Sorted by amount, largest first. Sort smallest first"
    : sort === "smallest" ? "Sorted by amount, smallest first. Sort by date" : "Sort by amount, largest first";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-5 py-2.5 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_11rem_5rem_7rem]">
      <span>Merchant</span>
      <span className="hidden sm:block">Category</span>
      <button type="button" onClick={() => onSort("newest")} aria-pressed={!byAmount} aria-label={byAmount ? "Sort by date, newest first" : "Sorted by date, newest first"}
        className={`${button} hidden sm:inline-flex ${byAmount ? "" : "font-semibold text-foreground"}`}>
        Date
        {!byAmount && <ArrowDown className="size-3" aria-hidden />}
      </button>
      <button type="button" onClick={() => onSort(nextAmountSort(sort))} aria-label={amountLabel}
        className={`${button} inline-flex justify-self-end ${byAmount ? "font-semibold text-foreground" : ""}`}>
        Amount
        {byAmount ? <Arrow className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-60" aria-hidden />}
      </button>
    </div>
  );
}
