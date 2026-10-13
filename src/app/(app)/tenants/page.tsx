import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { inForceLeaseWhere, tenantName } from "@/lib/queries";
import { Badge, Card, Empty, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata = { title: "Tenants" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = q?.trim();
  const tenants = await db.tenant.findMany({
    where: term
      ? {
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { phone: { contains: term } },
          ],
        }
      : undefined,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { leases: { where: inForceLeaseWhere(), include: { unit: { include: { property: true } } } } },
  });

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle={`${tenants.length} ${term ? "matching" : "total"}`}
        actions={
          <LinkButton href="/tenants/new">
            <Plus size={16} /> Add tenant
          </LinkButton>
        }
      />
      <form className="mb-4 max-w-sm">
        <Input name="q" defaultValue={term} placeholder="Search name, email, phone…" />
      </form>
      <Card>
        {tenants.length === 0 ? (
          <Empty action={!term && <LinkButton href="/tenants/new">Add a tenant</LinkButton>}>{term ? "No matches." : "No tenants yet."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>Current unit</Th>
                <Th>Voucher</Th>
                <Th className="text-right">Tenant pays</Th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const l = t.leases[0];
                return (
                  <tr key={t.id} className="hover:bg-paper/50">
                    <Td>
                      <Link href={`/tenants/${t.id}`} className="font-medium hover:underline">
                        {tenantName(t)}
                      </Link>
                      {t.isVeteran && (
                        <span className="ml-2">
                          <Badge tone="navy">Veteran</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted">{t.phone ?? t.email ?? "—"}</Td>
                    <Td>{l ? `${l.unit.property.name} · ${l.unit.label}` : <span className="text-muted">No active lease</span>}</Td>
                    <Td>{l?.hapAmount ? <Badge tone="blue">HUD-VASH</Badge> : <span className="text-muted">—</span>}</Td>
                    <Td className="tabular text-right">{l ? money(l.tenantPortion) : "—"}</Td>
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
