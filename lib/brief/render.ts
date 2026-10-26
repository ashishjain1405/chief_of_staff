import type { Brief, BriefItem, Chip, Tone } from "./build";

// One brief, four renderings: the HTML email, its plain-text part, the markdown
// kept for briefs saved before sections, and the dashboard's sections
// (components/dashboard/brief-sections), which share the wording helpers
// exported here. Email HTML is tables and inline styles - Gmail drops most
// <style> rules - in the dashboard's soft palette, and every chip carries a
// word, never colour alone.

type Url = (path: string) => string;

const C = { ink: "#0f172a", body: "#334155", muted: "#64748b", line: "#e2e8f0", page: "#f4f6f8", card: "#ffffff", accent: "#0369a1", accentBg: "#f0f9ff" };
const TONES: Record<Tone, [string, string]> = {
  overdue: ["#fff1f2", "#be123c"], today: ["#fffbeb", "#92400e"], soon: ["#f0f9ff", "#0369a1"],
  waiting: ["#fff7ed", "#9a3412"], new: ["#ecfdf5", "#047857"], neutral: ["#f1f5f9", "#475569"],
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// A refund larger than the day's spend reads "−₹360", not "₹-360".
export const inr = (n: number) => `${Math.round(n) < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
const shortDay = (b: Brief) => new Date(`${b.date}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", "");

export function briefSubject(b: Brief): string {
  return `Brief · ${shortDay(b)} · ${b.summary.replace(/ · /g, ", ")}`;
}

export const MERCHANTS = 6;
export const times = (n: number) => (n > 1 ? ` ×${n}` : "");
// Net of refunds, which is why "Amazon ×5 ₹285" needs its refund beside it.
export const refundNote = (x: { refunded: number }) => (x.refunded ? `after a ${inr(x.refunded)} refund` : "");
export const moreMerchants = (n: number) => `+${n} more ${n === 1 ? "merchant" : "merchants"}`;
export const comparison = (m: NonNullable<Brief["money"]>) => (m.prevTotal ? `${m.prevMonth} in full: ${inr(m.prevTotal)}` : "");

// ── HTML ────────────────────────────────────

const chip = (c: Chip) => {
  const [bg, fg] = TONES[c.tone];
  return `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:16px;white-space:nowrap">${esc(c.label)}</span>`;
};
const link = (i: BriefItem, url: Url) => i.link ? `<a target="_blank" rel="noopener" href="${esc(url(i.link.href))}" style="color:${C.accent};font-size:13px;font-weight:600;text-decoration:none">${esc(i.link.label)} &rarr;</a>` : "";

function heading(title: string, count?: number) {
  const n = count ? ` <span style="color:${C.muted};font-weight:500">(${count})</span>` : "";
  return `<tr><td style="padding:28px 28px 10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${esc(title)}${n}</td></tr>`;
}

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
// The first step for the start item, unless it only repeats the context.
export const firstStep = (b: Brief, i: BriefItem) => (b.start && b.start.key === i.key && b.start.step && !same(b.start.step, i.context) ? b.start.step : "");

function row(i: BriefItem, url: Url, opts: { number?: number; muted?: boolean; step?: string } = {}) {
  const num = opts.number
    ? `<td width="34" valign="top" style="padding-top:1px"><span style="display:inline-block;width:24px;height:24px;border-radius:999px;background:${C.accentBg};color:${C.accent};font-size:12px;font-weight:700;line-height:24px;text-align:center">${opts.number}</span></td>`
    : "";
  const context = i.context ? `<div style="margin-top:3px;font-size:13px;line-height:19px;color:${C.body}">${esc(i.context)}</div>` : "";
  const step = opts.step ? `<div style="margin-top:6px;font-size:13px;line-height:19px;color:${C.accent}"><strong>First step:</strong> ${esc(opts.step)}</div>` : "";
  const chips = i.chips.length ? `<div style="margin-top:6px">${i.chips.map(chip).join("")}</div>` : "";
  const go = i.link ? `<div style="margin-top:${i.chips.length ? 2 : 6}px">${link(i, url)}</div>` : "";
  return `<tr><td style="padding:0 28px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${num}<td valign="top">
    <div style="font-size:15px;line-height:21px;font-weight:600;color:${opts.muted ? C.body : C.ink}">${esc(i.action)}</div>${context}${step}${chips}${go}
  </td></tr></table></td></tr>`;
}

// One line each, the link inline: alerts and clean-up items are glanced at, not worked through.
function compact(i: BriefItem, url: Url) {
  const go = i.link ? ` <a target="_blank" rel="noopener" href="${esc(url(i.link.href))}" style="color:${C.accent};font-weight:600;text-decoration:none;white-space:nowrap">${esc(i.link.label)} &rarr;</a>` : "";
  return `<tr><td style="padding:0 28px 12px;font-size:13px;line-height:19px;color:${C.body}">
    <div style="font-size:14px;line-height:20px;font-weight:600;color:${C.body}">${esc(i.action)}</div>${i.context ? esc(i.context) : ""}${go}</td></tr>`;
}

const note = (text: string) => `<tr><td style="padding:0 28px 14px;font-size:13px;line-height:19px;color:${C.muted}">${esc(text)}</td></tr>`;
const divider = `<tr><td style="padding:14px 28px 0"><div style="border-top:1px solid ${C.line};font-size:0;line-height:0">&nbsp;</div></td></tr>`;

export function renderHtml(b: Brief, url: Url): string {
  const parts: string[] = [];
  parts.push(`<tr><td style="padding:28px 28px 0">
    <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">Daily brief</div>
    <div style="margin-top:6px;font-size:24px;line-height:30px;font-weight:700;color:${C.ink}">${esc(b.dateLabel)}</div>
    <div style="margin-top:4px;font-size:14px;line-height:20px;color:${C.muted}">${esc(b.summary)}</div></td></tr>`);

  if (b.start && b.top[0]?.key !== b.start.key) {
    const go = b.start.link ? `<div style="margin-top:8px"><a target="_blank" rel="noopener" href="${esc(url(b.start.link.href))}" style="color:${C.accent};font-size:13px;font-weight:600;text-decoration:none">${esc(b.start.link.label)} &rarr;</a></div>` : "";
    parts.push(`<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="background:${C.accentBg};border-left:3px solid ${C.accent};border-radius:10px;padding:14px 16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.accent}">Start here</div>
      <div style="margin-top:4px;font-size:15px;line-height:21px;font-weight:600;color:${C.ink}">${esc(b.start.action)}</div>
      ${b.start.step ? `<div style="margin-top:3px;font-size:13px;line-height:19px;color:${C.body}">${esc(b.start.step)}</div>` : ""}${go}
    </td></tr></table></td></tr>`);
  }

  parts.push(heading("Today's top 3"));
  parts.push(b.top.length ? b.top.map((i, n) => row(i, url, { number: n + 1, step: firstStep(b, i) })).join("") : note("Nothing pressing today."));
  if (b.alsoDue.length) {
    parts.push(heading("Also due this week", b.alsoDue.length));
    parts.push(b.alsoDue.map((i) => row(i, url, { muted: true })).join(""));
  }

  parts.push(divider, heading("Schedule"));
  parts.push(b.schedule.length
    ? b.schedule.map((s) => `<tr><td style="padding:0 28px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" style="width:1%;padding-right:14px;font-size:13px;line-height:20px;font-weight:600;color:${C.ink};white-space:nowrap">${esc(s.time)}</td>
        <td valign="top" style="font-size:14px;line-height:20px;color:${C.body}">${esc(s.title)}</td></tr></table></td></tr>`).join("")
    : note("No meetings in the next 24 hours."));

  if (b.waiting.length) {
    parts.push(heading("Waiting on you", b.waiting.length + b.waitingMore));
    parts.push(b.waiting.map((i) => row(i, url)).join(""));
    if (b.waitingMore) parts.push(note(`+${b.waitingMore} more in your inbox`));
  }

  if (b.money) {
    const m = b.money;
    parts.push(divider, heading("Money"));
    parts.push(`<tr><td style="padding:0 28px 14px">
      <div style="font-size:22px;line-height:28px;font-weight:700;color:${C.ink}">${inr(m.spent)}</div>
      <div style="font-size:13px;line-height:19px;color:${C.muted}">Spent in ${esc(m.month)} so far${comparison(m) ? ` · ${esc(comparison(m))}` : ""}</div></td></tr>`);
    const y = m.yesterday;
    const rows = y.merchants.slice(0, MERCHANTS).map((x) => `<tr>
        <td style="padding:5px 0;border-top:1px solid ${C.line};font-size:14px;line-height:20px;color:${C.body}">${esc(x.name)}<span style="color:${C.muted}">${times(x.count)}${refundNote(x) ? ` · ${refundNote(x)}` : ""}</span></td>
        <td align="right" style="padding:5px 0;border-top:1px solid ${C.line};font-size:14px;line-height:20px;font-weight:600;color:${C.ink};white-space:nowrap">${inr(x.amount)}</td></tr>`).join("");
    const more = y.merchants.length > MERCHANTS ? `<div style="margin-top:6px;font-size:13px;color:${C.muted}">${moreMerchants(y.merchants.length - MERCHANTS)}</div>` : "";
    parts.push(`<tr><td style="padding:4px 28px 14px">
      <div style="font-size:14px;line-height:20px;font-weight:600;color:${C.ink}">Yesterday <span style="color:${C.muted};font-weight:500">· ${inr(y.total)}</span></div>
      ${y.merchants.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse">${rows}</table>${more}`
        : `<div style="margin-top:3px;font-size:13px;color:${C.muted}">Nothing spent yesterday.</div>`}
      <div style="margin-top:10px"><a target="_blank" rel="noopener" href="${esc(url("/finance"))}" style="color:${C.accent};font-size:13px;font-weight:600;text-decoration:none">Open finance &rarr;</a></div></td></tr>`);
  }

  if (b.followUps.length) {
    parts.push(heading("Follow-ups", b.followUps.length));
    parts.push(b.followUps.map((i) => row(i, url)).join(""));
  }

  if (b.cleanup.length) {
    parts.push(divider, heading("Clean up", b.cleanup.length + b.cleanupMore));
    parts.push(b.cleanup.map((i) => compact(i, url)).join(""));
    if (b.cleanupMore) parts.push(note(`+${b.cleanupMore} more on your task list and in your inbox`));
  }

  const done = b.doneSinceYesterday ? `${b.doneSinceYesterday} done since yesterday · ` : "";
  parts.push(`<tr><td style="padding:22px 28px 28px;font-size:12px;line-height:18px;color:${C.muted};border-top:1px solid ${C.line}">
    ${esc(done)}<a target="_blank" rel="noopener" href="${esc(url("/dashboard"))}" style="color:${C.accent};text-decoration:none;font-weight:600">Open your dashboard</a><br>Your chief of staff, every morning at 8:00 IST.</td></tr>`);

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(briefSubject(b))}</title></head>
<body style="margin:0;padding:0;background:${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};font-family:${FONT}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.card};border:1px solid ${C.line};border-radius:16px;border-collapse:separate">
${parts.join("\n")}
</table></td></tr></table></body></html>`;
}

// ── Plain text and markdown ─────────────────

const chipText = (i: BriefItem) => (i.chips.length ? ` [${i.chips.map((c) => c.label).join(", ")}]` : "");

export function renderText(b: Brief, url: Url): string {
  const out: string[] = [`DAILY BRIEF · ${b.dateLabel}`, b.summary, ""];
  const section = (title: string, items: BriefItem[], numbered = false) => {
    if (!items.length) return;
    out.push(title.toUpperCase());
    items.forEach((i, n) => {
      out.push(`${numbered ? `${n + 1}.` : "-"} ${i.action}${chipText(i)}`);
      if (i.context) out.push(`   ${i.context}`);
      if (firstStep(b, i)) out.push(`   First step: ${firstStep(b, i)}`);
      if (i.link) out.push(`   ${i.link.label}: ${url(i.link.href)}`);
    });
    out.push("");
  };
  if (b.start && b.top[0]?.key !== b.start.key) out.push("START HERE", b.start.action, ...(b.start.step ? [b.start.step] : []), "");
  if (b.top.length) section("Today's top 3", b.top, true);
  else out.push("TODAY'S TOP 3", "Nothing pressing today.", "");
  section("Also due this week", b.alsoDue);
  out.push("SCHEDULE", ...(b.schedule.length ? b.schedule.map((s) => `${s.time}  ${s.title}`) : ["No meetings in the next 24 hours."]), "");
  section("Waiting on you", b.waiting);
  if (b.money) {
    out.push("MONEY", `${inr(b.money.spent)} spent in ${b.money.month} so far${comparison(b.money) ? ` · ${comparison(b.money)}` : ""}`);
    const y = b.money.yesterday;
    out.push(`Yesterday: ${inr(y.total)}`);
    if (!y.merchants.length) out.push("Nothing spent yesterday.");
    y.merchants.slice(0, MERCHANTS).forEach((x) => out.push(`- ${x.name}${times(x.count)}  ${inr(x.amount)}${refundNote(x) ? ` (${refundNote(x)})` : ""}`));
    if (y.merchants.length > MERCHANTS) out.push(moreMerchants(y.merchants.length - MERCHANTS));
    out.push("");
  }
  section("Follow-ups", b.followUps);
  section("Clean up", b.cleanup);
  if (b.cleanupMore) out.push(`+${b.cleanupMore} more on your task list and in your inbox`, "");
  if (b.doneSinceYesterday) out.push(`${b.doneSinceYesterday} done since yesterday.`);
  out.push(`Open your dashboard: ${url("/dashboard")}`);
  return out.join("\n");
}

// Read by the dashboard's Brief card: headings, numbered items with detail
// lines, bullets and **bold**.
export function renderMarkdown(b: Brief): string {
  const out: string[] = [`**${b.summary}**`, ""];
  const items = (title: string, list: BriefItem[], numbered = false) => {
    if (!list.length) return;
    out.push(`## ${title}`);
    list.forEach((i, n) => {
      out.push(`${numbered ? `${n + 1}.` : "-"} **${i.action}**${i.chips.length ? ` · ${i.chips.map((c) => c.label).join(" · ")}` : ""}`);
      if (i.context) out.push(i.context);
      if (firstStep(b, i)) out.push(`First step: ${firstStep(b, i)}`);
    });
    out.push("");
  };
  if (b.start && b.top[0]?.key !== b.start.key) out.push(`**Start here:** ${b.start.action}${b.start.step ? ` - ${b.start.step}` : ""}`, "");
  items("Today's top 3", b.top, true);
  items("Also due this week", b.alsoDue);
  out.push("## Schedule", ...(b.schedule.length ? b.schedule.map((s) => `- ${s.time} · ${s.title}`) : ["No meetings in the next 24 hours."]), "");
  items("Waiting on you", b.waiting);
  if (b.money) {
    out.push("## Money", `- **${inr(b.money.spent)}** spent in ${b.money.month} so far${comparison(b.money) ? ` · ${comparison(b.money)}` : ""}`);
    const y = b.money.yesterday;
    out.push(`- **Yesterday ${inr(y.total)}**${y.merchants.length ? `: ${y.merchants.slice(0, MERCHANTS).map((x) => `${x.name}${times(x.count)} ${inr(x.amount)}${refundNote(x) ? ` (${refundNote(x)})` : ""}`).join(", ")}${y.merchants.length > MERCHANTS ? `, ${moreMerchants(y.merchants.length - MERCHANTS)}` : ""}` : " - nothing spent"}`);
    out.push("");
  }
  items("Follow-ups", b.followUps);
  items("Clean up", b.cleanup);
  if (b.doneSinceYesterday) out.push(`**${b.doneSinceYesterday} done since yesterday.**`);
  return out.join("\n").trim();
}
