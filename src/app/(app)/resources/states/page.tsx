import Link from "next/link";
import { FilterSelect } from "@/components/filter-select";
import { Badge, Card, Field, PageHeader, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { LAST_REVIEWED, SOI_LABEL, STATE_LAWS, type StateLaw } from "@/lib/state-law";
import { STATES, stateName, toStateCode } from "@/lib/states";
import { cn, fmtDate, toDate } from "@/lib/utils";

export const metadata = { title: "Compare states" };

const TOPICS = {
  deposits: { label: "Security deposits", cols: [["Max deposit", (s: StateLaw) => s.deposit.max], ["Return within", (s: StateLaw) => s.deposit.returnBy]] },
  late: { label: "Late fees", cols: [["Limit", (s: StateLaw) => s.lateFee.rule], ["Grace period", (s: StateLaw) => s.lateFee.grace]] },
  nonpayment: { label: "Nonpayment notice", cols: [["Notice before filing for unpaid rent", (s: StateLaw) => s.nonpayment.text]] },
  mtm: { label: "Ending month-to-month", cols: [["Landlord's notice", (s: StateLaw) => s.monthToMonth.landlord], ["Tenant's notice", (s: StateLaw) => s.monthToMonth.tenant]] },
  entry: { label: "Landlord entry", cols: [["Notice to enter", (s: StateLaw) => s.entry.text]] },
  vouchers: { label: "Voucher holders", cols: [["Source-of-income protection", (s: StateLaw) => s.soi.text]] },
} as const;
type Topic = keyof typeof TOPICS;

export default async function CompareStates({ searchParams }: { searchParams: Promise<{ topic?: string; only?: string }> }) {
  const sp = await searchParams;
  const topic: Topic = sp.topic && sp.topic in TOPICS ? (sp.topic as Topic) : "deposits";
  const props = await db.property.findMany({ select: { state: true } });
  const yours = new Set(props.map((p) => toStateCode(p.state)).filter(Boolean));
  const rows = STATE_LAWS.filter((s) => sp.only !== "mine" || yours.has(s.code)).sort((a, b) => stateName(a.code).localeCompare(stateName(b.code)));
  const t = TOPICS[topic];
  const href = (o: { topic?: string; only?: string }) => `/resources/states?${new URLSearchParams({ topic, ...(sp.only ? { only: sp.only } : {}), ...o })}`;

  return (
    <>
      <PageHeader back={{ href: "/resources", label: "Resources" }} title="Compare states" subtitle={`Statewide rules, reviewed ${fmtDate(toDate(LAST_REVIEWED))}. Click a state for citations and details.`} />
      <Card className="mb-4 flex flex-wrap items-end gap-4 p-4">
        <form action="/resources/states/go" className="flex items-end gap-2">
          <Field label="Go to a state">
            <FilterSelect name="code" defaultValue="" className="min-w-52">
              <option value="" disabled>Pick a state…</option>
              {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </FilterSelect>
          </Field>
        </form>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(TOPICS) as Topic[]).map((k) => (
            <Link key={k} href={href({ topic: k })} className={cn("rounded-md px-3 py-1.5 text-sm", topic === k ? "bg-navy text-white" : "text-muted hover:bg-paper")}>{TOPICS[k].label}</Link>
          ))}
        </div>
        {yours.size > 0 && (
          <Link href={href({ only: sp.only === "mine" ? "" : "mine" })} className={cn("ml-auto rounded-md border px-3 py-1.5 text-sm", sp.only === "mine" ? "border-navy bg-navy/5 text-navy" : "border-line text-muted")}>
            {sp.only === "mine" ? "Showing your states" : "Only my states"}
          </Link>
        )}
      </Card>
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>State</Th>
              {t.cols.map(([label]) => <Th key={label}>{label}</Th>)}
              {topic === "vouchers" && <Th>Status</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.code} className={cn(yours.has(s.code) && "bg-gold/5")}>
                <Td className="font-medium whitespace-nowrap"><Link href={`/resources/states/${s.code}`} className="hover:underline">{stateName(s.code)}</Link>{yours.has(s.code) && <span className="ml-1.5"><Badge tone="navy">Yours</Badge></span>}</Td>
                {t.cols.map(([label, get]) => <Td key={label} className="min-w-48 text-sm">{get(s)}</Td>)}
                {topic === "vouchers" && <Td><Badge tone={s.soi.status === "yes" ? "green" : s.soi.status === "limited" ? "amber" : "gray"}>{SOI_LABEL[s.soi.status]}</Badge></Td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-4 text-xs text-muted">A research summary, not legal advice. Cities and counties can add stricter rules. Confirm the statute before acting.</p>
    </>
  );
}
