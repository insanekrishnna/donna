import { Fragment, type ReactNode } from "react";

/**
 * A small Markdown renderer for agent reports: headings, paragraphs, lists, tables, code
 * blocks, bold, italic, inline code and links. It builds React elements, never raw HTML,
 * so text from the model cannot inject markup or scripts.
 */

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string }
  | { type: "rule" };

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) body.push(lines[i++] ?? "");
      i += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: (heading[2] ?? "").replace(/\s*#+\s*$/, "") });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i += 1;
      continue;
    }
    const next = lines[i + 1] ?? "";
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(next)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) rows.push(splitRow(lines[i++] ?? ""));
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const bullet = /^\s*([-*+]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i] ?? "")) {
        let item = (lines[i] ?? "").replace(bullet, "");
        i += 1;
        // Indented continuation lines belong to the same item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i] ?? "") && !bullet.test(lines[i] ?? "")) item += ` ${(lines[i++] ?? "").trim()}`;
        items.push(item);
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const para: string[] = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s)/.test(l) || l.includes("|")) break;
      para.push(l.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

/** Inline formatting: **bold**, *italic*, `code`, [text](https://link). */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(pattern)) {
    const token = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (token.startsWith("**")) out.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={k++} className="rounded bg-donna-bg px-1 font-mono text-sm">{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link?.[2] ?? "";
      // Only http(s) links are rendered as links; anything else (javascript:, data:) stays text.
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={k++} href={href} target="_blank" rel="noopener noreferrer" className="text-donna-accent underline">
            {link?.[1]}
          </a>,
        );
      } else out.push(link?.[1] ?? token);
    } else out.push(<em key={k++}>{token.slice(1, -1)}</em>);
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-4 text-base leading-relaxed">
      {parseMarkdown(source).map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level === 1 ? (
              <h2 key={i} className="text-xl font-semibold">{renderInline(b.text)}</h2>
            ) : b.level === 2 ? (
              <h3 key={i} className="pt-2 text-lg font-semibold">{renderInline(b.text)}</h3>
            ) : (
              <h4 key={i} className="font-semibold">{renderInline(b.text)}</h4>
            );
          case "paragraph":
            return <p key={i}>{renderInline(b.text)}</p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`space-y-1 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} className="border-b border-donna-line px-3 py-2 text-left font-medium">{renderInline(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {b.header.map((_, c) => (
                          <td key={c} className="border-b border-donna-line px-3 py-2 align-top">{renderInline(r[c] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-lg bg-donna-bg p-4 font-mono text-sm">
                {b.text}
              </pre>
            );
          case "rule":
            return <hr key={i} className="border-donna-line" />;
          default:
            return <Fragment key={i} />;
        }
      })}
    </div>
  );
}
