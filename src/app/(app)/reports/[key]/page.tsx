import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { PropertySelect } from "@/components/account-select";
import { ReportView } from "@/components/report-view";
import { Button, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { PRESETS, paramsQuery, type SearchParams } from "@/lib/report-kit";
import { resolveReport } from "@/lib/report-run";
import { cn, dateToInput } from "@/lib/utils";

type Props = { params: Promise<{ key: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props) {
  const r = await resolveReport((await params).key, {});
  return { title: r?.def.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: Props) {
  const [{ key }, sp] = await Promise.all([params, searchParams]);
  const resolved = await resolveReport(key, sp);
  if (!resolved) notFound();
  const { def, params: p } = resolved;
  const data = await def.build(p);
  const extra: Record<string, string> = p.memo ? { memo: p.memo } : {};
  const qs = paramsQuery(p, extra);
  const presetHref = (preset: string) => `/reports/${key}?${new URLSearchParams({ preset, ...(p.propertyId ? { propertyId: p.propertyId } : {}), ...extra } as Record<string, string>)}`;
  const btn = "inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-paper";

  return (
    <>
      <PageHeader
        back={{ href: "/reports", label: "Reports" }}
        title={def.title}
        subtitle={<>{data.period}<span className="block text-xs">{def.description}</span></>}
        actions={
          <>
            <a href={`/api/reports/${key}?${qs}&format=pdf`} className={btn}><FileText size={14} /> PDF</a>
            <a href={`/api/reports/${key}?${qs}`} className={btn}><Download size={14} /> CSV</a>
          </>
        }
      />
      <form className="mb-6 flex flex-col gap-3 rounded-lg border border-line bg-white p-4">
        {def.mode === "range" && (
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((x) => (
              <Link key={x.key} href={presetHref(x.key)} className={cn("rounded-md px-2.5 py-1 text-xs", sp.preset === x.key ? "bg-navy text-white" : "text-muted hover:bg-paper")}>{x.label}</Link>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          {def.mode === "range" && <Field label="From"><Input type="date" name="from" defaultValue={dateToInput(p.from)} /></Field>}
          <Field label={def.mode === "range" ? "To" : "As of"}><Input type="date" name="to" defaultValue={dateToInput(p.to)} /></Field>
          <Field label="Property"><PropertySelect defaultValue={p.propertyId} blank="All properties" /></Field>
          <Button type="submit" variant="secondary">Run</Button>
        </div>
        {def.key === "investor-summary" && (
          <Field label="Note to investors (optional, printed at the top of the PDF)">
            <Textarea name="memo" rows={3} maxLength={2000} defaultValue={p.memo ?? ""} placeholder="e.g. Q3 highlights: Dauphin St Side B leased to a HUD-VASH veteran; roof work at Oak Ridge completed under budget." />
          </Field>
        )}
      </form>
      <ReportView data={data} />
    </>
  );
}
