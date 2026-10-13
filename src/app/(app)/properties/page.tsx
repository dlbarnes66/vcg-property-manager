import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { inForceLeaseWhere } from "@/lib/queries";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { money, titleCase } from "@/lib/utils";

export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const properties = await db.property.findMany({
    orderBy: { name: "asc" },
    include: { units: { include: { leases: { where: inForceLeaseWhere(), select: { contractRent: true } } } } },
  });

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle={`${properties.length} properties · ${properties.reduce((s, p) => s + p.units.length, 0)} units`}
        actions={
          <LinkButton href="/properties/new">
            <Plus size={16} /> Add property
          </LinkButton>
        }
      />
      {properties.length === 0 ? (
        <Card>
          <Empty action={<LinkButton href="/properties/new">Add your first property</LinkButton>}>No properties yet.</Empty>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {properties.map((p) => {
            const occupied = p.units.filter((u) => u.leases.length > 0).length;
            const rent = p.units.reduce((s, u) => s + u.leases.reduce((a, l) => a + l.contractRent, 0), 0);
            const pct = p.units.length ? Math.round((occupied / p.units.length) * 100) : 0;
            return (
              <Link key={p.id} href={`/properties/${p.id}`}>
                <Card className="h-full p-5 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {p.street}, {p.city}, {p.state}
                      </div>
                    </div>
                    <Badge tone="navy">{titleCase(p.type)}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted">Units</div>
                      <div className="tabular font-medium">{p.units.length}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Occupied</div>
                      <div className="tabular font-medium">{pct}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Rent / mo</div>
                      <div className="tabular font-medium">{money(rent)}</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper">
                    <div className="h-full rounded-full bg-navy" style={{ width: `${pct}%` }} />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
