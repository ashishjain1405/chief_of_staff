import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subWeeks, subMonths, subQuarters, startOfYear } from "date-fns";
import { normalizeMerchant } from "@/lib/finance/normalize";
import type { EntityContext, TemporalAnchor } from "./types";

export interface ResolvedEntities {
  contactIds: string[];
  merchantNames: string[];
  resolvedDateRange: { from: string; to: string } | null;
  temporalConfidence: number;
}

function relativeToDateRange(period: NonNullable<TemporalAnchor["relativePeriod"]>): { from: string; to: string } {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case "this_week":
      return { from: startOfWeek(now).toISOString(), to: endOfWeek(now).toISOString() };
    case "last_week": {
      const lastWeek = subWeeks(now, 1);
      return { from: startOfWeek(lastWeek).toISOString(), to: endOfWeek(lastWeek).toISOString() };
    }
    case "this_month":
      return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() };
    case "last_month": {
      const lastMonth = subMonths(now, 1);
      return { from: startOfMonth(lastMonth).toISOString(), to: endOfMonth(lastMonth).toISOString() };
    }
    case "last_quarter": {
      const lastQ = subQuarters(now, 1);
      return { from: startOfMonth(lastQ).toISOString(), to: endOfMonth(subMonths(lastQ, -2)).toISOString() };
    }
    case "this_year":
      return { from: startOfYear(now).toISOString(), to: endOfDay(now).toISOString() };
  }
}

export async function resolveEntities(
  entities: EntityContext,
  temporal: TemporalAnchor | null,
  userId: string,
  supabase: ReturnType<typeof import("@/lib/supabase/server")["createClient"]> extends Promise<infer T> ? T : never
): Promise<ResolvedEntities> {
  const contactIds: string[] = [];
  const merchantNames: string[] = [];
  let resolvedDateRange: { from: string; to: string } | null = null;
  let temporalConfidence = 1.0;

  // Resolve people → contact IDs (fuzzy: name + email + tags)
  if (entities.people.length > 0) {
    for (const name of entities.people) {
      const { data } = await (supabase as any)
        .from("contacts")
        .select("id")
        .eq("user_id", userId)
        .or(`name.ilike.%${name}%,email.ilike.%${name}%`)
        .limit(3);
      if (data) {
        for (const row of data) {
          if (!contactIds.includes(row.id)) contactIds.push(row.id);
        }
      }
    }
  }

  // Resolve merchants → normalized names
  for (const merchant of entities.merchants) {
    const normalized = normalizeMerchant(merchant) ?? merchant;
    if (!merchantNames.includes(normalized)) merchantNames.push(normalized);
  }

  // Resolve temporal anchor → dateRange
  if (temporal) {
    if (temporal.type === "absolute" && temporal.dateRange) {
      resolvedDateRange = temporal.dateRange;
      temporalConfidence = 1.0;
    } else if (temporal.type === "relative" && temporal.relativePeriod) {
      resolvedDateRange = relativeToDateRange(temporal.relativePeriod);
      temporalConfidence = 0.95;
    } else if (temporal.type === "event_relative") {
      const anchorResult = await resolveEventAnchor(temporal, userId, contactIds, supabase as any);
      resolvedDateRange = anchorResult.dateRange;
      temporalConfidence = anchorResult.confidence;
    }
  }

  return { contactIds, merchantNames, resolvedDateRange, temporalConfidence };
}

async function resolveEventAnchor(
  temporal: TemporalAnchor,
  userId: string,
  contactIds: string[],
  supabase: any
): Promise<{ dateRange: { from: string; to: string } | null; confidence: number }> {
  const windowDays = temporal.relative_window
    ? parseInt(temporal.relative_window.replace(/[^0-9-]/g, ""), 10)
    : 7;
  const before = temporal.relative_window?.startsWith("-");

  switch (temporal.anchor_event) {
    case "salary_credit": {
      const { data } = await supabase
        .from("transactions_normalized")
        .select("transaction_datetime")
        .eq("user_id", userId)
        .eq("transaction_type", "salary_credit")
        .order("transaction_datetime", { ascending: false })
        .limit(1);
      if (!data?.length) return { dateRange: null, confidence: 0.2 };
      const anchor = new Date(data[0].transaction_datetime);
      return {
        dateRange: windowDateRange(anchor, windowDays, !!before),
        confidence: 0.85,
      };
    }
    case "travel_booking": {
      const ref = temporal.anchor_ref ?? "";
      const { data } = await supabase
        .from("communications")
        .select("occurred_at")
        .eq("user_id", userId)
        .eq("email_category", "travel")
        .ilike("subject", `%${ref}%`)
        .order("occurred_at", { ascending: false })
        .limit(3);
      if (!data?.length) return { dateRange: null, confidence: 0.2 };
      const confidence = data.length > 1 ? 0.6 : 0.85;
      const anchor = new Date(data[0].occurred_at);
      return { dateRange: windowDateRange(anchor, windowDays, !!before), confidence };
    }
    case "named_contact_interaction": {
      if (!contactIds.length) return { dateRange: null, confidence: 0.2 };
      const { data } = await supabase
        .from("relationships")
        .select("last_interaction_at")
        .eq("user_id", userId)
        .in("contact_id", contactIds)
        .order("last_interaction_at", { ascending: false })
        .limit(1);
      if (!data?.length) return { dateRange: null, confidence: 0.2 };
      const anchor = new Date(data[0].last_interaction_at);
      return { dateRange: windowDateRange(anchor, windowDays, !!before), confidence: 0.85 };
    }
    default:
      return { dateRange: null, confidence: 0.2 };
  }
}

function windowDateRange(
  anchor: Date,
  windowDays: number,
  before: boolean
): { from: string; to: string } {
  const ms = Math.abs(windowDays) * 864e5;
  if (before) {
    return {
      from: new Date(anchor.getTime() - ms).toISOString(),
      to: anchor.toISOString(),
    };
  }
  return {
    from: anchor.toISOString(),
    to: new Date(anchor.getTime() + ms).toISOString(),
  };
}
