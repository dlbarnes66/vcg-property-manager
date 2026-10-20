import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Building2, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { GROUPS, REPORTS, reportByKey, type ReportGroup } from "@/lib/report-defs";

export const metadata = { title: "Reports" };

const ICONS: Record<ReportGroup, LucideIcon> = { "HUD-VASH": ShieldCheck, Investors: Building2, "Rent & collections": BarChart3, "Maintenance & operations": Wrench };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await searchParams;
  if (r && reportByKey(r)) redirect(`/reports/${r}`); // old links (/reports?r=delinquency)

  return (
    <>
      <PageHeader title="Reports" subtitle="Every report can be filtered by dates and property, and downloaded as a PDF or a CSV for Excel." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => {
          const Icon = ICONS[g];
          return (
            <Card key={g} className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-semibold"><Icon size={16} className="text-gold" /> {g}</h2>
              <ul className="flex flex-col divide-y divide-line">
                {REPORTS.filter((x) => x.group === g).map((x) => (
                  <li key={x.key}>
                    <Link href={`/reports/${x.key}`} className="group block py-3">
                      <div className="text-sm font-medium group-hover:underline">{x.title}</div>
                      <div className="mt-0.5 text-xs text-muted">{x.description}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}
