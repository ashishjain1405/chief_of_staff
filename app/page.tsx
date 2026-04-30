import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-2xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          AI-powered chief of staff
        </div>

        <h1 className="text-5xl font-bold tracking-tight">Never drop the ball again.</h1>

        <p className="text-xl text-muted-foreground leading-relaxed">
          Your AI chief of staff tracks emails, meetings, commitments, and relationships — so you
          can focus on building.
        </p>

        <div className="flex items-center justify-center gap-4 pt-4">
          <Link href="/auth/login">
            <Button size="lg">Get Started</Button>
          </Link>
          <Link href="/auth/login">
            <Button variant="outline" size="lg">
              Sign In
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-3 gap-6 pt-12 text-left">
          {[
            {
              icon: "📬",
              title: "Unified Inbox",
              desc: "AI-triaged emails with importance scoring and draft replies",
            },
            {
              icon: "🤝",
              title: "Relationships",
              desc: "Track investors, customers, hires, and partners in one place",
            },
            {
              icon: "📋",
              title: "Commitments",
              desc: "Never forget what you promised — AI extracts them automatically",
            },
          ].map((f) => (
            <div key={f.title} className="p-4 rounded-xl border bg-card">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="font-semibold mb-1">{f.title}</div>
              <div className="text-sm text-muted-foreground">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
