import type { ReactNode } from "react";

// Sample content laid out like the real 8 am email (lib/brief/render).
const YESTERDAY: [string, number][] = [["Swiggy Instamart", 684], ["Uber ×2", 412], ["Netflix", 199]];

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 text-sm text-foreground">{children}</div>
    </div>
  );
}

export function BriefPreview() {
  return (
    <figure aria-label="Example morning brief email" className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Your morning brief</span>
        <span>8:00 am</span>
      </div>
      <div className="space-y-5 p-5">
        <Part title="Today's top 3">
          <ol className="space-y-1.5">
            <li>1. Pay the electricity bill <span className="text-muted-foreground">· due today</span></li>
            <li>2. Reply to Priya about the lease</li>
            <li>3. Renew car insurance <span className="text-muted-foreground">· due Friday</span></li>
          </ol>
        </Part>
        <Part title="Schedule">
          <p>10:30 Team sync <span className="text-muted-foreground">· 16:00 Dentist</span></p>
        </Part>
        <Part title="Money">
          <p className="text-xl font-semibold tabular-nums">₹27,599</p>
          <p className="text-xs text-muted-foreground">Spent this month so far</p>
          <p className="mt-3 font-medium">Yesterday <span className="font-normal text-muted-foreground">· ₹{YESTERDAY.reduce((s, [, v]) => s + v, 0).toLocaleString("en-IN")}</span></p>
          <ul className="mt-1.5 divide-y divide-border/60">
            {YESTERDAY.map(([name, amount]) => (
              <li key={name} className="flex justify-between py-1.5">
                <span>{name}</span>
                <span className="font-medium tabular-nums">₹{amount.toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
        </Part>
        <Part title="Follow-ups">
          <p>Rahul is waiting on your reply <span className="text-muted-foreground">· 5 days</span></p>
        </Part>
      </div>
    </figure>
  );
}
