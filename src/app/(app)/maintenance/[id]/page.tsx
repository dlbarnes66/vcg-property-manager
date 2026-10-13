import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { inForceLeaseWhere, tenantName } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { EnumSelect } from "@/components/enum-select";
import { maintTone, priorityTone } from "@/components/unit-select";
import { Badge, Card, CardBody, CardHeader, DetailList, Field, FormGrid, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MAINT_PRIORITIES, MAINT_STATUSES } from "@/lib/enums";
import { centsToInput, dateToInput, fmtDate, titleCase } from "@/lib/utils";
import { deleteWorkOrder, updateWorkOrder } from "../actions";

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [wo, vendors] = await Promise.all([
    db.maintenanceRequest.findUnique({
      where: { id },
      include: { vendor: true, unit: { include: { property: true, leases: { where: inForceLeaseWhere(), include: { tenant: true } } } } },
    }),
    db.vendor.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!wo) notFound();
  const resident = wo.unit.leases[0]?.tenant;

  return (
    <>
      <PageHeader
        title={wo.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/properties/${wo.unit.propertyId}`} className="hover:underline">
              {wo.unit.property.name} · {wo.unit.label}
            </Link>
            <Badge tone={maintTone(wo.status)}>{titleCase(wo.status)}</Badge>
            <Badge tone={priorityTone(wo.priority)}>{titleCase(wo.priority)}</Badge>
          </span>
        }
        back={{ href: "/maintenance", label: "Maintenance" }}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Update work order" />
          <CardBody>
            <ActionForm action={updateWorkOrder.bind(null, id)} submitLabel="Save">
              <FormGrid>
                <Field label="Title *" className="sm:col-span-2">
                  <Input name="title" defaultValue={wo.title} required />
                </Field>
                <Field label="Status">
                  <EnumSelect name="status" values={MAINT_STATUSES} defaultValue={wo.status} />
                </Field>
                <Field label="Priority">
                  <EnumSelect name="priority" values={MAINT_PRIORITIES} defaultValue={wo.priority} />
                </Field>
                <Field label="Vendor">
                  <Select name="vendorId" defaultValue={wo.vendorId ?? ""}>
                    <option value="">Unassigned</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Cost">
                  <Input name="cost" inputMode="decimal" defaultValue={centsToInput(wo.cost)} />
                </Field>
                <Field label="Scheduled">
                  <Input name="scheduledOn" type="date" defaultValue={dateToInput(wo.scheduledOn)} />
                </Field>
                <Field label="Completed" hint="Set automatically when marked Completed">
                  <Input name="completedOn" type="date" defaultValue={dateToInput(wo.completedOn)} />
                </Field>
                <Field label="Description / notes" className="sm:col-span-2">
                  <Textarea name="description" rows={5} defaultValue={wo.description ?? ""} />
                </Field>
              </FormGrid>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  ["Reported", fmtDate(wo.reportedOn)],
                  ["Resident", resident ? <Link key="r" href={`/tenants/${resident.id}`} className="hover:underline">{tenantName(resident)}</Link> : "Vacant"],
                  ["Resident phone", resident?.phone],
                  ["Vendor phone", wo.vendor?.phone],
                ]}
              />
            </CardBody>
          </Card>
          <DocumentsPanel link={{ maintenanceId: id }} defaultCategory="PHOTO" />
          <ActionForm action={deleteWorkOrder.bind(null, id)} submitLabel="Delete work order" submitVariant="danger" confirm="Delete this work order?" />
        </div>
      </div>
    </>
  );
}
