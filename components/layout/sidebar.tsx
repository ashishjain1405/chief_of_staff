"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { FEATURES } from "@/lib/features";
import { useRouter } from "next/navigation";
import {
  Zap,
  Inbox,
  Calendar,
  ClipboardList,
  CheckSquare,
  Sparkles,
  BarChart2,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";

const navItems = [
  { href: "/dashboard",      label: "Dashboard",     icon: Zap },
  { href: "/inbox",          label: "Inbox",         icon: Inbox },
  { href: "/meetings",       label: "Meetings",      icon: Calendar },
  ...(FEATURES.commitments
    ? [{ href: "/commitments", label: "Commitments", icon: ClipboardList }]
    : []),
  { href: "/tasks",          label: "Tasks",         icon: CheckSquare },
  { href: "/ask",            label: "Ask AI",        icon: Sparkles },
  { href: "/finance",        label: "Finance",       icon: BarChart2 },
];

const linkClass = (active: boolean) =>
  cn(
    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
    active ? "bg-blue-50 text-blue-600 font-medium" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
  );

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2">
      <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
        <Zap className="w-4 h-4 text-white" strokeWidth={2} />
      </div>
      <span className="font-bold text-gray-900 text-sm">Chief of Staff</span>
    </Link>
  );
}

// The same links in the desktop sidebar and the phone menu; onNavigate closes the menu.
function NavLinks({ pathname, onNavigate, onSignOut }: { pathname: string; onNavigate?: () => void; onSignOut: () => void }) {
  return (
    <>
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} className={linkClass(isActive)}>
              <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-blue-600" : "text-gray-400")} strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-gray-100 space-y-0.5">
        <Link href="/settings" onClick={onNavigate} className={linkClass(pathname === "/settings")}>
          <Settings className="w-4 h-4 shrink-0 text-gray-400" strokeWidth={1.75} />
          Settings
        </Link>
        <button
          onClick={onSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0 text-gray-400" strokeWidth={1.75} />
          Sign out
        </button>
      </div>
    </>
  );
}

// A fixed sidebar from md up. On phones it took 224px of a 390px screen, so
// there it is a top bar whose menu opens the same links over the page.
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  }

  return (
    <>
      <header className="md:hidden h-14 shrink-0 flex items-center justify-between px-4 border-b border-gray-100 bg-white">
        <Brand />
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
          className="-mr-2 p-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900">
          <Menu className="w-5 h-5" strokeWidth={1.75} />
        </button>
      </header>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Menu" className="md:hidden fixed inset-0 z-50"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[80%] flex flex-col bg-white shadow-xl">
            <div className="px-4 h-14 flex items-center justify-between border-b border-gray-100">
              <Brand />
              <button type="button" autoFocus onClick={() => setOpen(false)} aria-label="Close menu"
                className="-mr-2 p-2 rounded-lg text-gray-600 hover:bg-gray-50 hover:text-gray-900">
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} onSignOut={handleSignOut} />
          </aside>
        </div>
      )}

      <aside className="hidden md:flex w-56 flex-col border-r border-gray-100 bg-white h-full shrink-0">
        <div className="px-4 h-16 flex items-center border-b border-gray-100">
          <Brand />
        </div>
        <NavLinks pathname={pathname} onSignOut={handleSignOut} />
      </aside>
    </>
  );
}
