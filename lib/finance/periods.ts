// The Finance page's periods and filters, in IST. A plain module: the page
// (server) works out the ranges and the filter bar (client) lists the choices
// and builds the links, so both read the address the same way.

export const IST = "Asia/Kolkata";
export const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const DAY = 864e5;
const midnight = (ymd: string) => Date.parse(`${ymd}T00:00:00+05:30`);

// The moment a request is served: one value for every period on the page.
export const requestTime = () => Date.now();

export const ROLLING = [7, 30, 60, 90] as const;
// What the page loads; "Last 6 months" is all of it.
export const HISTORY_DAYS = 180;

export type Period = {
  key: string; // "30d", "6m", "2026-10"
  label: string; // "Last 30 days", "This month", "August 2026"
  start: number;
  end: number; // exclusive; now, for a period still running
  days: number; // days covered so far, for the daily average
  month: string | null; // the calendar month, if it is one
  prev: { start: number; end: number; label: string } | null;
};

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const monthName = (ym: string, style: "long" | "short" = "long", year = false) =>
  new Date(`${ym}-01T12:00:00+05:30`).toLocaleDateString("en-IN", { month: style, ...(year ? { year: "numeric" } : {}), timeZone: IST });

// Anything not recognised falls back to this month, the page's default.
export function resolvePeriod(key: string | undefined, now = Date.now()): Period {
  const today = istDay(new Date(now));
  const thisMonth = today.slice(0, 7);
  const n = Number(/^(\d+)d$/.exec(key ?? "")?.[1]);
  if ((ROLLING as readonly number[]).includes(n)) {
    const start = midnight(today) - (n - 1) * DAY;
    return { key: `${n}d`, label: `Last ${n} days`, start, end: now, days: n, month: null, prev: { start: start - n * DAY, end: start, label: `the previous ${n} days` } };
  }
  if (key === "6m") {
    return { key, label: "Last 6 months", start: midnight(today) - (HISTORY_DAYS - 1) * DAY, end: now, days: HISTORY_DAYS, month: null, prev: null };
  }

  const ym = key && /^\d{4}-\d{2}$/.test(key) && key <= thisMonth ? key : thisMonth;
  const start = midnight(`${ym}-01`);
  const next = midnight(`${addMonths(ym, 1)}-01`);
  const prevYm = addMonths(ym, -1);
  const prevStart = midnight(`${prevYm}-01`);
  if (ym === thisMonth) {
    // Compared with the same days of last month, not all of it: on the 5th,
    // a whole previous month always looks bigger.
    const day = Number(today.slice(8));
    const prevDays = Math.round((start - prevStart) / DAY);
    return {
      key: ym, label: "This month", start, end: now, days: day, month: ym,
      prev: { start: prevStart, end: Math.min(prevStart + (now - start), start), label: `1–${Math.min(day, prevDays)} ${monthName(prevYm, "short")}` },
    };
  }
  return {
    key: ym, label: ym === addMonths(thisMonth, -1) ? "Last month" : monthName(ym, "long", true), start, end: next,
    days: Math.round((next - start) / DAY), month: ym, prev: { start: prevStart, end: start, label: monthName(prevYm) },
  };
}

// The choices for the filter bar. Months run from the first one with any mail
// to this month; one that starts before the mail does says so.
export function periodOptions(coverageStart: string | null, now = Date.now()) {
  const thisMonth = istDay(new Date(now)).slice(0, 7);
  const firstDay = coverageStart ? istDay(new Date(coverageStart)) : null;
  const oldest = addMonths(thisMonth, -5);
  const first = firstDay && firstDay.slice(0, 7) > oldest ? firstDay.slice(0, 7) : oldest;
  const months: { key: string; label: string }[] = [];
  for (let ym = thisMonth; ym >= first; ym = addMonths(ym, -1)) {
    const name = ym === thisMonth ? `This month (${monthName(ym)})` : ym === addMonths(thisMonth, -1) ? `Last month (${monthName(ym)})` : monthName(ym, "long", true);
    const partial = firstDay && firstDay.slice(0, 7) === ym && !firstDay.endsWith("-01");
    months.push({ key: ym, label: partial ? `${name} (from ${Number(firstDay.slice(8))} ${monthName(ym, "short")})` : name });
  }
  return {
    rolling: [...ROLLING.map((d) => ({ key: `${d}d`, label: `Last ${d} days` })), { key: "6m", label: "Last 6 months" }],
    months,
  };
}

// The first month the mail covers from its 1st: the trend leaves out a month
// it only has the end of (28-31 July drew a misleading bar).
export function firstFullMonth(coverageStart: string | null): string | null {
  if (!coverageStart) return null;
  const day = istDay(new Date(coverageStart));
  return day.endsWith("-01") ? day.slice(0, 7) : addMonths(day.slice(0, 7), 1);
}

// ── The address: ?period=30d&cat=food_delivery,groceries&show=all
export type Filters = { period?: string; cats: string[]; show: "spend" | "all" };

export function parseFilters(params: { period?: string; cat?: string; show?: string }): Filters {
  const cats = (params.cat ?? "").split(",").map((c) => c.trim()).filter((c) => /^[a-z0-9_]{1,60}$/.test(c));
  return { period: params.period || undefined, cats: [...new Set(cats)], show: params.show === "all" ? "all" : "spend" };
}

export function filtersHref(f: Filters): string {
  const q = new URLSearchParams();
  if (f.period) q.set("period", f.period);
  if (f.cats.length) q.set("cat", f.cats.join(","));
  if (f.show === "all") q.set("show", "all");
  const s = q.toString();
  return s ? `/finance?${s}` : "/finance";
}

// A bar adds its category to the filter, or takes it out again.
export const toggleCategory = (cats: string[], c: string) => (cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]);
