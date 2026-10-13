import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { computeLeaseLedger } from "@/lib/ledger";
import { tenantName } from "@/lib/queries";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { cn, fmtDate, money, titleCase } from "@/lib/utils";

export const metadata = { title: "Leases" };

const tabs = [
  { key: "ACTIVE", label: "Active" },
  { key: "DRAFT", label: "Draft" },
  { key: "ENDED", label: "Ended" },
  { key: "ALL", label: "All" },
] as const;

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "ACTIVE" } = await searchParams;
  const filter = ["ACTIVE", "DRAFT", "ENDED"].includes(status) ? (status as "ACTIVE" | "DRAFT" | "ENDED") : undefined;

  const leases = await db.lease.findMany({
    where: filter ? { status: filter } : undefined,
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { label: "asc" } }],
    include: { tenant: true, unit: { include: { property: true } }, charges: true, payments: true, housingAuthority: true },
  });

  return (
    <>
      <PageHeader
        title="Leases"
        actions={
          <LinkButton href="/leases/new">
            <Plus size={16} /> New lease
          </LinkButton>
        }
      />
      <div className="mb-4 flex gap-1">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/leases?status=${t.key}`}
            className={cn("rounded-md px-3 py-1.5 text-sm", (filter ?? "ALL") === t.key ? "bg-navy text-white" : "text-muted hover:bg-white")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      <Card>
        {leases.length === 0 ? (
          <Empty>No leases here.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th>
                <Th>Tenant</Th>
                <Th>Term</Th>
                <Th className="text-right">Contract rent</Th>
                <Th className="text-right">Tenant / HAP</Th>
                <Th className="text-right">Past due</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {leases.map((l) => {
                const { tenant, authority } = computeLeaseLedger(l.charges, l.payments);
                const pastDue = tenant.pastDue + authority.pastDue;
                return (
                  <tr key={l.id} className="hover:bg-paper/50">
                    <Td>
                      <Link href={`/leases/${l.id}`} className="font-medium hover:underline">
                        {l.unit.property.name} · {l.unit.label}
                      </Link>
                    </Td>
                    <Td>{tenantName(l.tenant)}</Td>
                    <Td className="whitespace-nowrap text-muted">
                      {fmtDate(l.startDate)} – {l.endDate ? fmtDate(l.endDate) : "MTM"}
                    </Td>
                    <Td className="tabular text-right">{money(l.contractRent)}</Td>
                    <Td className="tabular text-right text-muted">
                      {money(l.tenantPortion)} / {money(l.hapAmount)}
                    </Td>
                    <Td className={cn("tabular text-right", pastDue > 0 && "font-medium text-red-700")}>{money(pastDue)}</Td>
                    <Td>
                      <Badge tone={l.status === "ACTIVE" ? "green" : l.status === "DRAFT" ? "amber" : "gray"}>{titleCase(l.status)}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
