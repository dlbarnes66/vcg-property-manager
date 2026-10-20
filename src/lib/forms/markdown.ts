/*
 * A small Markdown subset for forms: # headings, paragraphs, - and 1. lists, | tables |, ---,
 * and **bold**. Parsed once here so the on-screen preview and the PDF agree.
 */
export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "list"; ordered: boolean; items: string[] }
  | { t: "table"; header: string[]; rows: string[][] }
  | { t: "hr" };

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join(" ").trim() });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const tr = line.trim();
    if (!tr) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(tr);
    if (h) { flush(); out.push({ t: "h", level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2].replace(/#+\s*$/, "").trim() }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(tr)) { flush(); out.push({ t: "hr" }); continue; } // "____" stays text: it's a fill-in line
    if (tr.startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const header = cells(tr);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      i--;
      out.push({ t: "table", header, rows: rows.map((r) => header.map((_, k) => r[k] ?? "")) });
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]);
      const prev = out[out.length - 1];
      if (prev?.t === "list" && prev.ordered === ordered) prev.items.push(li[2]);
      else out.push({ t: "list", ordered, items: [li[2]] });
      continue;
    }
    // continuation of a list item (indented line right after an item)
    const prev = out[out.length - 1];
    if (!para.length && prev?.t === "list" && /^\s{2,}\S/.test(line)) { prev.items[prev.items.length - 1] += " " + tr; continue; }
    para.push(tr);
  }
  flush();
  return out;
}

/** Splits "**bold**" runs: [{text, bold}]. */
export function inlineRuns(s: string): { text: string; bold: boolean }[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { text: p.slice(2, -2), bold: true } : { text: p.replace(/\*\*/g, ""), bold: false }));
}

/** First "# Heading" in the text, for a default title. */
export const firstHeading = (s: string) => parseMarkdown(s).find((b): b is Extract<Block, { t: "h" }> => b.t === "h")?.text ?? null;
