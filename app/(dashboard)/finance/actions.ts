"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { builtInCategory, categoryLabel, merchantLabel } from "@/components/finance/labels";
import {
  CATEGORY_NAME_MAX, cleanCategoryName, customCategoryKey, isCategoryOption, isCustomCategory, matchesFor, planChange, recompute, rulesWithout,
  type ChangeInput, type Match, type Rule, type RowLike, type Snapshot, type UserCategory,
} from "@/lib/finance/rules";

// The founder's categories and counting decisions. Each action runs on the
// session client, so row-level security keeps it to their own rows, and
// returns what it changed so Undo can put exactly that back.

type Row = RowLike & { id: string };
export type Undo = { rows: Snapshot[]; rule: { match: Match; before: Rule | null } | null };
export type ChangeResult = { changed: number; undo: Undo };
// Errors the founder can fix are returned, not thrown: a thrown message is
// hidden in production.
export type CategoryResult = { key: string; label: string } | { error: string };

const FIELDS = "id, merchant_normalized, upi_key, recipient_key, recipient_label, category, category_auto, category_source, counted_override, counted_source";
const SOURCES = new Set(["auto", "rule", "user"]);

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return { supabase, userId: user.id };
}
type Db = Awaited<ReturnType<typeof session>>["supabase"];

async function loadRows(db: Db, userId: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("transactions_normalized").select(FIELDS).eq("user_id", userId).range(from, from + 999);
    if (error) throw new Error("Could not load transactions");
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function loadRules(db: Db, userId: string): Promise<Rule[]> {
  const { data, error } = await db.from("transaction_rules").select("id, match_type, match_key, label, category, counted").eq("user_id", userId);
  if (error) throw new Error("Could not load rules");
  return (data ?? []) as Rule[];
}

async function loadCategories(db: Db, userId: string): Promise<UserCategory[]> {
  const { data, error } = await db.from("user_categories").select("id, key, label").eq("user_id", userId);
  if (error) throw new Error("Could not load categories");
  return (data ?? []) as UserCategory[];
}

// Writes the new values, grouped so identical changes are one update.
async function write(db: Db, changes: Snapshot[]) {
  const batches = new Map<string, string[]>();
  for (const { id, ...values } of changes) batches.set(JSON.stringify(values), [...(batches.get(JSON.stringify(values)) ?? []), id]);
  for (const [values, ids] of batches) {
    const { error } = await db.from("transactions_normalized").update(JSON.parse(values)).in("id", ids);
    if (error) throw new Error("Could not save the change");
  }
  revalidatePath("/finance");
  revalidatePath("/inbox/spend");
}

async function saveRule(db: Db, userId: string, rule: Rule) {
  const { error } = await db.from("transaction_rules").upsert(
    { user_id: userId, match_type: rule.match_type, match_key: rule.match_key, label: rule.label, category: rule.category, counted: rule.counted },
    { onConflict: "user_id,match_type,match_key" }
  );
  if (error) throw new Error("Could not save the rule");
}

export async function changeTransaction(input: ChangeInput): Promise<ChangeResult> {
  const { field, value, scope, match } = input;
  const custom = field === "category" && typeof value === "string" && isCustomCategory(value);
  if (field === "category" ? typeof value !== "string" || !(isCategoryOption(value) || custom) : typeof value !== "boolean") throw new Error("Invalid value");
  if (scope !== "one" && scope !== "all") throw new Error("Invalid scope");
  const { supabase, userId } = await session();
  const [rows, rules, mine] = await Promise.all([loadRows(supabase, userId), loadRules(supabase, userId), custom ? loadCategories(supabase, userId) : []]);
  if (custom && !mine.some((c) => c.key === value)) throw new Error("Invalid value");
  const target = rows.find((r) => r.id === input.id);
  if (!target) throw new Error("Transaction not found");
  // The match must be one the transaction actually has.
  if (scope === "all" && !(match && matchesFor(target, merchantLabel).some((m) => m.type === match.type && m.key === match.key))) throw new Error("Invalid match");

  const plan = planChange(rows, rules, input);
  if (plan.rule) await saveRule(supabase, userId, plan.rule);
  await write(supabase, plan.after);
  return { changed: plan.after.length, undo: { rows: plan.before, rule: plan.rule && match ? { match, before: plan.ruleBefore } : null } };
}

// Back to automatic for one transaction: whatever rules match, else the
// category extraction gave and the normal spend rules.
export async function resetTransaction(id: string): Promise<ChangeResult> {
  const { supabase, userId } = await session();
  const [rows, rules] = await Promise.all([loadRows(supabase, userId), loadRules(supabase, userId)]);
  const target = rows.filter((r) => r.id === id);
  if (!target.length) throw new Error("Transaction not found");
  const { before, after } = recompute(target, rules, () => ({ category: true, counted: true }));
  await write(supabase, after);
  return { changed: after.length, undo: { rows: before, rule: null } };
}

export async function deleteRule(ruleId: string): Promise<ChangeResult> {
  const { supabase, userId } = await session();
  const [rows, rules] = await Promise.all([loadRows(supabase, userId), loadRules(supabase, userId)]);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) throw new Error("Rule not found");
  const { error } = await supabase.from("transaction_rules").delete().eq("id", ruleId);
  if (error) throw new Error("Could not delete the rule");
  const { before, after } = recompute(rows, rules.filter((r) => r.id !== ruleId), () => ({}));
  await write(supabase, after);
  return { changed: after.length, undo: { rows: before, rule: { match: { type: rule.match_type as Match["type"], key: rule.match_key, label: rule.label }, before: rule } } };
}

