import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { EditPopover } from "@/components/edit-popover";
import { inForceLeaseWhere, tenantName } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { NotesPanel } from "@/components/notes-panel";
import { TasksPanel } from "@/components/tasks-panel";
import {
  Badge, Card, CardBody, CardHeader, DetailList, Empty, Field, Input, LinkButton, PageHeader, Table, Td, Th, Textarea,
} from "@/components/ui";
import { centsToInput, fmtDate, money, titleCase } from "@/lib/utils";
import { createUnit, deleteUnit, updateUnit } from "../actions";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = await db.property.findUnique({
    where: { id },
    include: {
      units: {
        orderBy: { label: "asc" },
        include: {
          leases: { where: inForceLeaseWhere(), include: { tenant: true } },
          maintenance: { where: { status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } }, select: { id: true } },
        },
      },
    },
  });
  if (!property) notFound();

  const occupied = property.units.filter((u) => u.leases.length).length;
  const scheduledRent = property.units.reduce((s, u) => s + (u.leases[0]?.contractRent ?? 0), 0);
  const marketRent = property.units.reduce((s, u) => s + (u.marketRent ?? 0), 0);

  return (
    <>
      <PageHeader
        title={property.name}
        subtitle={`${property.street}, ${property.city}, ${property.state} ${property.zip}`}
        back={{ href: "/properties", label: "Properties" }}
        actions={
          <LinkButton href={`/properties/${id}/edit`} variant="secondary">
            <Pencil size={14} /> Edit
          </LinkButton>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Units" subtitle={`${occupied} of ${property.units.length} occupied`} />
          {property.units.length === 0 ? (
            <Empty>No units yet. Add one below.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Unit</Th>
                  <Th>Beds/Baths</Th>
                  <Th>Tenant</Th>
                  <Th className="text-right">Rent</Th>
                  <Th className="text-right">Market</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {property.units.map((u) => {
                  const lease = u.leases[0];
                  return (
                    <tr key={u.id}>
                      <Td className="font-medium">
                        {u.label}
                        {u.maintenance.length > 0 && (
                          <span className="ml-2">
                            <Badge tone="amber">{u.maintenance.length} open WO</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="tabular text-muted">
                        {u.bedrooms} / {u.bathrooms}
                      </Td>
                      <Td>
                        {lease ? (
                          <Link href={`/leases/${lease.id}`} className="hover:underline">
                            {tenantName(lease.tenant)}
                          </Link>
                        ) : (
                          <Badge tone="red">Vacant</Badge>
                        )}
                      </Td>
                      <Td className="tabular text-right">{lease ? money(lease.contractRent) : "—"}</Td>
                      <Td className="tabular text-right text-muted">{money(u.marketRent)}</Td>
                      <Td className="text-right">
                        <EditPopover label="Edit" title={`Edit ${u.label}`}>
                            <ActionForm action={updateUnit.bind(null, u.id)} submitLabel="Save unit">
                              <UnitFields unit={u} />
                            </ActionForm>
                            {!lease && (
                              <div className="mt-3 border-t border-line pt-3">
                                <ActionForm action={deleteUnit.bind(null, u.id)} submitLabel="Delete unit" submitVariant="danger" confirm={`Delete ${u.label}?`} />
                              </div>
                            )}
                            {!lease && (
                              <LinkButton href={`/leases/new?unitId=${u.id}`} variant="secondary" size="sm" className="mt-3 w-full">
                                Create lease for this unit
                              </LinkButton>
                            )}
                          </EditPopover>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <div className="border-t border-line p-5">
            <div className="mb-3 text-sm font-semibold">Add unit</div>
            <ActionForm action={createUnit.bind(null, id)} submitLabel="Add unit" resetOnSuccess>
              <UnitFields />
            </ActionForm>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  ["Type", titleCase(property.type)],
                  ["Units", property.units.length],
                  ["Scheduled rent / mo", money(scheduledRent)],
                  ["Market rent / mo", money(marketRent)],
                  ["Purchase price", money(property.purchasePrice)],
                  ["Purchase date", fmtDate(property.purchaseDate)],
                ]}
              />
              {property.notes && <p className="mt-4 text-sm whitespace-pre-wrap text-muted">{property.notes}</p>}
            </CardBody>
          </Card>
          <TasksPanel link={{ propertyId: id }} />
          <NotesPanel link={{ propertyId: id }} />
          <DocumentsPanel link={{ propertyId: id }} />
        </div>
      </div>
    </>
  );
}

function UnitFields({ unit }: { unit?: { label: string; bedrooms: number; bathrooms: number; sqft: number | null; marketRent: number | null; notes: string | null } }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Label *" className="col-span-2">
        <Input name="label" defaultValue={unit?.label} placeholder="Unit 2B" required />
      </Field>
      <Field label="Bedrooms">
        <Input name="bedrooms" type="number" min={0} defaultValue={unit?.bedrooms ?? 1} />
      </Field>
      <Field label="Bathrooms">
        <Input name="bathrooms" type="number" min={0} step={0.5} defaultValue={unit?.bathrooms ?? 1} />
      </Field>
      <Field label="Sq ft">
        <Input name="sqft" type="number" min={0} defaultValue={unit?.sqft ?? ""} />
      </Field>
      <Field label="Market rent">
        <Input name="marketRent" inputMode="decimal" defaultValue={centsToInput(unit?.marketRent)} placeholder="0.00" />
      </Field>
      <Field label="Notes" className="col-span-2">
        <Textarea name="notes" rows={2} defaultValue={unit?.notes ?? ""} />
      </Field>
    </div>
  );
}
