// Renders the daily brief's markdown - headings, numbered and bulleted items,
// and **bold** - as React elements. It used to print the raw text, "##" and
// "**" included, cut at 800 characters. No HTML is injected: the brief is
// model output built from email text.
//
// The brief nests loosely: "1. **Pay the bill**" followed by "- Task: ..." or a
// plain line of detail. Those follow-on lines belong to the item above them, so
// they render beneath it and the numbering carries on instead of restarting.

type Item = { text: string; n?: number; details: string[] };
type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; ordered: boolean; items: Item[] }
  | { kind: "paragraph"; text: string };

function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/^```(?:markdown)?\s*|\s*```$/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || /^-{3,}$/.test(line)) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    const lastItem = last?.kind === "list" ? last.items[last.items.length - 1] : undefined;

    if (heading) blocks.push({ kind: "heading", text: heading[1] });
    else if (numbered) {
      const item = { text: numbered[2], n: Number(numbered[1]), details: [] };
      if (last?.kind === "list" && last.ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered: true, items: [item] });
    } else if (bullet) {
      if (last?.kind === "list" && last.ordered && lastItem) lastItem.details.push(bullet[1]);
      else if (last?.kind === "list" && !last.ordered) last.items.push({ text: bullet[1], details: [] });
      else blocks.push({ kind: "list", ordered: false, items: [{ text: bullet[1], details: [] }] });
    } else if (lastItem && !line.startsWith("**")) lastItem.details.push(line);
    else if (last?.kind === "paragraph") last.text += ` ${line}`;
    else blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function Brief({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
      {parse(markdown).map((b, i) => {
        if (b.kind === "heading") {
          return (
            <h3 key={i} className="pt-2 text-sm font-semibold text-foreground first:pt-0">
              <Inline text={b.text} />
            </h3>
          );
        }
        if (b.kind === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List key={i} className={`space-y-2 pl-5 ${b.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground/60`}>
              {b.items.map((item, j) => (
                <li key={j} value={item.n} className="break-inside-avoid">
                  <Inline text={item.text} />
                  {item.details.map((d, k) => (
                    <p key={k} className="mt-0.5 text-[13px] text-muted-foreground">
                      <Inline text={d} />
                    </p>
                  ))}
                </li>
              ))}
            </List>
          );
        }
        return <p key={i}><Inline text={b.text} /></p>;
      })}
    </div>
  );
}
