import Link from "next/link";
import { CalendarDays, Inbox, ListChecks, MessageSquareText, Wallet, type LucideIcon } from "lucide-react";

const AREAS: { href: string; icon: LucideIcon; title: string; description: string }[] = [
  { href: "/finance", icon: Wallet, title: "Finance", description: "Spending this month and the trend" },
  { href: "/inbox", icon: Inbox, title: "Inbox", description: "Email sorted by what it needs" },
  { href: "/tasks", icon: ListChecks, title: "Tasks", description: "Everything you owe, by due date" },
  { href: "/meetings", icon: CalendarDays, title: "Meetings", description: "Your calendar and summaries" },
  { href: "/ask", icon: MessageSquareText, title: "Ask AI", description: "Questions about any of it" },
];

export function Explore() {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {AREAS.map(({ href, icon: Icon, title, description }) => (
        <li key={href}>
          <Link
            href={href}
            className="flex h-full items-start gap-3 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:border-sky-200 hover:bg-sky-50/50 dark:hover:border-sky-500/30 dark:hover:bg-sky-500/5"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{title}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{description}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
