"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  Zap,
  Inbox,
  Calendar,
  Users,
  ClipboardList,
  CheckSquare,
  Sparkles,
  BarChart2,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/dashboard",      label: "Dashboard",     icon: Zap },
  { href: "/inbox",          label: "Inbox",         icon: Inbox },
  { href: "/meetings",       label: "Meetings",      icon: Calendar },
  { href: "/relationships",  label: "Relationships", icon: Users },
  { href: "/commitments",    label: "Commitments",   icon: ClipboardList },
  { href: "/tasks",          label: "Tasks",         icon: CheckSquare },
  { href: "/ask",            label: "Ask AI",        icon: Sparkles },
  { href: "/finance",        label: "Finance",       icon: BarChart2 },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <aside className="w-56 flex flex-col border-r border-gray-100 bg-white h-full shrink-0">
      <div className="px-4 h-16 flex items-center border-b border-gray-100">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <span className="font-bold text-gray-900 text-sm">Chief of Staff</span>
        </Link>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-blue-50 text-blue-600 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-blue-600" : "text-gray-400")} strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-gray-100 space-y-0.5">
        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
            pathname === "/settings"
              ? "bg-blue-50 text-blue-600 font-medium"
              : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
          )}
        >
          <Settings className="w-4 h-4 shrink-0 text-gray-400" strokeWidth={1.75} />
          Settings
        </Link>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0 text-gray-400" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
