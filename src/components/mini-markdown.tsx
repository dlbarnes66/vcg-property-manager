import { Fragment } from "react";
import Link from "next/link";

/** Tiny, safe markdown for AI answers: paragraphs, - / 1. lists, **bold**, `code`, and links to pages inside this app ([text](/path)). No raw HTML or outside links. */
export function MiniMarkdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim() !== "");
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l)))
          return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>)}</ul>;
        if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
          return <ol key={i} className="list-decimal space-y-1 pl-5">{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>)}</ol>;
        const h = /^#{1,4}\s+(.*)$/.exec(lines[0] ?? "");
        if (h && lines.length === 1) return <p key={i} className="font-semibold">{inline(h[1])}</p>;
        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l.replace(/^#{1,4}\s+/, ""))}</Fragment>)}</p>;
      })}
    </div>
  );
}

const APP_LINK = /^\[([^\]]+)\]\((\/(?!\/)[^)\s]*)\)$/;

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(\/(?!\/)[^)\s]*\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-paper px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    const link = APP_LINK.exec(part);
    if (link) return <Link key={i} href={link[2]} className="font-medium text-navy underline underline-offset-2">{link[1]}</Link>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
