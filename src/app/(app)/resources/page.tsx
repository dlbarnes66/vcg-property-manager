import Link from "next/link";
import { BookOpen, ExternalLink, Landmark, Scale } from "lucide-react";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { FEDERAL_RULES, LAST_REVIEWED, SOURCES } from "@/lib/state-law";
import { STATES, toStateCode } from "@/lib/states";
import { fmtDate, toDate } from "@/lib/utils";

export const metadata = { title: "Resources" };

const LINKS: { title: string; url: string; note: string }[] = [
  { title: "HUD-VASH program (HUD)", url: "https://www.hud.gov/program_offices/public_indian_housing/programs/hcv/vash", note: "How the program works, PHA contacts" },
  { title: "VA Homeless Programs: HUD-VASH", url: "https://www.va.gov/homeless/hud-vash.asp", note: "VA case management side" },
  { title: "Housing Choice Voucher landlord guidebook (HUD)", url: "https://www.hud.gov/program_offices/public_indian_housing/programs/hcv/landlord", note: "Inspections, HAP contracts, rent increases" },
  { title: "NSPIRE inspection standards (HUD)", url: "https://www.hud.gov/program_offices/public_indian_housing/reac/nspire", note: "What inspectors check" },
  { title: "Find your state's laws (Justia)", url: "https://law.justia.com/codes/", note: "Free state statutes, to check a citation" },
];

export default async function ResourcesPage() {
  const props = await db.property.findMany({ select: { state: true } });
  const yours = [...new Set(props.map((p) => toStateCode(p.state)).filter((x): x is string => !!x))];
  return (
    <>
      <PageHeader title="Resources" subtitle="Quick references for running HUD-VASH and other rentals in any state." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="State Law Guide" subtitle={`Landlord-tenant rules for all 50 states + DC · reviewed ${fmtDate(toDate(LAST_REVIEWED))}`} />
          <CardBody className="flex flex-col gap-4">
            <p className="text-sm text-muted">Security deposits, late fees, rent-demand notices, ending a month-to-month tenancy, landlord entry, and whether voucher holders are protected, each with the statute to check.</p>
            {yours.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Your states:</span>
                {yours.map((c) => <Link key={c} href={`/resources/states/${c}`} className="rounded-md bg-navy px-3 py-1 font-medium text-white">{STATES.find((s) => s.code === c)?.name}</Link>)}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href="/resources/states" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium hover:bg-paper"><Scale size={14} /> Compare all states</Link>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 md:grid-cols-4">
              {STATES.map((s) => <Link key={s.code} href={`/resources/states/${s.code}`} className="text-navy hover:underline">{s.name}</Link>)}
            </div>
          </CardBody>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Helpful links" />
            <CardBody>
              <ul className="flex flex-col gap-3 text-sm">
                {LINKS.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-navy hover:underline">{l.title} <ExternalLink size={12} /></a>
                    <div className="text-xs text-muted">{l.note}</div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title="Federal rules that apply in every state" subtitle="Especially for voucher (HUD-VASH / Section 8) tenancies" />
        <CardBody className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {FEDERAL_RULES.map((r) => (
            <div key={r.title}>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Landmark size={14} className="text-gold" /> {r.title}</h3>
              <p className="mt-1 text-sm text-muted">{r.text}</p>
              {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline">Official source <ExternalLink size={11} /></a>}
            </div>
          ))}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Where the State Law Guide comes from" subtitle="Cross-checked across these sources; recent changes (2024–2026) were confirmed separately." />
        <CardBody>
          <ul className="flex flex-col gap-1.5 text-sm">
            {SOURCES.map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-navy hover:underline">{x.title} <ExternalLink size={11} /></a></li>)}
          </ul>
        </CardBody>
      </Card>
      <p className="mt-6 flex items-start gap-1.5 text-xs text-muted"><BookOpen size={13} className="mt-0.5 shrink-0" /> A research summary to help you know what to check, not legal advice. Laws change, and cities or counties can add stricter rules. Confirm the statute (or ask a local attorney) before acting.</p>
    </>
  );
}
