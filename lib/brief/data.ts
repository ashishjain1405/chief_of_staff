import type { SupabaseClient } from "@supabase/supabase-js";
import { spendAmount } from "@/lib/finance/spend";
import { merchantLabel } from "@/components/finance/labels";

// Everything the morning brief draws on, loaded with ids so each line can link
// to its email or task and be recognised in tomorrow's brief.

export const IST = "Asia/Kolkata";
export const istDate = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: IST });

export type BriefTask = {
  id: string; title: string; description: string | null; due_date: string | null;
  priority: string | null; source_type: string | null; source_id: string | null; created_at: string;
};
export type BriefEmail = { id: string; subject: string | null; body_summary: string | null; occurred_at: string; from: string | null };
export type BriefMeeting = { title: string; start_time: string };
export type BriefFollowUp = { name: string; due: string };
export type BriefSpend = {
  month: string; spent: number; prevMonth: string; prevTotal: number;
  yesterday: { total: number; merchants: { name: string; amount: number; count: number; refunded: number }[] };
};

type Contact = { name: string | null; email: string | null };
type Joined = Contact | Contact[] | null;
type SpendRow = { amount: number | null; transaction_type: string | null; merchant_normalized: string | null; status: string | null; category: string | null; transaction_datetime: string };
type EmailRow = { id: string; subject: string | null; body_summary: string | null; occurred_at: string; contacts: Joined };
type FollowUpRow = { follow_up_due: string; contacts: Joined };

export type BriefData = {
  now: string;
  businessContext: unknown;
  tasks: BriefTask[];
  emails: BriefEmail[];
  meetings: BriefMeeting[];
  followUps: BriefFollowUp[];
  spend: BriefSpend | null;
  // Keys of the lines in yesterday's brief, and how many of them are now done.
  previousKeys: string[] | null;
  doneSinceYesterday: number | null;
};

// Calendar months in IST, as on the Finance page: this month so far, and last
// month in full. Not last month "by this date": a ₹72,845 refund on 1 September
// made September-to-the-22nd ₹13,903 and October "534% more" - one credit
// swings a partial month.
function monthWindows(now: Date) {
  const [y, m] = istDate(now).split("-").map(Number);
  const start = (yy: number, mm: number) => new Date(`${yy}-${String(mm).padStart(2, "0")}-01T00:00:00+05:30`);
  const month = start(y, m);
  const prev = m === 1 ? start(y - 1, 12) : start(y, m - 1);
  return { month, prev };
}

const monthName = (d: Date) => d.toLocaleDateString("en-IN", { month: "long", timeZone: IST });

