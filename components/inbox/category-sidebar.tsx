"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "./categories";

export { CATEGORIES };

export default function CategorySidebar({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const searchParams = useSearchParams();
  const active = searchParams.get("cat") ?? "important";

  return (
    <div className="w-52 shrink-0 border-r h-full overflow-y-auto py-4 px-2 space-y-0.5">
      {CATEGORIES.map((cat) => {
        const count = counts[cat.key] ?? 0;
        const isActive = active === cat.key;
        return (
          <Link
            key={cat.key}
            href={`/inbox?cat=${cat.key}`}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? "bg-foreground text-background font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs w-4 text-center">{cat.icon}</span>
              <span>{cat.label}</span>
            </div>
            {count > 0 && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}

      <div className="pt-2 border-t mt-2">
        <Link
          href="/finance"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <span className="text-xs w-4 text-center">📊</span>
          <span>Finance Dashboard</span>
        </Link>
      </div>
    </div>
  );
}
