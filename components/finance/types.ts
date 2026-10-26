import type { Source } from "@/lib/finance/rules";

// A row of the Finance transactions list. Shared by the page (server) and the
// interactive table (client), so it lives outside the "use client" file.
export type TransactionRow = {
  id: string;
  merchant_normalized: string | null;
  category: string | null;
  transaction_datetime: string;
  transaction_type: string | null;
  status: string | null;
  amount: number | null;
  order_total?: number | null;
  currency: string | null;
  communication_ids?: string[] | null;
  category_auto?: string | null;
  category_source?: Source;
  counted_override?: boolean | null;
  counted_source?: "rule" | "user" | null;
  upi_key?: string | null;
  recipient_key?: string | null;
  recipient_label?: string | null;
};
