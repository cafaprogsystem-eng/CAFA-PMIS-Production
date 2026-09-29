import type { ReactNode } from "react";

/**
 * The small Markdown subset the System Manual is written in, rendered to
 * React elements. Content is editable by coordinators, so nothing is ever
 * injected as HTML: text stays text, and only these constructs get markup —
 *   ## / ### headings, - bullet lists, 1. numbered lists, | tables |,
 *   > quotes, **bold** and `code` inside any of them, and plain paragraphs.
 */

export type ManualBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "numbered"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] }
  | { type: "paragraph"; lines: string[] };

const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseManualMarkdown(content: string): ManualBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ManualBlock[] = [];
  let i = 0;
  const take = (test: (line: string) => boolean) => {
    const out: string[] = [];
    while (i < lines.length && test(lines[i])) out.push(lines[i++]);
    return out;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line.trim());
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 2 | 3, text: heading[2] });
      i++;
    } else if (BULLET.test(line)) {
      blocks.push({ type: "bullets", items: take((l) => BULLET.test(l)).map((l) => l.replace(BULLET, "")) });
    } else if (NUMBERED.test(line)) {
      blocks.push({ type: "numbered", items: take((l) => NUMBERED.test(l)).map((l) => l.replace(NUMBERED, "")) });
    } else if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const header = cells(lines[i]);
      i += 2;
      blocks.push({ type: "table", header, rows: take((l) => TABLE_ROW.test(l)).map(cells) });
    } else if (line.trim().startsWith(">")) {
      blocks.push({ type: "quote", lines: take((l) => l.trim().startsWith(">")).map((l) => l.trim().replace(/^>\s?/, "")) });
    } else {
      // A paragraph runs until a blank line or the start of another block.
      const para: string[] = [];
      while (
        i < lines.length && lines[i].trim() &&
        !/^#{2,3}\s/.test(lines[i].trim()) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) &&
        !lines[i].trim().startsWith(">") && !(TABLE_ROW.test(lines[i]) && TABLE_RULE.test(lines[i + 1] ?? ""))
      ) para.push(lines[i++].trim());
      blocks.push({ type: "paragraph", lines: para });
    }
  }
  return blocks;
}

/** **bold** and `code` as elements; everything else is plain text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(match[1] !== undefined
      ? <strong key={match.index} className="font-semibold text-[var(--foreground)]">{match[1]}</strong>
      : <code key={match.index} className="rounded bg-[var(--default)] px-1 py-0.5 font-mono text-[0.85em]" dir="ltr">{match[2]}</code>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ManualMarkdown({ content, emptyText }: { content: string; emptyText: string }) {
  if (!content.trim()) return <p className="text-xs italic text-[var(--muted)]">{emptyText}</p>;
  return (
    <div className="space-y-3 text-sm leading-relaxed" dir="auto">
      {parseManualMarkdown(content).map((block, i) => {
        switch (block.type) {
          case "heading":
            return block.level === 2
              ? <h3 key={i} className="mb-1 mt-4 text-sm font-semibold text-[var(--foreground)]">{renderInline(block.text)}</h3>
              : <h4 key={i} className="mb-1 mt-3 text-sm font-medium text-[var(--foreground)]">{renderInline(block.text)}</h4>;
          case "bullets":
            return (
              <ul key={i} className="space-y-1.5 ps-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case "numbered":
            return (
              <ol key={i} className="list-none space-y-1.5 ps-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span className="mt-0.5 w-5 shrink-0 text-xs font-medium text-[var(--accent)]" aria-hidden="true"><bdi dir="ltr">{j + 1}.</bdi></span>
                    <span>{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--default)]">
                    <tr>
                      {block.header.map((h, j) => (
                        <th key={j} scope="col" className="px-3 py-2 text-start text-xs font-medium text-[var(--muted)]">{renderInline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {block.header.map((_, c) => (
                          <td key={c} className="px-3 py-2 align-top">{renderInline(row[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote":
            return (
              <blockquote key={i} className="rounded-e-lg border-s-4 border-[var(--accent)] bg-[var(--accent)]/5 px-4 py-2.5 text-[var(--foreground)]">
                {block.lines.map((l, j) => <p key={j}>{renderInline(l)}</p>)}
              </blockquote>
            );
          default:
            return <p key={i}>{block.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{renderInline(l)}</span>)}</p>;
        }
      })}
    </div>
  );
}
