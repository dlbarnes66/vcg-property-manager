import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { computeLeaseLedger } from "@/lib/ledger";
import { tenantName } from "@/lib/queries";
import { DocumentsPanel } from "@/components/documents-panel";
import { Badge, Card, CardBody, CardHeader, DetailList, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { fmtDate, money, titleCase } from "@/lib/utils";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await db.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        orderBy: { startDate: "desc" },
        include: { unit: { include: { property: true } }, charges: true, payments: true, housingAuthority: true },
      },
    },
  });
  if (!tenant) notFound();

  return (
    <>
      <PageHeader
        title={tenantName(tenant)}
        subtitle={tenant.isVeteran ? <Badge tone="navy">Veteran</Badge> : undefined}
        back={{ href: "/tenants", label: "Tenants" }}
        actions={
          <>
            <LinkButton href={`/tenants/${id}/edit`} variant="secondary">
              <Pencil size={14} /> Edit
            </LinkButton>
            <LinkButton href={`/leases/new?tenantId=${id}`}>
              <Plus size={16} /> New lease
            </LinkButton>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Leases" />
            {tenant.leases.length === 0 ? (
              <Empty>No leases yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Unit</Th>
                    <Th>Term</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Tenant balance</Th>
                    <Th className="text-right">HAP balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {tenant.leases.map((l) => {
                    const { tenant: t, authority: a } = computeLeaseLedger(l.charges, l.payments);
                    return (
                      <tr key={l.id}>
                        <Td>
                          <Link href={`/leases/${l.id}`} className="font-medium hover:underline">
                            {l.unit.property.name} · {l.unit.label}
                          </Link>
                        </Td>
                        <Td className="text-muted">
                          {fmtDate(l.startDate)} – {l.endDate ? fmtDate(l.endDate) : "open"}
                        </Td>
                        <Td>
                          <Badge tone={l.status === "ACTIVE" ? "green" : "gray"}>{titleCase(l.status)}</Badge>
                        </Td>
                        <Td className={`tabular text-right ${t.pastDue > 0 ? "text-red-700" : ""}`}>{money(t.balance)}</Td>
                        <Td className={`tabular text-right ${a.pastDue > 0 ? "text-red-700" : ""}`}>{money(a.balance)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <DocumentsPanel link={{ tenantId: id }} defaultCategory="ID" />
        </div>
        <Card>
          <CardHeader title="Contact" />
          <CardBody className="flex flex-col gap-5">
            <DetailList items={[["Email", tenant.email], ["Phone", tenant.phone]]} />
            <div>
              <div className="mb-2 text-xs font-semibold text-muted">CASE MANAGER</div>
              <DetailList items={[["Name", tenant.caseManagerName], ["Phone", tenant.caseManagerPhone], ["Email", tenant.caseManagerEmail]]} />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-muted">EMERGENCY CONTACT</div>
              <DetailList items={[["Name", tenant.emergencyContactName], ["Phone", tenant.emergencyContactPhone]]} />
            </div>
            {tenant.notes && <p className="text-sm whitespace-pre-wrap text-muted">{tenant.notes}</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
