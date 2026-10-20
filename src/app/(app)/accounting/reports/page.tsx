import Link from "next/link";
import { Download } from "lucide-react";
import { PropertySelect } from "@/components/account-select";
import { Button, Card, CardHeader, Field, Input, Table, Td } from "@/components/ui";
import { finReportRows, readFinParams } from "@/lib/fin-reports";
import { cn, dateToInput, fmtDate, money } from "@/lib/utils";

export const metadata = { title: "Financial reports" };

export default async function FinancialReports({ searchParams }: { searchParams: Promise<{ r?: string; from?: string; to?: string; propertyId?: string }> }) {
  const sp = await searchParams;
  const p = readFinParams(sp);
  const { title, rows, footnote } = await finReportRows(p);
  const qs = new URLSearchParams({ r: p.report, from: dateToInput(p.from), to: dateToInput(p.to), ...(p.propertyId ? { propertyId: p.propertyId } : {}) });
  const link = (r: string) => `/accounting/reports?${new URLSearchParams({ ...Object.fromEntries(qs), r })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1">
        {[["pl", "Profit & loss"], ["bs", "Balance sheet"], ["tb", "Trial balance"]].map(([k, l]) => (
          <Link key={k} href={link(k)} className={cn("rounded-md px-3 py-1.5 text-sm", p.report === k ? "bg-navy text-white" : "text-muted hover:bg-white")}>{l}</Link>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="r" value={p.report} />
        {p.report === "pl" && <Field label="From"><Input type="date" name="from" defaultValue={dateToInput(p.from)} /></Field>}
        <Field label={p.report === "pl" ? "To" : "As of"}><Input type="date" name="to" defaultValue={dateToInput(p.to)} /></Field>
        <Field label="Property"><PropertySelect defaultValue={p.propertyId} blank="All properties" /></Field>
        <Button type="submit" variant="secondary">Run</Button>
        <a href={`/api/accounting/${p.report}?${qs}`} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-paper">
          <Download size={14} /> CSV
        </a>
      </form>
      <Card className="max-w-3xl">
        <CardHeader title={title} subtitle={p.report === "pl" ? `${fmtDate(p.from)} – ${fmtDate(p.to)}` : `As of ${fmtDate(p.to)}`} />
        <Table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={cn(r.kind === "head" && "bg-paper/60", r.kind === "total" && "font-semibold", r.kind === "grand" && "text-base font-bold")}>
                <Td className={cn(!r.kind && "pl-8")}>{r.label}</Td>
                <Td className={cn("tabular text-right", r.amount != null && r.amount < 0 && "text-red-700")}>{r.amount == null ? "" : money(r.amount)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {footnote && <p className="border-t border-line px-5 py-3 text-xs text-muted">{footnote}</p>}
      </Card>
    </div>
  );
}
