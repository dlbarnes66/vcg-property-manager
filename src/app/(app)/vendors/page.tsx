import type { Vendor } from "@prisma/client";
import { db } from "@/lib/db";
import { EditPopover } from "@/components/edit-popover";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Table, Td, Th, Textarea } from "@/components/ui";
import { money } from "@/lib/utils";
import { createVendor, deleteVendor, updateVendor } from "./actions";

export const metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const vendors = await db.vendor.findMany({
    orderBy: { name: "asc" },
    include: { requests: { select: { status: true, cost: true } } },
  });

  return (
    <>
      <PageHeader title="Vendors" subtitle="Contractors you assign work orders to" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {vendors.length === 0 ? (
            <Empty>No vendors yet.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Trade</Th>
                  <Th>Contact</Th>
                  <Th className="text-right">Open jobs</Th>
                  <Th className="text-right">Total spend</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {vendors.map((v) => (
                  <tr key={v.id}>
                    <Td className="font-medium">{v.name}</Td>
                    <Td className="text-muted">{v.trade ?? "—"}</Td>
                    <Td className="text-muted">{[v.phone, v.email].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td className="tabular text-right">
                      {v.requests.filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status)).length}
                    </Td>
                    <Td className="tabular text-right">{money(v.requests.reduce((s, r) => s + (r.cost ?? 0), 0))}</Td>
                    <Td className="text-right">
                      <EditPopover label="Edit" title={`Edit ${v.name}`}>
                          <ActionForm action={updateVendor.bind(null, v.id)} submitLabel="Save">
                            <VendorFields vendor={v} />
                          </ActionForm>
                          <div className="mt-3 border-t border-line pt-3">
                            <ActionForm action={deleteVendor.bind(null, v.id)} submitLabel="Delete" submitVariant="danger" confirm={`Delete ${v.name}?`} />
                          </div>
                        </EditPopover>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Add vendor" />
          <CardBody>
            <ActionForm action={createVendor} submitLabel="Add" resetOnSuccess>
              <VendorFields />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function VendorFields({ vendor }: { vendor?: Vendor }) {
  return (
    <FormGrid className="sm:grid-cols-1">
      <Field label="Name *">
        <Input name="name" defaultValue={vendor?.name} required />
      </Field>
      <Field label="Trade">
        <Input name="trade" defaultValue={vendor?.trade ?? ""} placeholder="Plumbing, HVAC…" />
      </Field>
      <Field label="Phone">
        <Input name="phone" defaultValue={vendor?.phone ?? ""} />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" defaultValue={vendor?.email ?? ""} />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={vendor?.notes ?? ""} />
      </Field>
    </FormGrid>
  );
}
