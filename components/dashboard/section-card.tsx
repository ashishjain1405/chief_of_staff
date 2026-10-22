import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

// One dashboard area: what it is, why to look, and one way in.
export function SectionCard({
  icon: Icon,
  title,
  description,
  href,
  linkLabel,
  children,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card shadow-sm ${className}`}>
      <header className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
            <Icon className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {href && linkLabel && (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {linkLabel}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </header>
      <div className="flex-1 px-5 pt-4 pb-5">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
