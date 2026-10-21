import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink, ScrollText } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { FEDERAL_RULES, LAST_REVIEWED, SOI_LABEL, stateLaw, statutesUrl } from "@/lib/state-law";
import { STATES, stateName } from "@/lib/states";
import { fmtDate, toDate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  return { title: `${stateName((await params).code.toUpperCase())} landlord-tenant law` };
}

function Topic({ title, rows, cite }: { title: string; rows: [string, string][]; cite: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="flex flex-col gap-3">
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-1 gap-0.5 sm:grid-cols-3">
              <dt className="text-muted">{k}</dt>
              <dd className="sm:col-span-2">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line pt-2 text-xs text-muted">Source: {cite}</p>
      </CardBody>
    </Card>
  );
}

export default async function StatePage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const s = stateLaw(code);
  if (!s) notFound();
  const name = stateName(code);

  return (
    <>
      <PageHeader
        back={{ href: "/resources/states", label: "All states" }}
        title={`${name} landlord-tenant quick reference`}
        subtitle={`Statewide rules · reviewed ${fmtDate(toDate(LAST_REVIEWED))}`}
        actions={
          <>
            <form action="/resources/states/go"><FilterSelect name="code" defaultValue={code} aria-label="Switch state">{STATES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</FilterSelect></form>
            <Link href={`/forms/new?state=${code}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-navy px-4 text-sm font-medium text-white hover:bg-navy-600"><ScrollText size={14} /> New {name} form</Link>
          </>
        }
      />
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>A research summary, not legal advice. Cities and counties in {name} may add stricter rules, and laws change. Check the cited statute{" "}
          <a href={statutesUrl(name)} target="_blank" rel="noreferrer" className="font-medium underline">({name} code on Justia)</a> or ask a local attorney before acting, especially before any eviction step.</span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Topic title="Security deposit" rows={[["Maximum", s.deposit.max], ["Return within", s.deposit.returnBy]]} cite={s.deposit.cite} />
        <Topic title="Late fees" rows={[["Limit", s.lateFee.rule], ["Grace period", s.lateFee.grace]]} cite={s.lateFee.cite} />
        <Topic title="Unpaid rent: notice before filing" rows={[["Notice", s.nonpayment.text], ["Voucher tenants", "Demand only the tenant portion, and send the housing authority a copy. Federal 30-day notice rules may apply (see below)."]]} cite={s.nonpayment.cite} />
        <Topic title="Ending a month-to-month tenancy" rows={[["Landlord must give", s.monthToMonth.landlord], ["Tenant must give", s.monthToMonth.tenant]]} cite={s.monthToMonth.cite} />
        <Topic title="Landlord entry" rows={[["Notice to enter", s.entry.text], ["Emergencies", "Generally allowed without notice"]]} cite={s.entry.cite} />
        <Card>
          <CardHeader title="Voucher holders (source of income)" />
          <CardBody className="flex flex-col gap-3 text-sm">
            <div><Badge tone={s.soi.status === "yes" ? "green" : s.soi.status === "limited" ? "amber" : "gray"}>{SOI_LABEL[s.soi.status]}</Badge></div>
            <p>{s.soi.text}</p>
            <p className="text-xs text-muted">Either way, the federal Fair Housing Act applies to every applicant, and a city or county may protect voucher holders even where the state doesn&apos;t.</p>
            {s.soi.cite && <p className="border-t border-line pt-2 text-xs text-muted">Source: {s.soi.cite}</p>}
          </CardBody>
        </Card>
      </div>

      {s.notes && s.notes.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={`Also good to know in ${name}`} />
          <CardBody><ul className="list-disc space-y-1 pl-5 text-sm">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul></CardBody>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title="Federal rules (apply in every state)" />
        <CardBody>
          <ul className="flex flex-col gap-3 text-sm">
            {FEDERAL_RULES.map((r) => (
              <li key={r.title}>
                <b>{r.title}.</b> <span className="text-muted">{r.text}</span>
                {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-navy hover:underline">Source <ExternalLink size={10} /></a>}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
