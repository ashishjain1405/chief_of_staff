import Link from "next/link";
import { Zap } from "lucide-react";

export default function LandingNavbar() {
  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" strokeWidth={2} />
          </div>
          <span className="font-bold text-gray-900 text-sm">Chief of Staff</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/auth/login"
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors font-medium"
          >
            Sign in
          </Link>
          <Link
            href="/auth/login"
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
          >
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
