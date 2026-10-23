import { merchantKey } from "@/lib/finance/normalize";

// Who the money went to, or came from, in a bank's transfer alert. The alert
// names no merchant - 25 transfers were stored as "HDFC Bank", the founder
// themselves, or nothing - yet it states the other side in fixed wording, so
// a rule can match "every transfer to account …5389". Read from the text
// with patterns rather than the model: the formats are the banks' own.
//
//   HDFC IMPS   "credited to the account ending xxxxxxxxxx5389 via IMPS"
//   HDFC RTGS   "for a transfer to payee SBI Home Loan Account using ..."
//   SBI         "Debited INR 3,127.00 on 02/09/26 -Transferred to Mr. ASHISHJAIN."
//   NEFT in     "Sent by: HEMANT KUMAR JAIN Sender Bank IFSC: ..."
//   UPI in      "b. Sender: QIKWELL TECHNOLOGIES INDIA PRIVATE LIMITED (VPA: ...)"
//   HDFC RTGS   "Credited to beneficiary A/c ending: XX5389"
//   Vested      "Your LRS remittance request (via Vested) of $1535.68"
//   HDFC        "your cross-border remittance has been successfully credited" (no name given)

export type Recipient = { key: string; label: string };

const NAME = "([A-Za-z][A-Za-z .&'-]{1,70}?)";
const PATTERNS: { re: RegExp; kind: "account" | "name" }[] = [
  { re: /credited to (?:the )?(?:beneficiary )?(?:account|a\/c)(?: no\.?)? ending:? (?:in )?[x*•\s]*(\d{4})\b/i, kind: "account" },
  { re: /remittance request \(via ([A-Za-z][A-Za-z .&'-]{1,40}?)\)/i, kind: "name" },
  { re: new RegExp(`transfer to payee ${NAME}(?= using| via| from|[.,]|$)`, "i"), kind: "name" },
  { re: new RegExp(`-\\s*transferred to (?:(?:mr|ms|mrs|m\\/s)\\.?\\s+)?${NAME}\\.(?:\\s|$)`, "i"), kind: "name" },
  { re: new RegExp(`sent by:\\s*${NAME}(?=\\s+(?:sender|ifsc|remarks|ref)|[.,]|$)`, "i"), kind: "name" },
  { re: new RegExp(`\\bsender:\\s*${NAME}(?=\\s*\\(|\\s+[a-z]\\.\\s|[.,]|$)`, "i"), kind: "name" },
];

// "HEMANT KUMAR JAIN" -> "Hemant Kumar Jain"; mixed case is kept.
const tidy = (name: string) => {
  const n = name.replace(/\s+/g, " ").trim();
  return n === n.toUpperCase() ? n.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : n;
};

export function transferRecipient(body: string | null | undefined): Recipient | null {
  const text = (body ?? "").replace(/\s+/g, " ");
  // HDFC's remittance notices never name the beneficiary; grouping them still
  // lets one rule file every international transfer.
  if (/cross-border remittance/i.test(text)) return { key: "name:internationalremittance", label: "International remittance" };
  for (const { re, kind } of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (kind === "account") return { key: `account:${m[1]}`, label: `account …${m[1]}` };
    const label = tidy(m[1]);
    const key = merchantKey(label);
    if (key.length >= 3) return { key: `name:${key}`, label };
  }
  return null;
}
