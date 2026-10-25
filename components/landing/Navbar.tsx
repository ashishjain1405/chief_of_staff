import Link from "next/link";
import { Zap } from "lucide-react";

export default function LandingNavbar() {
  return (
    <nav className="bg-card/90 backdrop-blur border-b border-border/60 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-sky-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <span className="font-bold text-foreground text-sm">Chief of Staff</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            Sign in
          </Link>
          <Link
            href="/auth/login"
            className="bg-sky-600 text-white text-sm px-4 py-2 rounded-full font-semibold hover:bg-sky-700 transition-colors"
          >
            Connect Gmail
          </Link>
        </div>
      </div>
    </nav>
  );
}
