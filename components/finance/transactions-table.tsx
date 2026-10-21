import Link from "next/link";
import { X } from "lucide-react";
import { notSpendReason } from "@/lib/finance/spend";
import { categoryLabel, istDate, merchantLabel } from "./labels";

const SHOWN = 100;

export type TransactionRow = {
  id: string;
  merchant_normalized: string | null;
  category: string | null;
  transaction_datetime: string;
  transaction_type: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  communication_ids?: string[] | null;
};

export function TransactionsTable({ rows, category }: { rows: TransactionRow[]; category?: string }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-foreground">Transactions</h2>
          {category && (
            <Link
              href="/finance"
              scroll={false}
              className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300"
              aria-label={`Clear the ${categoryLabel(category)} filter`}
            >
              {categoryLabel(category)}
              <X className="size-3" aria-hidden />
            </Link>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {rows.length > SHOWN ? `Latest ${SHOWN} of ${rows.length}` : `${rows.length} in the last 6 months`}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 pb-8 text-sm text-muted-foreground">No transactions here yet.</p>
      ) : (
        <div className="border-t border-border/60">
          <div className="hidden grid-cols-[minmax(0,1fr)_10rem_5rem_7rem] gap-4 px-5 py-2.5 text-xs text-muted-foreground sm:grid">
            <span>Merchant</span>
            <span>Category</span>
            <span>Date</span>
            <span className="text-right">Amount</span>
          </div>
          <ul className="divide-y divide-border/60">
            {rows.slice(0, SHOWN).map((r) => (
              <li key={r.id}>
                <Row r={r} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Row({ r }: { r: TransactionRow }) {
  const reason = notSpendReason(r);
  const href = r.communication_ids?.[0] ? `/inbox/${r.communication_ids[0]}` : null;
  const cells = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{merchantLabel(r.merchant_normalized)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
          {categoryLabel(r.category)} · {istDate(r.transaction_datetime)}
        </span>
        {reason && (
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            Not counted · {reason}
          </span>
        )}
      </span>
      <span className="hidden sm:block">
        <span className="inline-block rounded-full bg-muted/70 px-2.5 py-0.5 text-xs text-muted-foreground">
          {categoryLabel(r.category)}
        </span>
      </span>
      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{istDate(r.transaction_datetime)}</span>
      <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-foreground">
        {r.currency && r.currency !== "INR" ? `${r.currency} ` : "₹"}
        {Math.round(r.amount ?? 0).toLocaleString("en-IN")}
      </span>
    </>
  );
  const className =
    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_5rem_7rem]";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-muted/40`}>
      {cells}
    </Link>
  ) : (
    <div className={className}>{cells}</div>
  );
}
