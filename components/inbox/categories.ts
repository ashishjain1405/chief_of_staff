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
