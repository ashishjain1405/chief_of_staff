import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import LandingNavbar from "@/components/landing/Navbar";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <>
      <LandingNavbar />

      {/* Hero */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 text-xs font-semibold px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 inline-block" />
                AI-powered for founders
              </div>

              <h1 className="text-5xl font-bold tracking-tight text-gray-900 leading-tight">
                Never drop the ball again.
              </h1>

              <p className="text-lg text-gray-500 leading-relaxed">
                Your AI chief of staff tracks emails, meetings, commitments, and relationships — so you can focus on building.
              </p>

              <div className="flex items-center gap-3 pt-2">
                <Link
                  href="/auth/login"
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors text-sm"
                >
                  Get Started free →
                </Link>
                <a
                  href="#how-it-works"
                  className="border border-gray-200 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors text-sm"
                >
                  See how it works
                </a>
              </div>
            </div>

            {/* Dashboard mockup */}
            <div className="hidden lg:block">
              <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gray-200" />
                    <div className="w-3 h-3 rounded-full bg-gray-200" />
                    <div className="w-3 h-3 rounded-full bg-gray-200" />
                  </div>
                  <div className="flex-1 bg-white rounded-md h-5 mx-4" />
                </div>
                <div className="bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="h-4 w-32 bg-gray-900 rounded font-bold" />
                      <div className="h-3 w-24 bg-gray-200 rounded mt-1.5" />
                    </div>
                    <div className="h-8 w-20 bg-blue-600 rounded-lg" />
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {["border-l-red-400", "border-l-amber-400", "border-l-blue-400", "border-l-violet-400"].map((c) => (
                      <div key={c} className={`border ${c} border-l-4 rounded-lg p-3 space-y-1`}>
                        <div className="h-5 w-8 bg-gray-900 rounded" />
                        <div className="h-2.5 w-full bg-gray-100 rounded" />
                        <div className="h-2 w-12 bg-blue-200 rounded" />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[0, 1].map((i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-4 space-y-2.5">
                        <div className="h-3 w-24 bg-gray-900 rounded" />
                        {[0, 1, 2].map((j) => (
                          <div key={j} className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                            <div className="h-2.5 flex-1 bg-gray-100 rounded" />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-16 px-4 bg-gray-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Up and running in minutes</h2>
            <p className="text-gray-500 text-sm">Connect once. Let AI do the heavy lifting.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Connect Gmail",
                desc: "OAuth in one click. Your emails are synced and processed in real time.",
              },
              {
                step: "2",
                title: "AI triages everything",
                desc: "Each email is categorized, scored for importance, and financial data is extracted automatically.",
              },
              {
                step: "3",
                title: "Dashboard surfaces what matters",
                desc: "Priorities, commitments, meetings — all in one place, ready for action.",
              },
            ].map((s) => (
              <div key={s.step} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center shrink-0">
                  {s.step}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{s.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Everything a founder needs to stay on top</h2>
            <p className="text-gray-500 text-sm">Built for speed. Designed to get out of your way.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div className="flex flex-col gap-3 bg-blue-50/60 rounded-xl p-6 border-l-4 border-blue-500">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V19.5z" />
                </svg>
              </div>
              <div>
                <div className="text-lg font-bold text-blue-600 mb-0.5">Inbox Intelligence</div>
                <div className="text-sm font-semibold text-gray-800 mb-1">AI-triaged email</div>
                <p className="text-xs text-gray-500 leading-relaxed">Importance scoring, auto-categorization into 8 categories, one-click draft replies, and unsubscribe detection.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 bg-violet-50/60 rounded-xl p-6 border-l-4 border-violet-400">
              <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center text-violet-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                </svg>
              </div>
              <div>
                <div className="text-lg font-bold text-violet-600 mb-0.5">Commitment Tracking</div>
                <div className="text-sm font-semibold text-gray-800 mb-1">Never forget what you promised</div>
                <p className="text-xs text-gray-500 leading-relaxed">AI extracts commitments from every email and meeting. Due dates, who you owe, and follow-up alerts — automatically.</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 bg-indigo-50/60 rounded-xl p-6 border-l-4 border-indigo-400">
              <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <div>
                <div className="text-lg font-bold text-indigo-600 mb-0.5">Finance Overview</div>
                <div className="text-sm font-semibold text-gray-800 mb-1">Spend tracking from your inbox</div>
                <p className="text-xs text-gray-500 leading-relaxed">Weekly and monthly spend totals, sub-category breakdowns, and a full transaction history — all extracted from your emails.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA strip */}
      <section className="py-14 px-4 bg-blue-600">
        <div className="max-w-6xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Your AI chief of staff is ready.</h2>
          <p className="text-blue-100 text-sm mb-6">Takes 2 minutes to connect your Gmail.</p>
          <Link
            href="/auth/login"
            className="inline-block bg-white text-blue-600 px-8 py-3.5 rounded-lg font-semibold hover:bg-blue-50 transition-colors text-sm"
          >
            Get Started →
          </Link>
        </div>
      </section>
    </>
  );
}
