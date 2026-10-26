import Link from "next/link";
import type { ReactNode } from "react";
import type { Brief, BriefItem, Tone } from "@/lib/brief/build";
import { MERCHANTS, comparison, firstStep, inr, moreMerchants, refundNote, times } from "@/lib/brief/render";

// The brief in the email's sections (lib/brief/render renderHtml): what to do
// and who is waiting on one side; the day, money and clean-up on the other.
// Every chip says its word, never colour alone.
const TONES: Record<Tone, string> = {
  overdue: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  today: "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300",
  soon: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  waiting: "bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300",
  new: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  neutral: "bg-muted text-muted-foreground",
};
const go = "text-xs font-semibold text-sky-700 hover:underline dark:text-sky-300";
const quiet = "text-[13px] leading-relaxed text-muted-foreground";

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-background/60 p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {count ? <span className="ml-1 font-medium">({count})</span> : null}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Item({ item, number, step }: { item: BriefItem; number?: number; step?: string }) {
  return (
    <li className="flex gap-3">
      {number && (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-bold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{number}</span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-foreground">{item.action}</p>
        {item.context && <p className={`mt-0.5 ${quiet}`}>{item.context}</p>}
        {step && <p className="mt-1 text-[13px] leading-relaxed text-sky-700 dark:text-sky-300"><span className="font-semibold">First step:</span> {step}</p>}
        {(item.chips.length > 0 || item.link) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.chips.map((c) => (
              <span key={c.label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[c.tone]}`}>{c.label}</span>
            ))}
            {item.link && <Link href={item.link.href} className={go}>{item.link.label} →</Link>}
          </div>
        )}
      </div>
    </li>
  );
}

const List = ({ children }: { children: ReactNode }) => <ul className="space-y-4">{children}</ul>;

export function BriefSections({ brief: b }: { brief: Brief }) {
  const m = b.money;
  return (
    <div className="space-y-4">
      {b.start && b.top[0]?.key !== b.start.key && (
        <div className="rounded-xl border-l-[3px] border-sky-600 bg-sky-50 px-4 py-3 dark:bg-sky-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Start here</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{b.start.action}</p>
          {b.start.step && <p className={`mt-0.5 ${quiet}`}>{b.start.step}</p>}
          {b.start.link && <Link href={b.start.link.href} className={`mt-1.5 inline-block ${go}`}>{b.start.link.label} →</Link>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="Today's top 3">
            {b.top.length ? (
              <List>{b.top.map((i, n) => <Item key={i.key} item={i} number={n + 1} step={firstStep(b, i)} />)}</List>
            ) : (
              <p className={quiet}>Nothing pressing today.</p>
            )}
          </Section>
          {b.alsoDue.length > 0 && (
            <Section title="Also due this week" count={b.alsoDue.length}>
              <List>{b.alsoDue.map((i) => <Item key={i.key} item={i} />)}</List>
            </Section>
          )}
          {b.waiting.length > 0 && (
            <Section title="Waiting on you" count={b.waiting.length + b.waitingMore}>
              <List>{b.waiting.map((i) => <Item key={i.key} item={i} />)}</List>
              {b.waitingMore > 0 && <p className={`mt-3 ${quiet}`}>+{b.waitingMore} more in your inbox</p>}
            </Section>
          )}
          {b.followUps.length > 0 && (
            <Section title="Follow-ups" count={b.followUps.length}>
              <List>{b.followUps.map((i) => <Item key={i.key} item={i} />)}</List>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Schedule">
            {b.schedule.length ? (
              <ul className="space-y-2">
                {b.schedule.map((s) => (
                  <li key={`${s.time}${s.title}`} className="flex gap-3 text-sm">
                    <span className="w-14 shrink-0 font-semibold tabular-nums text-foreground">{s.time}</span>
                    <span className="min-w-0 text-foreground">{s.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={quiet}>No meetings in the next 24 hours.</p>
            )}
          </Section>
          {m && (
            <Section title="Money">
              <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">{inr(m.spent)}</p>
              <p className={quiet}>Spent in {m.month} so far{comparison(m) ? ` · ${comparison(m)}` : ""}</p>
              <p className="mt-4 text-sm font-semibold text-foreground">
                Yesterday <span className="font-medium text-muted-foreground">· {inr(m.yesterday.total)}</span>
              </p>
              {m.yesterday.merchants.length ? (
                <ul className="mt-1.5 divide-y divide-border/60 text-sm">
                  {m.yesterday.merchants.slice(0, MERCHANTS).map((x) => (
                    <li key={x.name} className="flex justify-between gap-3 py-1.5">
                      <span className="min-w-0 text-foreground">
                        {x.name}
                        <span className="text-muted-foreground">{times(x.count)}{refundNote(x) ? ` · ${refundNote(x)}` : ""}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-foreground">{inr(x.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-0.5 ${quiet}`}>Nothing spent yesterday.</p>
              )}
              {m.yesterday.merchants.length > MERCHANTS && <p className={`mt-1.5 ${quiet}`}>{moreMerchants(m.yesterday.merchants.length - MERCHANTS)}</p>}
              <Link href="/finance" className={`mt-3 inline-block ${go}`}>Open finance →</Link>
            </Section>
          )}
          {b.cleanup.length > 0 && (
            <Section title="Clean up" count={b.cleanup.length + b.cleanupMore}>
              <ul className="space-y-3">
                {b.cleanup.map((i) => (
                  <li key={i.key}>
                    <p className="text-sm font-medium text-foreground">{i.action}</p>
                    <p className={quiet}>
                      {i.context}
                      {i.link && <Link href={i.link.href} className={`ml-1.5 whitespace-nowrap ${go}`}>{i.link.label} →</Link>}
                    </p>
                  </li>
                ))}
              </ul>
              {b.cleanupMore > 0 && <p className={`mt-3 ${quiet}`}>+{b.cleanupMore} more on your task list and in your inbox</p>}
            </Section>
          )}
        </div>
      </div>

      {b.doneSinceYesterday ? <p className="text-sm font-medium text-foreground">{b.doneSinceYesterday} done since yesterday.</p> : null}
    </div>
  );
}