// A name that is already a category picks that one rather than adding a twin.
export async function createCategory(name: string): Promise<CategoryResult> {
  const label = cleanCategoryName(name);
  if (!label) return { error: `Use 1 to ${CATEGORY_NAME_MAX} characters` };
  const builtIn = builtInCategory(label);
  if (builtIn) return { key: builtIn, label: categoryLabel(builtIn) };
  const { supabase, userId } = await session();
  const mine = await loadCategories(supabase, userId);
  const same = mine.find((c) => c.label.toLowerCase() === label.toLowerCase());
  if (same) return { key: same.key, label: same.label };
  const key = customCategoryKey(label, new Set(mine.map((c) => c.key)));
  const { error } = await supabase.from("user_categories").insert({ user_id: userId, key, label });
  if (error) return { error: "Could not add the category. Try again." };
  revalidatePath("/finance");
  return { key, label };
}

// Only the name changes: transactions and rules store the key.
export async function renameCategory(id: string, name: string): Promise<{ error?: string }> {
  const label = cleanCategoryName(name);
  if (!label) return { error: `Use 1 to ${CATEGORY_NAME_MAX} characters` };
  const builtIn = builtInCategory(label);
  if (builtIn) return { error: `${categoryLabel(builtIn)} is already a category` };
  const { supabase, userId } = await session();
  const mine = await loadCategories(supabase, userId);
  if (!mine.some((c) => c.id === id)) return { error: "That category no longer exists" };
  if (mine.some((c) => c.id !== id && c.label.toLowerCase() === label.toLowerCase())) return { error: `You already have ${label}` };
  const { error } = await supabase.from("user_categories").update({ label }).eq("id", id);
  if (error) return { error: "Could not rename it. Try again." };
  revalidatePath("/finance");
  revalidatePath("/inbox/spend");
  return {};
}

// Its transactions go back to automatic, or to another rule that matches them.
export async function deleteCategory(id: string): Promise<{ changed: number }> {
  const { supabase, userId } = await session();
  const [rows, rules, mine] = await Promise.all([loadRows(supabase, userId), loadRules(supabase, userId), loadCategories(supabase, userId)]);
  const category = mine.find((c) => c.id === id);
  if (!category) throw new Error("Category not found");
  const filing = rules.filter((r) => r.category === category.key);
  const drop = filing.filter((r) => r.counted === null).map((r) => r.id!);
  const keep = filing.filter((r) => r.counted !== null).map((r) => r.id!);
  if (drop.length) {
    const { error } = await supabase.from("transaction_rules").delete().in("id", drop);
    if (error) throw new Error("Could not update your rules");
  }
  if (keep.length) {
    const { error } = await supabase.from("transaction_rules").update({ category: null }).in("id", keep);
    if (error) throw new Error("Could not update your rules");
  }
  const { after } = recompute(rows, rulesWithout(rules, category.key), (r) => ({ category: r.category === category.key }));
  await write(supabase, after);
  const { error } = await supabase.from("user_categories").delete().eq("id", id);
  if (error) throw new Error("Could not delete the category");
  return { changed: after.length };
}

export async function undoChange(undo: Undo): Promise<void> {
  const valid = (s: Snapshot) =>
    typeof s.id === "string" && SOURCES.has(s.category_source) && (s.category === null || (typeof s.category === "string" && s.category.length <= 60)) &&
    (s.counted_override === null || typeof s.counted_override === "boolean") && (s.counted_source === null || s.counted_source === "rule" || s.counted_source === "user");
  if (!Array.isArray(undo?.rows) || !undo.rows.every(valid)) throw new Error("Invalid undo");
  const { supabase, userId } = await session();
  if (undo.rule) {
    const { match, before } = undo.rule;
    if (before) await saveRule(supabase, userId, before);
    else {
      const { error } = await supabase.from("transaction_rules").delete().eq("user_id", userId).eq("match_type", match.type).eq("match_key", match.key);
      if (error) throw new Error("Could not restore the rule");
    }
  }
  await write(supabase, undo.rows);
}
