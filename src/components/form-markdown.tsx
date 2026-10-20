import { Fragment } from "react";
import { inlineRuns, parseMarkdown } from "@/lib/forms/markdown";

const Inline = ({ s }: { s: string }) => (
  <>{inlineRuns(s).map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <Fragment key={i}>{r.text}</Fragment>))}</>
);

/** On-screen preview of a form, matching the PDF layout (serif, centered title). No raw HTML. */
export function FormMarkdown({ text }: { text: string }) {
  return (
    <div className="font-serif text-[15px] leading-relaxed text-ink">
      {parseMarkdown(text).map((b, i) => {
        if (b.t === "h")
          return b.level === 1 ? (
            <h1 key={i} className="mb-4 text-center text-xl font-bold"><Inline s={b.text} /></h1>
          ) : (
            <h2 key={i} className={b.level === 2 ? "mt-5 mb-1.5 text-base font-bold" : "mt-3 mb-1 font-bold"}><Inline s={b.text} /></h2>
          );
        if (b.t === "p") return <p key={i} className={/_{6,}/.test(b.text) ? "mb-5" : "mb-3"}><Inline s={b.text} /></p>;
        if (b.t === "hr") return <hr key={i} className="my-4 border-line" />;
        if (b.t === "list") {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i} className={`mb-3 space-y-1 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
              {b.items.map((it, j) => <li key={j}><Inline s={it} /></li>)}
            </Tag>
          );
        }
        return (
          <div key={i} className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead><tr>{b.header.map((h, j) => <th key={j} className="border border-gray-400 bg-gray-100 px-2 py-1 text-left font-bold"><Inline s={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border border-gray-400 px-2 py-1 align-top"><Inline s={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
