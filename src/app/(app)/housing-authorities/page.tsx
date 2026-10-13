import type { HousingAuthority } from "@prisma/client";
import { db } from "@/lib/db";
import { EditPopover } from "@/components/edit-popover";
import { computeLeaseLedger } from "@/lib/ledger";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Table, Td, Th, Textarea } from "@/components/ui";
import { money } from "@/lib/utils";
import { createHousingAuthority, deleteHousingAuthority, updateHousingAuthority } from "./actions";

export const metadata = { title: "Housing authorities" };

export default async function HousingAuthoritiesPage() {
  const has = await db.housingAuthority.findMany({
    orderBy: { name: "asc" },
    include: { leases: { where: { status: "ACTIVE" }, include: { charges: true, payments: true } } },
  });

  return (
    <>
      <PageHeader title="Housing authorities" subtitle="PHAs that pay the HAP portion of HUD-VASH rents" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {has.length === 0 ? (
            <Empty>None yet. Add the PHA that administers your HUD-VASH vouchers.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Contact</Th>
                  <Th className="text-right">Active leases</Th>
                  <Th className="text-right">HAP / mo</Th>
                  <Th className="text-right">HAP past due</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {has.map((h) => {
                  const monthly = h.leases.reduce((s, l) => s + l.hapAmount, 0);
                  const pastDue = h.leases.reduce((s, l) => s + computeLeaseLedger(l.charges, l.payments).authority.pastDue, 0);
                  return (
                    <tr key={h.id}>
                      <Td className="font-medium">
                        {h.portalUrl ? (
                          <a href={h.portalUrl} target="_blank" rel="noreferrer" className="hover:underline">
                            {h.name}
                          </a>
                        ) : (
                          h.name
                        )}
                      </Td>
                      <Td className="text-muted">
                        {[h.contactName, h.phone, h.email].filter(Boolean).join(" · ") || "—"}
                      </Td>
                      <Td className="tabular text-right">{h.leases.length}</Td>
                      <Td className="tabular text-right">{money(monthly)}</Td>
                      <Td className={`tabular text-right ${pastDue > 0 ? "font-medium text-red-700" : ""}`}>{money(pastDue)}</Td>
                      <Td className="text-right">
                        <EditPopover label="Edit" title={`Edit ${h.name}`}>
                            <ActionForm action={updateHousingAuthority.bind(null, h.id)} submitLabel="Save">
                              <HaFields ha={h} />
                            </ActionForm>
                            <div className="mt-3 border-t border-line pt-3">
                              <ActionForm action={deleteHousingAuthority.bind(null, h.id)} submitLabel="Delete" submitVariant="danger" confirm={`Delete ${h.name}?`} />
                            </div>
                          </EditPopover>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Add housing authority" />
          <CardBody>
            <ActionForm action={createHousingAuthority} submitLabel="Add" resetOnSuccess>
              <HaFields />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function HaFields({ ha }: { ha?: HousingAuthority }) {
  return (
    <FormGrid className="sm:grid-cols-1">
      <Field label="Name *">
        <Input name="name" defaultValue={ha?.name} placeholder="Mobile Housing Authority" required />
      </Field>
      <Field label="Contact name">
        <Input name="contactName" defaultValue={ha?.contactName ?? ""} />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={ha?.phone ?? ""} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" defaultValue={ha?.email ?? ""} />
      </Field>
      <Field label="Landlord portal URL">
        <Input name="portalUrl" defaultValue={ha?.portalUrl ?? ""} placeholder="https://" />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={ha?.notes ?? ""} />
      </Field>
    </FormGrid>
  );
}