async function loadSpend(db: SupabaseClient, userId: string, now: Date): Promise<BriefSpend> {
  const { month, prev } = monthWindows(now);
  const rows: SpendRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions_normalized")
      .select("amount, transaction_type, merchant_normalized, status, category, transaction_datetime")
      .eq("user_id", userId).gte("transaction_datetime", prev.toISOString()).lte("transaction_datetime", now.toISOString())
      .order("transaction_datetime").range(from, from + 999);
    if (error) throw new Error(`[brief] spend: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  // Yesterday is the IST calendar day before the brief, merchant by merchant,
  // under the Finance page's names and spend rules: refunds net off, transfers
  // and card bill payments are left out.
  const today = Date.parse(`${istDate(now)}T00:00:00+05:30`);
  const byMerchant = new Map<string, { name: string; amount: number; count: number; refunded: number }>();
  let spent = 0, prevTotal = 0, yesterdayTotal = 0;
  for (const r of rows) {
    const at = Date.parse(r.transaction_datetime), amount = spendAmount(r);
    if (at >= month.getTime()) spent += amount;
    else prevTotal += amount;
    if (at < today - 864e5 || at >= today || !amount) continue;
    yesterdayTotal += amount;
    // A UPI payee arrives as a masked handle, "******2985@ybl".
    const raw = merchantLabel(r.merchant_normalized);
    const name = raw.includes("@") ? `UPI ${raw.replace(/^\*+/, "…")}` : raw;
    const m = byMerchant.get(name) ?? { name, amount: 0, count: 0, refunded: 0 };
    m.amount += amount; m.count++;
    if (amount < 0) m.refunded -= amount;
    byMerchant.set(name, m);
  }
  const merchants = [...byMerchant.values()].filter((m) => Math.round(m.amount) !== 0).sort((a, b) => b.amount - a.amount);
  return { month: monthName(month), spent, prevMonth: monthName(prev), prevTotal, yesterday: { total: yesterdayTotal, merchants } };
}

async function loadPrevious(db: SupabaseClient, userId: string, now: Date) {
  const yesterday = istDate(new Date(now.getTime() - 864e5));
  const { data } = await db.from("daily_briefs").select("content").eq("user_id", userId).eq("brief_date", yesterday).maybeSingle();
  const content = data?.content as { version?: number; keys?: string[] } | null;
  const keys = content?.version === 2 ? content.keys : undefined;
  if (!keys) return { previousKeys: null, doneSinceYesterday: null };

  const ids = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  const [tasks, emails] = await Promise.all([
    ids("task:").length ? db.from("tasks").select("id").in("id", ids("task:")).in("status", ["done", "dismissed"]) : { data: [] },
    ids("email:").length ? db.from("communications").select("id").in("id", ids("email:")).or("action_taken.eq.true,requires_action.eq.false") : { data: [] },
  ]);
  return { previousKeys: keys, doneSinceYesterday: (tasks.data?.length ?? 0) + (emails.data?.length ?? 0) };
}

export async function gatherBriefData(db: SupabaseClient, userId: string, businessContext: unknown, now = new Date()): Promise<BriefData> {
  const in24h = new Date(now.getTime() + 864e5).toISOString();
  const [tasks, emails, meetings, followUps, spend, previous] = await Promise.all([
    db.from("tasks").select("id, title, description, due_date, priority, source_type, source_id, created_at")
      .eq("user_id", userId).eq("status", "pending").limit(300),
    db.from("communications").select("id, subject, body_summary, occurred_at, contacts(name, email)")
      .eq("user_id", userId).eq("requires_action", true).eq("action_taken", false)
      .order("importance_score", { ascending: false }).limit(8),
    db.from("meetings").select("title, start_time")
      .eq("user_id", userId).gte("start_time", now.toISOString()).lte("start_time", in24h).order("start_time").limit(6),
    db.from("relationships").select("follow_up_due, contacts(name, email)")
      .eq("user_id", userId).lte("follow_up_due", now.toISOString()).order("follow_up_due").limit(3),
    loadSpend(db, userId, now).catch((err) => { console.error(err.message); return null; }),
    loadPrevious(db, userId, now),
  ]);
  for (const r of [tasks, emails, meetings]) if (r.error) throw new Error(`[brief] ${r.error.message}`);

  const person = (c: Joined) => (Array.isArray(c) ? c[0] ?? null : c);
  // Contacts saved as "piyush tyagi" are shown as "Piyush Tyagi".
  const proper = (name: string | null | undefined) => (name && name === name.toLowerCase() ? name.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : name) || null;
  return {
    now: now.toISOString(),
    businessContext,
    tasks: (tasks.data ?? []) as BriefTask[],
    emails: ((emails.data ?? []) as EmailRow[]).map((e) => ({
      id: e.id, subject: e.subject, body_summary: e.body_summary, occurred_at: e.occurred_at,
      from: proper(person(e.contacts)?.name) || person(e.contacts)?.email || null,
    })),
    meetings: (meetings.data ?? []) as BriefMeeting[],
    followUps: ((followUps.data ?? []) as FollowUpRow[]).flatMap((f) => {
      const p = person(f.contacts);
      return p?.name || p?.email ? [{ name: (proper(p.name) || p.email)!, due: f.follow_up_due }] : [];
    }),
    spend,
    ...previous,
  };
}
