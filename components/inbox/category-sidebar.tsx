"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, CATEGORY_GROUPS } from "@/lib/inbox/categories";

export { CATEGORIES };

export default function CategorySidebar({
  counts,
}: {
  counts: Record<string, number>;
}) {
  const searchParams = useSearchParams();
  const active = searchParams.get("cat") ?? "important";

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(CATEGORY_GROUPS.map((g) => [g.key, g.defaultCollapsed]))
  );

  return (
    <div className="w-52 shrink-0 border-r h-full overflow-y-auto py-4 px-2 space-y-3">
      {CATEGORY_GROUPS.map((group) => {
        const groupCategories = CATEGORIES.filter((c) => c.group === group.key);
        const isCollapsed = collapsed[group.key];
        const groupTotal = groupCategories.reduce((sum, c) => sum + (counts[c.key] ?? 0), 0);

        return (
          <div key={group.key}>
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
              className="w-full flex items-center justify-between px-3 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
            >
              <span>{group.label}</span>
              <span className="flex items-center gap-1.5">
                {groupTotal > 0 && <span className="text-[10px] text-muted-foreground/70">{groupTotal}</span>}
                <span className={`text-[10px] transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>▾</span>
              </span>
            </button>

            {!isCollapsed && (
              <div className="space-y-0.5 mt-0.5">
                {groupCategories.map((cat) => {
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
              </div>
            )}
          </div>
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
