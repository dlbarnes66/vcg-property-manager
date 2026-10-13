import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { UnitSelect } from "@/components/unit-select";
import { Card, CardBody, Field, FormGrid, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MAINT_PRIORITIES } from "@/lib/enums";
import { dateToInput, todayUTC } from "@/lib/utils";
import { createWorkOrder } from "../actions";

export const metadata = { title: "New work order" };

export default async function NewWorkOrderPage({ searchParams }: { searchParams: Promise<{ unitId?: string }> }) {
  const { unitId } = await searchParams;
  const vendors = await db.vendor.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="New work order" back={{ href: "/maintenance", label: "Maintenance" }} />
      <Card>
        <CardBody>
          <ActionForm action={createWorkOrder} submitLabel="Create work order">
            <FormGrid>
              <Field label="Unit *">
                <UnitSelect defaultValue={unitId} />
              </Field>
              <Field label="Priority">
                <EnumSelect name="priority" values={MAINT_PRIORITIES} defaultValue="NORMAL" />
              </Field>
              <Field label="Title *" className="sm:col-span-2">
                <Input name="title" placeholder="Kitchen sink leaking" required />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea name="description" rows={4} />
              </Field>
              <Field label="Vendor">
                <Select name="vendorId" defaultValue="">
                  <option value="">Unassigned</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.trade ? ` (${v.trade})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Reported">
                  <Input name="reportedOn" type="date" defaultValue={dateToInput(todayUTC())} />
                </Field>
                <Field label="Scheduled">
                  <Input name="scheduledOn" type="date" />
                </Field>
              </div>
            </FormGrid>
          </ActionForm>
          <p className="mt-4 text-xs text-muted">Add photos on the next screen.</p>
        </CardBody>
      </Card>
    </>
  );
}
