import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function StatLink({
  icon: Icon,
  label,
  value,
  caption,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border/70 bg-card p-5 shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-[1.75rem] font-semibold leading-none tracking-tight text-foreground">{value}</p>
      <p className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        {caption}
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </p>
    </Link>
  );
}
