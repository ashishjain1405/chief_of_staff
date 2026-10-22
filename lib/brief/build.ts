import { generateDailyBrief } from "@/lib/ai/claude";
import { dailyBriefPrompt, type DailyBriefJudgement } from "@/lib/ai/prompts";
import { IST, istDate, type BriefData, type BriefEmail, type BriefSpend, type BriefTask } from "./data";

export type Tone = "overdue" | "today" | "soon" | "waiting" | "new" | "neutral";
export type Chip = { label: string; tone: Tone };
export type Link = { label: string; href: string };
export type BriefItem = { key: string; action: string; context?: string; chips: Chip[]; link?: Link };
export type Brief = {
  version: 2;
  date: string;
  dateLabel: string;
  summary: string;
  start: { key: string; action: string; step: string; link?: Link } | null;
  top: BriefItem[];
  alsoDue: BriefItem[];
  schedule: { time: string; title: string }[];
  waiting: BriefItem[];
  waitingMore: number;
  money: BriefSpend | null;
  followUps: BriefItem[];
  cleanup: BriefItem[];
  cleanupMore: number;
  doneSinceYesterday: number | null;
  keys: string[];
};

type Candidate = {
  ref: string; key: string; kind: "task" | "email"; title: string;
  from?: string; summary?: string; due?: string; days_until_due?: number; waiting_days?: number; priority?: string;
  emailId?: string;
};

