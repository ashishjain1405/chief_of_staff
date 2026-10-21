import { MERCHANT_DATA } from "@/lib/finance/normalize";

// Display names only - the stored category keys are unchanged. Everything in
// the finance view uses sentence case ("Food delivery", not "Food Delivery").
const CATEGORY_NAMES: Record<string, string> = {
  ecommerce: "E-commerce",
  ai_tools: "AI tools",
  unknown: "Uncategorised",
  other: "Other",
};

export function categoryLabel(key: string | null | undefined): string {
  if (!key) return "Uncategorised";
  if (CATEGORY_NAMES[key]) return CATEGORY_NAMES[key];
  const words = key.replace(/_/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const CANONICAL = new Map(Object.keys(MERCHANT_DATA).map((name) => [squash(name), name]));
// All-caps words kept as they are; any other shouted word is title-cased.
const ACRONYMS = new Set(["PVR", "HDFC", "ICICI", "SBI", "IDFC", "RBL", "LIC", "GIC", "ERGO", "IRCTC", "BSE", "NSE", "NPS", "UPI", "OYO", "KFC", "BPCL", "HPCL", "IOCL", "GST", "EMI", "ATM", "NEFT", "IMPS", "LLP", "AI"]);

// Merchant names arrive as "PVR LIMITED", "themis barbeque house" or
// "chef_kenzo". Known merchants take their canonical spelling, names already
// in mixed case ("OpenAI") are kept, and the rest are title-cased.
export function merchantLabel(name: string | null | undefined): string {
  const cleaned = (name ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Unknown merchant";
  const canonical = CANONICAL.get(squash(cleaned));
  if (canonical) return canonical;
  if (/[a-z]/.test(cleaned) && /[A-Z]/.test(cleaned)) return cleaned;
  return cleaned
    .split(" ")
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

// Axis ticks: ₹0, ₹50K, ₹1L, ₹2.5L.
export function inrCompact(n: number): string {
  return `₹${compact.format(n)}`;
}

export const IST = "Asia/Kolkata";

export function istDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(iso).toLocaleDateString("en-IN", { ...opts, timeZone: IST });
}
