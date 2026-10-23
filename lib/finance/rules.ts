import { findKnownMerchant, merchantKey } from "@/lib/finance/normalize";

// The founder's categories and counting decisions. Shared by the Finance page
// (client), its server actions and regrouping (lib/finance/dedup), so a choice
// matches the same transactions wherever it is applied. A plain module: a
// "use client" file cannot export to a server one.
//
// Precedence, highest first: the founder's choice on one transaction ("user"),
// a rule for its UPI payee, for its transfer recipient, for its merchant, then
// the automatic category from extraction and the merchant dictionary.

export type MatchType = "merchant" | "upi" | "recipient";
export type Source = "auto" | "rule" | "user";
export type Rule = { id?: string; match_type: MatchType; match_key: string; label: string; category: string | null; counted: boolean | null };
export type Match = { type: MatchType; key: string; label: string };
export type Overrides = { category: string | null; category_source: Source; counted_override: boolean | null; counted_source: "rule" | "user" | null };

// The categories a transaction can be moved to: the ones extraction and the
// merchant dictionary already use. No new categories (founder decision).
export const CATEGORY_OPTIONS = [
  "food_delivery", "restaurants", "groceries", "ecommerce", "shopping", "fashion", "electronics", "furniture",
  "transport", "travel", "fuel", "entertainment", "subscriptions", "gaming", "fitness", "beauty", "eyewear",
  "jewelry", "healthcare", "pharmacy", "education", "utilities", "internet", "telecom", "rent", "home_services",
  "insurance", "investments", "payments", "banking", "tax", "salary", "software", "ai_tools", "productivity",
  "professional_network", "unknown",
] as const;
export const isCategoryOption = (c: string) => (CATEGORY_OPTIONS as readonly string[]).includes(c);

// A UPI handle as one payee. Banks mask the front of a numbered handle, so
// "******4694@ybl" and "9773774694@ybl", or "******2985@ybl" and
// "q208092985@ybl", are matched on the last four digits and provider; a
// handle that does not end in digits ("ashish00jain@okhdfcbank") is matched whole.
export function upiKey(handle: string | null | undefined): string | null {
  const m = /^([^@\s]+)@([a-z0-9.]+)$/i.exec((handle ?? "").trim().toLowerCase());
  if (!m) return null;
  const masked = /^[*x•]+/.test(m[1]);
  const visible = m[1].replace(/^[*x•]+/, "");
  if (visible.length < 3) return null;
  return `${masked || /\d{4}$/.test(visible) ? visible.slice(-4) : visible}@${m[2]}`;
}
const upiLabel = (key: string) => `UPI ${/^\d{4}@/.test(key) ? `…${key}` : key}`;

export function merchantRuleKey(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  return merchantKey(findKnownMerchant(n) ?? n);
}

// What a transaction can be matched on, most specific first. A payee that
// arrives as a bare handle ("q470388412@ybl") is a UPI match, not a merchant;
// a transfer is matched on who it went to (lib/finance/recipient).
export function matchesFor(
  row: { merchant_normalized: string | null; upi_key?: string | null; recipient_key?: string | null; recipient_label?: string | null },
  merchantLabel: (n: string) => string
): Match[] {
  const out: Match[] = [];
  const upi = row.upi_key ?? upiKey(row.merchant_normalized);
  if (upi) out.push({ type: "upi", key: upi, label: upiLabel(upi) });
  if (row.recipient_key) out.push({ type: "recipient", key: row.recipient_key, label: row.recipient_label ?? row.recipient_key });
  const name = row.merchant_normalized;
  if (name && !name.includes("@")) {
    const key = merchantRuleKey(name);
    if (key) out.push({ type: "merchant", key, label: merchantLabel(name) });
  }
  return out;
}

export function ruleFor(rules: Rule[], matches: Match[], field: "category" | "counted"): Rule | null {
  for (const m of matches) {
    const r = rules.find((x) => x.match_type === m.type && x.match_key === m.key && (field === "category" ? x.category !== null : x.counted !== null));
    if (r) return r;
  }
  return null;
}

