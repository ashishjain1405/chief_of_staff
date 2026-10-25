import { ColumnChart, type Column } from "@/components/finance/column-chart";

// Sample numbers, not anyone's data, drawn with the Finance page's own chart.
const CATEGORIES: [string, number][] = [
  ["Groceries", 8450], ["Food delivery", 6120], ["Shopping", 5380], ["Transport", 2940], ["Utilities", 1499], ["Other", 3210],
];
const TOTAL = CATEGORIES.reduce((sum, [, v]) => sum + v, 0);

const columns = (count: number): Column[] => {
  const head = CATEGORIES.slice(0, count).map(([label, value], i) => ({ key: label, label, value, showValue: i === 0 }));
  const rest = CATEGORIES.slice(count).reduce((sum, [, v]) => sum + v, 0);
  return rest ? [...head, { key: "rest", label: "Other", value: rest }] : head;
};

export function SpendPreview() {
  return (
    <figure aria-label="Example of the Finance page with sample spending" className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Spend by category</p>
        <p className="text-xs text-muted-foreground">This month</p>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground tabular-nums">₹{TOTAL.toLocaleString("en-IN")}</p>
      <div className="mt-5">
        <div className="sm:hidden"><ColumnChart columns={columns(3)} label="Sample spending by category" /></div>
        <div className="hidden sm:block"><ColumnChart columns={columns(6)} label="Sample spending by category" /></div>
      </div>
      <ul className="mt-5 divide-y divide-border/60 border-t border-border/60 text-sm">
        <li className="flex items-start justify-between gap-3 pt-3 pb-2.5">
          <span className="min-w-0">
            <span className="block font-medium text-foreground">Zomato</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">Bank alert + Zomato receipt · counted once</span>
          </span>
          <span className="font-medium tabular-nums text-foreground">₹642</span>
        </li>
        <li className="flex items-start justify-between gap-3 pt-2.5">
          <span className="min-w-0">
            <span className="block font-medium text-foreground">Credit card bill</span>
            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Not counted · the purchases already are</span>
          </span>
          <span className="font-medium tabular-nums text-muted-foreground">₹18,400</span>
        </li>
      </ul>
    </figure>
  );
}
