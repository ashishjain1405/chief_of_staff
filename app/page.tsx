import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LandingNavbar from "@/components/landing/Navbar";
import { HeroShowcase } from "@/components/landing/HeroShowcase";
import { SpendPreview } from "@/components/landing/SpendPreview";
import { AskPreview } from "@/components/landing/AskPreview";
import { TasksPreview } from "@/components/landing/TasksPreview";
import { BriefPreview } from "@/components/landing/BriefPreview";

export const metadata: Metadata = {
  title: "Chief of Staff · Your spending and deadlines, tracked from Gmail",
  description: "Turns the bank alerts, UPI receipts, bills and requests in your Gmail into a spending tracker and a to-do list with due dates. Ask about any of it in plain words. No bank login.",
};

// Everything here is something the product does today; Gmail and Google
// Calendar are the only live integrations.
const MONEY = [
  { title: "Counted once", desc: "A Zomato order sends a bank alert and a receipt. You see one transaction, not two." },
  { title: "Recategorise once", desc: "Move one payment and every other payment to that merchant or UPI ID follows, including future ones." },
  { title: "You decide what counts", desc: "Card bill or transfer? Choose what counts as spending, and add categories of your own." },
  { title: "Built for UPI", desc: "Reads Indian bank alerts and UPI payments, and remembers each payee by their UPI ID." },
];

const QUESTIONS = [
  "How much did I spend on Swiggy last month?",
  "When is my car insurance due?",
  "What did I promise Priya?",
  "What's on my calendar tomorrow?",
];

const DEADLINES = [
  { title: "Due dates, found for you", desc: "“Pay by 28 Oct” in an email becomes a task due 28 Oct. Overdue, today and tomorrow are flagged." },
  { title: "Ranked by what's at stake", desc: "Money you owe and people waiting on you come first. Newsletters and promotions are filtered out." },
  { title: "One task per conversation", desc: "A long email thread shows up as one task, not ten. Done or dismiss it in one tap." },
  { title: "Cleans up after itself", desc: "Expired reminders close on their own. Dismiss a sender's tasks twice and the next ones drop to low priority." },
];

const STEPS = [
  { title: "Connect Gmail", desc: "Sign in with Google. No bank login, no SMS access." },
  { title: "Every email is read", desc: "Payments are filed into categories with duplicates merged. Emails that need something from you become tasks with due dates." },
  { title: "Your brief at 8 am", desc: "What's due today, yesterday's spend by merchant, and who is waiting on you." },
];

const PRIVACY = [
  "Sign in with Google. No bank passwords, no SMS access.",
  "Nothing is sent from your Gmail unless you press Send.",
  "Your data is private to your account.",
  "Revoke access any time from your Google account.",
];

const cta = "inline-flex items-center justify-center rounded-full bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700";
const card = "rounded-2xl border border-border/70 bg-card p-5 shadow-sm";
const eyebrow = "text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300";

function SectionHeader({ label, title, desc }: { label: string; title: string; desc: string }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className={eyebrow}>{label}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">{desc}</p>
    </div>
  );
}

function Cards({ items }: { items: { title: string; desc: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((p) => (
        <div key={p.title} className={card}>
          <h3 className="font-semibold text-foreground">{p.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
        </div>
      ))}
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="bg-slate-50/70 dark:bg-background">
      <LandingNavbar />

      <section className="px-4 pt-14 pb-16 sm:pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div className="space-y-6">
            <p className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
              Works with Gmail and Google Calendar
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
              Know where your money went and what&apos;s due next.
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              Chief of Staff reads your Gmail for you. Bank alerts and UPI receipts become a spending tracker, emails that need you become a to-do list with deadlines, and you can ask about any of it in plain words.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/auth/login" className={cta}>Connect Gmail, free →</Link>
              <a href="#how-it-works" className="rounded-full px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
                See how it works
              </a>
            </div>
            <p className="text-xs text-muted-foreground">No bank login · No SMS access · Nothing sent without you</p>
          </div>
          <HeroShowcase slides={[
            { label: "Spending", content: <SpendPreview /> },
            { label: "Ask AI", content: <AskPreview /> },
            { label: "Tasks", content: <TasksPreview /> },
          ]} />
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHeader label="Spending" title="Spending you can trust" desc="One payment often shows up in two or three emails. It is counted once." />
          <Cards items={MONEY} />
        </div>
      </section>

      <section className="border-y border-border/60 bg-card px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHeader label="Ask AI" title="Ask about anything in your inbox" desc="Spending, deadlines, promises and meetings. Ask in plain words and get an answer from your own emails and receipts." />
          <ul className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2.5">
            {QUESTIONS.map((q) => (
              <li key={q} className="rounded-full border border-border bg-background px-4 py-2 text-sm text-foreground shadow-sm">“{q}”</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHeader label="Tasks and deadlines" title="Every deadline in your inbox, on one list" desc="Bills, renewals, replies and promises become tasks with due dates, ranked by what's at stake." />
          <Cards items={DEADLINES} />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Plus the commitments you&apos;ve made, people waiting on a reply, today&apos;s meetings, suggested replies and one-click unsubscribe.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-y border-border/60 bg-card px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <SectionHeader label="How it works" title="Connect once. It keeps up from there." desc="No forms to fill in, no receipts to forward." />
          <ol className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-semibold text-white">{i + 1}</span>
                <div>
                  <h3 className="font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-4 py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div className="space-y-4">
            <p className={eyebrow}>Daily brief</p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">One email every morning</h2>
            <p className="leading-relaxed text-muted-foreground">
              At 8 am you get the day in one read: your top three things to do, today&apos;s meetings, who is waiting on you, and what you spent yesterday, merchant by merchant.
            </p>
            <p className="leading-relaxed text-muted-foreground">Each to-do links straight to the email behind it, so acting on it takes one tap.</p>
          </div>
          <BriefPreview />
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className={`${card} mx-auto max-w-3xl p-6 sm:p-8`}>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Your inbox stays yours</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {PRIVACY.map((line) => (
              <li key={line} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-sky-600 px-4 py-14">
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white">Stay on top of your money and your deadlines.</h2>
          <p className="mt-2 text-sm text-sky-100">Connect Gmail once. Your brief arrives every morning at 8 am.</p>
          <Link href="/auth/login" className="mt-6 inline-flex rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50">
            Connect Gmail, free →
          </Link>
        </div>
      </section>
    </div>
  );
}