// A task tied to a date that has passed can no longer be done - the gift card
// lapsed, the webinar ended - yet the brief made "redeem the gift card
// immediately" a top priority ten days after it expired. Those, and anything
// long overdue, go to Clean up: still shown, never ranked.
const LAPSED = /\b(redeem|attend|join|register|vote|webinar|claim|expir\w*)\b/i;
// Replies sent from Gmail are not ingested, so an email stays "waiting" after
// it was answered: the Investment Memo led the brief at 44 days.
const STALE_DAYS = 14;
const UNDATED = 3;
const EMAILS = 6;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
const shortDate = (ymd: string) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
const weekdayDate = (ymd: string) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST }).replace(",", "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tidy = (s: string | undefined | null, max = 160) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const title = (s: string | undefined | null) => tidy(s).replace(/\.$/, "");

function dueChip(d: number, due: string): Chip {
  if (d < 0) return { label: `Overdue ${plural(-d, "day")}`, tone: "overdue" };
  if (d === 0) return { label: "Due today", tone: "today" };
  if (d === 1) return { label: "Due tomorrow", tone: "soon" };
  return { label: `Due ${weekdayDate(due)}`, tone: "soon" };
}

function waitingChip(n: number): Chip {
  return n <= 0 ? { label: "Arrived today", tone: "neutral" } : { label: `Waiting ${plural(n, "day")}`, tone: n >= 3 ? "waiting" : "neutral" };
}

export function prepare(data: BriefData) {
  const today = istDate(data.now);
  const cleanup: { key: string; action: string; note: string; href: string; rank: number }[] = [];
  const dated: { task: BriefTask; d: number; due: string }[] = [];
  const undated: BriefTask[] = [];
  for (const task of data.tasks) {
    const due = task.due_date ? istDate(task.due_date) : null;
    const d = due ? days(today, due) : null;
    const stale = { key: `task:${task.id}`, action: title(task.title), href: "/tasks" };
    if (due && d! < 0 && LAPSED.test(task.title)) cleanup.push({ ...stale, note: `Its date passed on ${shortDate(due)}. Close it?`, rank: 0 });
    else if (due && d! < -STALE_DAYS) cleanup.push({ ...stale, note: `${-d!} days overdue. Still needed?`, rank: 2 });
    else if (due && d! <= 7) dated.push({ task, d: d!, due });
    else if (!due) undated.push(task);
  }
  dated.sort((a, b) => a.d - b.d);
  undated.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const waitingDays = (e: BriefEmail) => days(istDate(e.occurred_at), today);
  const fresh = data.emails.filter((e) => {
    if (waitingDays(e) <= STALE_DAYS) return true;
    cleanup.push({ key: `email:${e.id}`, action: [title(e.subject) || "(no subject)", e.from].filter(Boolean).join(" · "), note: `Waiting ${waitingDays(e)} days. Still need a reply?`, href: `/inbox/${e.id}`, rank: 1 });
    return false;
  });
  cleanup.sort((a, b) => a.rank - b.rank);

  // An email and the task raised from it are one item, whatever the task's due
  // date: the Paytm income update was listed as an email and again as a task.
  const emailById = new Map(fresh.map((e) => [e.id, e]));
  const merged = new Set<string>();
  const taskCandidate = (task: BriefTask, i: number, d?: number, due?: string): Candidate => {
    const email = task.source_id ? emailById.get(task.source_id) : undefined;
    if (email) merged.add(email.id);
    return {
      ref: `T${i + 1}`, key: `task:${task.id}`, kind: "task", title: title(task.title),
      summary: tidy(task.description ?? email?.body_summary, 300) || undefined, from: email?.from ?? undefined,
      due, days_until_due: d, waiting_days: email ? waitingDays(email) : undefined, priority: task.priority ?? undefined, emailId: email?.id,
    };
  };
  const linked = (t: BriefTask) => !!t.source_id && emailById.has(t.source_id);
  const picked = [
    ...dated.filter((x) => x.d <= 3 || linked(x.task)).map((x) => [x.task, x.d, x.due] as const),
    ...undated.filter((t, i) => i < UNDATED || linked(t)).map((t) => [t, undefined, undefined] as const),
  ];
  const tasks = picked.map(([t, d, due], i) => taskCandidate(t, i, d, due));
  // Emails whose task is already on the list, or was cleaned up, are not repeated.
  const withTask = new Set(data.tasks.flatMap((t) => (t.source_id ? [t.source_id] : [])));
  const emails = fresh.filter((e) => !merged.has(e.id) && !withTask.has(e.id)).slice(0, EMAILS).map((e, i): Candidate => ({
    ref: `E${i + 1}`, key: `email:${e.id}`, kind: "email", title: title(e.subject) || "(no subject)",
    from: e.from ?? undefined, summary: tidy(e.body_summary, 300) || undefined, waiting_days: waitingDays(e), emailId: e.id,
  }));
  const pickedIds = new Set(picked.map(([t]) => t.id));
  const later = dated.filter((x) => x.d > 3 && !pickedIds.has(x.task.id));
  return { today, candidates: [...tasks, ...emails], later, cleanup };
}

// Without a usable reply the brief still goes out: soonest deadline first,
// then the emails, in their own words.
function fallback(candidates: Candidate[]): DailyBriefJudgement {
  const order = [...candidates].sort((a, b) => (a.days_until_due ?? 99) - (b.days_until_due ?? 99));
  const top = order.slice(0, 3).map((c) => c.ref);
  return { items: candidates.map((c) => ({ ref: c.ref, action: c.title, context: c.summary ?? "" })), top, start: { ref: top[0] ?? "", step: "" } };
}

export function assemble(data: BriefData, prep: ReturnType<typeof prepare>, judgement: DailyBriefJudgement | null): Brief {
  const { today, candidates, later, cleanup } = prep;
  const j = judgement ?? fallback(candidates);
  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const lines = new Map(j.items.filter((i) => byRef.has(i.ref)).map((i) => [i.ref, i]));
  const topRefs = [...new Set(j.top)].filter((r) => byRef.has(r)).slice(0, 3);
  const isNew = (key: string) => !!data.previousKeys && !data.previousKeys.includes(key);

  const item = (c: Candidate): BriefItem => {
    const chips: Chip[] = [];
    if (c.days_until_due !== undefined) chips.push(dueChip(c.days_until_due, c.due!));
    else if (c.waiting_days !== undefined) chips.push(waitingChip(c.waiting_days));
    if (isNew(c.key)) chips.push({ label: "New", tone: "new" });
    return {
      key: c.key,
      action: title(lines.get(c.ref)?.action) || c.title,
      context: tidy(lines.get(c.ref)?.context) || undefined,
      chips,
      link: c.emailId ? { label: "Open email", href: `/inbox/${c.emailId}` } : { label: "Open tasks", href: "/tasks" },
    };
  };

  const top = topRefs.map((r) => item(byRef.get(r)!));
  const rest = candidates.filter((c) => !topRefs.includes(c.ref));
  const waitingAll = rest.filter((c) => c.kind === "email").map(item);
  const alsoDue = [
    ...rest.filter((c) => c.kind === "task" && c.days_until_due !== undefined).map(item),
    ...later.map((x) => ({ key: `task:${x.task.id}`, action: title(x.task.title), chips: [dueChip(x.d, x.due)], link: { label: "Open tasks", href: "/tasks" } })),
  ].slice(0, 4);
  const cleanupItems = cleanup.map((c) => ({ key: c.key, action: c.action, context: c.note, chips: [], link: { label: "Review", href: c.href } }));

  const schedule = data.meetings.map((m) => {
    const time = new Date(m.start_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
    return { time: istDate(m.start_time) === today ? time : `Tomorrow ${time}`, title: tidy(m.title) };
  });
  const startRef = byRef.has(j.start.ref) ? j.start.ref : topRefs[0];
  const startItem = startRef ? item(byRef.get(startRef)!) : null;

  const waiting = waitingAll.slice(0, 5);
  const flights = schedule.filter((s) => /^flight\b/i.test(s.title)).length;
  const summary = [
    top.length ? `${top.length} to do` : "",
    schedule.length - flights ? plural(schedule.length - flights, "meeting") : "",
    flights ? plural(flights, "flight") : "",
    waitingAll.length ? `${waitingAll.length} waiting on you` : "",
  ].filter(Boolean).join(" · ") || "A clear day";

  const shownCleanup = cleanupItems.slice(0, 3);
  return {
    version: 2,
    date: today,
    dateLabel: new Date(data.now).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: IST }),
    summary,
    start: startItem ? { key: startItem.key, action: startItem.action, step: title(j.start.step), link: startItem.link } : null,
    top,
    alsoDue,
    schedule,
    waiting,
    waitingMore: waitingAll.length - waiting.length,
    money: data.spend,
    followUps: data.followUps.map((f) => ({ key: `followup:${f.name}`, action: `Follow up with ${f.name}`, chips: [dueChip(days(today, istDate(f.due)), istDate(f.due))], link: { label: "Open relationships", href: "/relationships" } })),
    cleanup: shownCleanup,
    cleanupMore: cleanupItems.length - shownCleanup.length,
    doneSinceYesterday: data.doneSinceYesterday,
    keys: [...top, ...waiting, ...alsoDue, ...shownCleanup].map((i) => i.key),
  };
}

export async function buildBrief(data: BriefData): Promise<Brief> {
  const prep = prepare(data);
  let judgement: DailyBriefJudgement | null = null;
  if (prep.candidates.length) {
    const weekday = new Date(data.now).toLocaleDateString("en-US", { weekday: "long", timeZone: IST });
    // Keys and email ids stay in code; the model sees refs only.
    const items = prep.candidates.map(({ ref, kind, title, from, summary, due, days_until_due, waiting_days, priority }) =>
      ({ ref, kind, title, from, summary, due, days_until_due, waiting_days, priority }));
    judgement = await generateDailyBrief(dailyBriefPrompt({ today: prep.today, weekday, businessContext: data.businessContext, items }))
      .catch((err) => { console.error(`[brief] judgement failed: ${(err as Error).message}`); return null; });
  }
  return assemble(data, prep, judgement);
}
