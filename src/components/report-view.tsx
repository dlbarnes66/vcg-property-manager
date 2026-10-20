import Link from "next/link";
import { Card, CardHeader, Empty, Stat, Table, Td, Th } from "@/components/ui";
import { colMax, fmtCell, isNumeric, type ReportData } from "@/lib/report-kit";
import { cn } from "@/lib/utils";

const toneText = { bad: "text-red-700", warn: "text-amber-800", good: "" } as const;
const toneEdge = { bad: "border-l-red-500", warn: "border-l-amber-400", good: "border-l-emerald-500" } as const;

/** Renders any ReportData: KPI tiles, then each table, then footnotes. */
export function ReportView({ data }: { data: ReportData }) {
  return (
    <div className="flex flex-col gap-6">
      {data.memo && (
        <Card className="border-l-4 border-l-gold px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-muted uppercase">From the manager</div>
          <p className="mt-1 text-sm whitespace-pre-wrap">{data.memo}</p>
        </Card>
      )}
      {data.kpis.length > 0 && (
        <div className={cn("grid grid-cols-2 gap-4", data.kpis.length === 6 ? "lg:grid-cols-6 md:grid-cols-3" : "lg:grid-cols-4")}>
          {data.kpis.map((k) => <Stat key={k.label} label={k.label} value={k.value} sub={k.sub} tone={k.tone} />)}
        </div>
      )}
      {data.tables.map((t, ti) => {
        const maxes = Object.fromEntries(t.columns.filter((c) => c.fmt === "bar").map((c) => [c.key, colMax(t.rows, c.key)]));
        return (
          <Card key={ti}>
            {t.title && <CardHeader title={t.title} subtitle={t.subtitle} />}
            {t.rows.length === 0 ? (
              <Empty>{t.empty ?? "Nothing to show for these dates."}</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>{t.columns.map((c) => <Th key={c.key} className={cn(isNumeric(c.fmt) && "text-right", c.fmt === "bar" && "w-40")}>{c.label}</Th>)}</tr>
                </thead>
                <tbody>
                  {t.rows.map((row, ri) => (
                    <tr key={ri} className={cn(row._kind === "total" && "bg-paper/60 font-semibold", row._tone && row._kind !== "total" && "border-l-2", row._tone && toneEdge[row._tone])}>
                      {t.columns.map((c, ci) => {
                        const v = row[c.key];
                        if (c.fmt === "bar")
                          return (
                            <Td key={c.key}>
                              {typeof v === "number" && v > 0 && <div className="h-2 rounded-sm bg-navy/80" style={{ width: `${Math.max(2, (v / maxes[c.key]) * 100)}%` }} />}
                            </Td>
                          );
                        const text = row._kind === "total" && v == null ? "" : fmtCell(c.fmt, v);
                        const neg = typeof v === "number" && v < 0 && c.fmt === "money";
                        return (
                          <Td key={c.key} className={cn(isNumeric(c.fmt) ? "tabular text-right whitespace-nowrap" : ci === 0 && "whitespace-nowrap font-medium", neg && "text-red-700", ci > 0 && row._tone && row._kind !== "total" && !isNumeric(c.fmt) && c.key.match(/status|recert|inspection|flag/i) && toneText[row._tone])}>
                            {ci === 0 && row._href ? <Link href={row._href} className="hover:underline">{text}</Link> : text}
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {t.note && <p className="border-t border-line px-5 py-3 text-xs text-muted">{t.note}</p>}
          </Card>
        );
      })}
      {data.notes && data.notes.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {data.notes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      )}
    </div>
  );
}
