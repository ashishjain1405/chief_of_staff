// Sample questions in the style of the Ask AI page: money and deadlines alike.
const CHAT: { q: string; a: string }[] = [
  { q: "How much have I spent on food delivery this month?", a: "₹6,120 across 14 orders: Swiggy ₹3,480 and Zomato ₹2,640." },
  { q: "When is my car insurance due?", a: "Friday. The renewal email asks for ₹8,240, and it is already on your task list." },
  { q: "What did I promise Priya?", a: "To get back to her about the lease by tomorrow." },
];

export function AskPreview() {
  return (
    <figure aria-label="Example questions to Ask AI" className="flex flex-col rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">Ask AI</p>
        <p className="text-xs text-muted-foreground">Answers from your own inbox</p>
      </div>
      <div className="mt-5 space-y-5 text-sm">
        {CHAT.map(({ q, a }) => (
          <div key={q} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-sky-600 px-3.5 py-2 text-white">{q}</p>
            <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2 leading-relaxed text-foreground">{a}</p>
          </div>
        ))}
      </div>
      <div className="mt-auto pt-5">
        <p className="rounded-full border border-border bg-background px-4 py-2.5 text-sm text-muted-foreground">Ask anything…</p>
      </div>
    </figure>
  );
}
