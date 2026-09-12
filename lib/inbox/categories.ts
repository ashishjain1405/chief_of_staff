export const CATEGORIES = [
  { key: "important",                label: "Important",              icon: "★", group: "priority" },
  { key: "pending_reply",            label: "Pending Reply",          icon: "↩", group: "priority" },
  { key: "account_security",         label: "Account & Security",     icon: "🔒", group: "priority" },

  { key: "finance_bills",            label: "Finance & Bills",        icon: "₹", group: "finance" },
  { key: "transactions",             label: "Transactions",           icon: "🧾", group: "finance" },
  { key: "subscriptions_memberships", label: "Subscriptions",         icon: "♻", group: "finance" },
  { key: "receipts_documents",       label: "Receipts & Docs",        icon: "📄", group: "finance" },

  { key: "shipping_orders",          label: "Shipping & Orders",      icon: "📦", group: "logistics" },
  { key: "travel",                   label: "Travel",                 icon: "✈", group: "logistics" },
  { key: "meetings_calendar",        label: "Meetings",               icon: "📅", group: "logistics" },

  { key: "productivity_tools",       label: "Productivity",           icon: "⚙", group: "work" },
  { key: "career",                   label: "Career",                 icon: "💼", group: "work" },
  { key: "legal_government",         label: "Legal & Gov",            icon: "⚖", group: "work" },

  { key: "learning",                 label: "Learning",               icon: "🎓", group: "personal" },
  { key: "fitness",                  label: "Fitness & Health",       icon: "🏃", group: "personal" },
  { key: "social",                   label: "Social",                 icon: "💬", group: "personal" },

  { key: "newsletters",              label: "Newsletters",            icon: "📰", group: "low_signal" },
  { key: "news",                     label: "News",                   icon: "📡", group: "low_signal" },
  { key: "promotions",               label: "Promotions",             icon: "%", group: "low_signal" },
  { key: "entertainment",            label: "Entertainment",          icon: "🎬", group: "low_signal" },
  { key: "system_notifications",     label: "System",                 icon: "🔔", group: "low_signal" },
  { key: "other",                    label: "Other",                  icon: "•", group: "low_signal" },
] as const;

export const CATEGORY_GROUPS = [
  { key: "priority",   label: "Priority",    defaultCollapsed: false },
  { key: "finance",    label: "Finance",      defaultCollapsed: false },
  { key: "logistics",  label: "Logistics",    defaultCollapsed: false },
  { key: "work",       label: "Work",         defaultCollapsed: false },
  { key: "personal",   label: "Personal",     defaultCollapsed: false },
  { key: "low_signal", label: "Everything Else", defaultCollapsed: true },
] as const;

const LOW_SIGNAL_GROUP = CATEGORIES.filter((c) => c.group === "low_signal").map((c) => c.key as string);

// Mail you skim rather than act on. Used to cap importance_score, which is why
// "other" is deliberately absent: it is a catch-all, and suppressing its
// importance would bury a genuinely urgent email that triage failed to
// classify. "social" sits under Personal in the sidebar but behaves this way.
export const LOW_SIGNAL_CATEGORIES: ReadonlySet<string> = new Set([
  ...LOW_SIGNAL_GROUP.filter((k) => k !== "other"),
  "social",
]);

// Categories that must never create a task, derived from the same CATEGORIES
// list the sidebar renders so the two cannot drift apart again. They had:
// "other" sat in the "Everything Else" group but was not blocked and produced
// a "Book your pass for TechSparks 2026" task, while "social" was blocked in
// the worker but displayed under Personal.
//
// "transactions" and "account_security" are here for a different reason - they
// report something that already completed, so the only action they contain is
// a conditional disclaimer ("if you did not authorize this, report it") that
// appears in every alert of the kind.
export const NO_TASK_CATEGORIES: ReadonlySet<string> = new Set([
  ...LOW_SIGNAL_GROUP,
  "social",
]);

// Blocked only when the sender is an automated financial or service address.
// These categories describe something that already completed, so their only
// "action" is a conditional disclaimer - "if you did not authorize this,
// report it" - present in every alert of the kind.
//
// Conditioned on the sender because the category alone over-blocks: a human
// email in an investment thread saying "make the international wire transfer
// as discussed" was classified "transactions", and a flat category block
// silently dropped that genuine action.
export const AUTOMATED_ONLY_NO_TASK_CATEGORIES: ReadonlySet<string> = new Set([
  "transactions",
  "account_security",
]);