// The values a transaction should carry: the founder's own choice stays, then
// the matching rule, then the automatic category and the spend rules.
export function resolve(current: Partial<Overrides>, autoCategory: string | null, rules: Rule[], matches: Match[]): Overrides {
  const out: Overrides = { category: autoCategory, category_source: "auto", counted_override: null, counted_source: null };
  if (current.category_source === "user") {
    out.category = current.category ?? null;
    out.category_source = "user";
  } else {
    const r = ruleFor(rules, matches, "category");
    if (r) { out.category = r.category; out.category_source = "rule"; }
  }
  if (current.counted_source === "user") {
    out.counted_override = current.counted_override ?? null;
    out.counted_source = current.counted_override === null || current.counted_override === undefined ? null : "user";
  } else {
    const r = ruleFor(rules, matches, "counted");
    if (r) { out.counted_override = r.counted; out.counted_source = "rule"; }
  }
  return out;
}

// ── Planning a change: pure, so the table can show it at once and the server
// action can save exactly the same thing.

export type RowLike = { id: string; merchant_normalized: string | null; upi_key?: string | null; recipient_key?: string | null; recipient_label?: string | null; category_auto?: string | null } & Partial<Overrides>;
export type Snapshot = { id: string } & Overrides;
export type ChangeInput = { id: string; field: "category" | "counted"; value: string | boolean; scope: "one" | "all"; match?: Match };

export const overridesOf = (r: RowLike): Overrides => ({
  category: r.category ?? null,
  category_source: r.category_source ?? "auto",
  counted_override: r.counted_override ?? null,
  counted_source: r.counted_source ?? null,
});
const sameOverrides = (a: Overrides, b: Overrides) =>
  a.category === b.category && a.category_source === b.category_source && a.counted_override === b.counted_override && a.counted_source === b.counted_source;
// A row written before category_auto existed still has its automatic category in category.
const autoOf = (r: RowLike) => r.category_auto ?? ((r.category_source ?? "auto") === "auto" ? r.category ?? null : null);

// Re-derives rows from the rules, keeping what the founder set by hand except
// on the fields `release` frees.
export function recompute(rows: RowLike[], rules: Rule[], release: (r: RowLike) => { category?: boolean; counted?: boolean }) {
  const before: Snapshot[] = [];
  const after: Snapshot[] = [];
  for (const r of rows) {
    const free = release(r);
    const current = overridesOf(r);
    if (free.category && current.category_source === "user") current.category_source = "auto";
    if (free.counted && current.counted_source === "user") current.counted_source = null;
    const next = resolve(current, autoOf(r), rules, matchesFor(r, (n) => n));
    if (sameOverrides(next, overridesOf(r))) continue;
    before.push({ id: r.id, ...overridesOf(r) });
    after.push({ id: r.id, ...next });
  }
  return { before, after };
}

export function planChange(rows: RowLike[], rules: Rule[], input: ChangeInput): { rule: Rule | null; ruleBefore: Rule | null; before: Snapshot[]; after: Snapshot[] } {
  const target = rows.find((r) => r.id === input.id);
  if (!target) return { rule: null, ruleBefore: null, before: [], after: [] };
  if (input.scope === "one" || !input.match) {
    const next: Overrides = input.field === "category"
      ? { ...overridesOf(target), category: input.value as string, category_source: "user" }
      : { ...overridesOf(target), counted_override: input.value as boolean, counted_source: "user" };
    return sameOverrides(next, overridesOf(target))
      ? { rule: null, ruleBefore: null, before: [], after: [] }
      : { rule: null, ruleBefore: null, before: [{ id: target.id, ...overridesOf(target) }], after: [{ id: target.id, ...next }] };
  }
  // "This and all": a rule for the match, applied to every transaction that
  // shares it except ones set by hand; the clicked one follows the rule too.
  const { match } = input;
  const ruleBefore = rules.find((r) => r.match_type === match.type && r.match_key === match.key) ?? null;
  const rule: Rule = {
    match_type: match.type, match_key: match.key, label: match.label,
    category: input.field === "category" ? (input.value as string) : ruleBefore?.category ?? null,
    counted: input.field === "counted" ? (input.value as boolean) : ruleBefore?.counted ?? null,
  };
  const nextRules = [...rules.filter((r) => r !== ruleBefore), rule];
  const { before, after } = recompute(rows, nextRules, (r) => (r.id === input.id ? { [input.field]: true } : {}));
  return { rule, ruleBefore, before, after };
}
