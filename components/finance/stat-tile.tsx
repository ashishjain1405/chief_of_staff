import type { LucideIcon } from "lucide-react";

export function StatTile({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">{value}</p>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}
