import Link from "next/link";
import { Download } from "lucide-react";
import { cashFlow, delinquency, rentRoll } from "@/lib/reports";
import { Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { cn, fmtDate, money, periodLabel } from "@/lib/utils";

export const metadata = { title: "Reports" };

const TABS = [
  { key: "rent-roll", label: "Rent roll" },
  { key: "delinquency", label: "Delinquency" },
  { key: "cash-flow", label: "Cash flow" },
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await searchParams;
  const tab = TABS.find((t) => t.key === r)?.key ?? "rent-roll";

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <a href={`/api/reports/${tab}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-paper">
            <Download size={14} /> Export CSV
          </a>
        }
      />
      <div className="mb-4 flex gap-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/reports?r=${t.key}`} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-navy text-white" : "text-muted hover:bg-white")}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "rent-roll" && <RentRoll />}
      {tab === "delinquency" && <Delinquency />}
      {tab === "cash-flow" && <CashFlow />}
    </>
  );
}

async function RentRoll() {
  const rows = await rentRoll();
  const occupied = rows.filter((r) => r.status === "Occupied");
  const total = (k: "contractRent" | "tenantPortion" | "hapAmount" | "balance") => rows.reduce((s, r) => s + r[k], 0);
  const market = rows.reduce((s, r) => s + (r.marketRent ?? 0), 0);
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occupancy" value={rows.length ? `${Math.round((occupied.length / rows.length) * 100)}%` : "—"} sub={`${occupied.length} of ${rows.length} units`} />
        <Stat label="Scheduled rent / mo" value={money(total("contractRent"))} sub={market ? `${money(market)} market` : undefined} />
        <Stat label="Tenant portion / mo" value={money(total("tenantPortion"))} />
        <Stat label="HAP / mo" value={money(total("hapAmount"))} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>No units yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th><Th>Bd/Ba</Th><Th>Tenant</Th><Th>Lease</Th>
                <Th className="text-right">Market</Th><Th className="text-right">Contract</Th><Th className="text-right">Tenant</Th><Th className="text-right">HAP</Th><Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.property}-${r.unit}`}>
                  <Td className="whitespace-nowrap font-medium">{r.property} · {r.unit}</Td>
                  <Td className="tabular text-muted">{r.beds}/{r.baths}</Td>
                  <Td>{r.leaseId ? <Link href={`/leases/${r.leaseId}`} className="hover:underline">{r.tenant}</Link> : <Badge tone="red">Vacant</Badge>}</Td>
                  <Td className="whitespace-nowrap text-muted">{r.leaseStart ? `${fmtDate(r.leaseStart)} – ${r.leaseEnd ? fmtDate(r.leaseEnd) : "MTM"}` : "—"}</Td>
                  <Td className="tabular text-right text-muted">{money(r.marketRent)}</Td>
                  <Td className="tabular text-right">{r.leaseId ? money(r.contractRent) : "—"}</Td>
                  <Td className="tabular text-right">{r.leaseId ? money(r.tenantPortion) : "—"}</Td>
                  <Td className="tabular text-right">{r.leaseId ? money(r.hapAmount) : "—"}</Td>
                  <Td className={cn("tabular text-right", r.balance > 0 && "text-red-700")}>{r.leaseId ? money(r.balance) : "—"}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td colSpan={4}>Total</Td>
                <Td className="tabular text-right">{money(market)}</Td>
                <Td className="tabular text-right">{money(total("contractRent"))}</Td>
                <Td className="tabular text-right">{money(total("tenantPortion"))}</Td>
                <Td className="tabular text-right">{money(total("hapAmount"))}</Td>
                <Td className="tabular text-right">{money(total("balance"))}</Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function Delinquency() {
  const rows = await delinquency();
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const tenantTotal = sum((r) => (r.party === "Tenant" ? r.pastDue : 0));
  const hapTotal = sum((r) => (r.party === "Housing authority" ? r.pastDue : 0));
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total past due" value={money(tenantTotal + hapTotal)} tone={tenantTotal + hapTotal > 0 ? "bad" : "good"} />
        <Stat label="Owed by tenants" value={money(tenantTotal)} />
        <Stat label="Owed by housing authorities" value={money(hapTotal)} sub="Often a failed inspection or missing paperwork" />
        <Stat label="Over 60 days" value={money(sum((r) => r.aging.d90 + r.aging.over90))} tone={sum((r) => r.aging.d90 + r.aging.over90) > 0 ? "bad" : "default"} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>Nobody is past due. 🎉</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th><Th>Owed by</Th><Th>Contact</Th>
                <Th className="text-right">0–30</Th><Th className="text-right">31–60</Th><Th className="text-right">61–90</Th><Th className="text-right">90+</Th><Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.leaseId}-${r.party}`}>
                  <Td>
                    <Link href={`/leases/${r.leaseId}`} className="font-medium hover:underline">{r.property} · {r.unit}</Link>
                    <div className="text-xs text-muted">{r.tenant}{r.leaseStatus === "ENDED" && " · former tenant"}</div>
                  </Td>
                  <Td><Badge tone={r.party === "Tenant" ? "gray" : "blue"}>{r.party === "Tenant" ? "Tenant" : r.payer}</Badge></Td>
                  <Td className="text-muted">{r.phone ?? "—"}</Td>
                  <Td className="tabular text-right">{money(r.aging.current + r.aging.d30)}</Td>
                  <Td className="tabular text-right">{money(r.aging.d60)}</Td>
                  <Td className="tabular text-right">{money(r.aging.d90)}</Td>
                  <Td className="tabular text-right">{money(r.aging.over90)}</Td>
                  <Td className="tabular text-right font-semibold text-red-700">{money(r.pastDue)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

async function CashFlow() {
  const rows = await cashFlow(12);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.tenant + r.hap, r.maintenance)));
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Month</Th><Th className="w-1/3">Collections vs. maintenance</Th>
            <Th className="text-right">Tenant</Th><Th className="text-right">HAP</Th><Th className="text-right">Maintenance</Th><Th className="text-right">Net</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <Td className="whitespace-nowrap">{periodLabel(r.period)}</Td>
              <Td>
                <div className="flex flex-col gap-1">
                  <div className="flex h-2 overflow-hidden rounded-sm bg-paper">
                    <div className="bg-navy" style={{ width: `${(r.tenant / max) * 100}%` }} title="Tenant" />
                    <div className="bg-blue-400" style={{ width: `${(r.hap / max) * 100}%` }} title="HAP" />
                  </div>
                  <div className="h-2 rounded-sm bg-gold/80" style={{ width: `${(r.maintenance / max) * 100}%` }} title="Maintenance" />
                </div>
              </Td>
              <Td className="tabular text-right">{money(r.tenant)}</Td>
              <Td className="tabular text-right">{money(r.hap)}</Td>
              <Td className="tabular text-right">{money(r.maintenance)}</Td>
              <Td className={cn("tabular text-right font-medium", r.net < 0 && "text-red-700")}>{money(r.net)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex gap-4 px-5 py-3 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-navy" /> Tenant</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-blue-400" /> HAP</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gold/80" /> Maintenance</span>
        <span className="ml-auto">Cash basis: payments by date received, maintenance by completion date. Not a substitute for fund accounting.</span>
      </div>
    </Card>
  );
}
