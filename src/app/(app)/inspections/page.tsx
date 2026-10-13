import { db } from "@/lib/db";
import { EditPopover } from "@/components/edit-popover";
import { openFailures } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { UnitSelect } from "@/components/unit-select";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Table, Td, Th, Textarea } from "@/components/ui";
import { INSPECTION_RESULTS, INSPECTION_TYPES } from "@/lib/enums";
import { cn, dateToInput, daysBetween, fmtDate, titleCase, todayUTC } from "@/lib/utils";
import { createInspection, deleteInspection, recordInspection } from "./actions";

export const metadata = { title: "Inspections" };

const resultTone = (r: string) => ({ PENDING: "blue", PASS: "green", FAIL: "red", INCONCLUSIVE: "amber" })[r] as "blue" | "green" | "red" | "amber";
const typeLabels: Record<string, string> = {
  HQS_INITIAL: "HQS initial", HQS_ANNUAL: "HQS annual", NSPIRE: "NSPIRE-V", REINSPECTION: "Re-inspection",
  MOVE_IN: "Move-in", MOVE_OUT: "Move-out", INTERNAL: "Internal",
};

export default async function InspectionsPage() {
  const today = todayUTC();
  const all = await db.inspection.findMany({
    orderBy: { scheduledDate: "asc" },
    include: { unit: { include: { property: true } } },
  });
  const openFails = openFailures(all);
  const upcoming = all.filter((i) => i.result === "PENDING");
  const history = all.filter((i) => i.result !== "PENDING").reverse().slice(0, 50);

  const row = (i: (typeof all)[number], showCure = false) => {
    const d = daysBetween(today, i.scheduledDate);
    return (
      <tr key={i.id}>
        <Td className="font-medium">
          {i.unit.property.name} · {i.unit.label}
        </Td>
        <Td>{typeLabels[i.type] ?? titleCase(i.type)}</Td>
        <Td className={cn("whitespace-nowrap", i.result === "PENDING" && d < 0 && "text-red-700")}>
          {fmtDate(i.result === "PENDING" ? i.scheduledDate : (i.completedDate ?? i.scheduledDate))}
          {i.result === "PENDING" && <span className="ml-1 text-xs text-muted">({d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`})</span>}
        </Td>
        <Td>
          <Badge tone={resultTone(i.result)}>{titleCase(i.result)}</Badge>
        </Td>
        {showCure && (
          <Td className={cn("whitespace-nowrap", i.cureByDate && i.cureByDate < today && "font-medium text-red-700")}>{fmtDate(i.cureByDate)}</Td>
        )}
        <Td className="text-right">
          <EditPopover label={i.result === "PENDING" ? "Record result" : "Edit"} title={`${i.unit.property.name} · ${i.unit.label}`}>
              <ActionForm action={recordInspection.bind(null, i.id)} submitLabel="Save">
                <FormGrid>
                  <Field label="Result">
                    <EnumSelect name="result" values={INSPECTION_RESULTS} defaultValue={i.result === "PENDING" ? "PASS" : i.result} />
                  </Field>
                  <Field label="Date inspected">
                    <Input name="completedDate" type="date" defaultValue={dateToInput(i.completedDate ?? today)} />
                  </Field>
                  <Field label="Inspector">
                    <Input name="inspector" defaultValue={i.inspector ?? ""} />
                  </Field>
                  <Field label="Cure-by (if failed)" hint="Defaults to 30 days">
                    <Input name="cureByDate" type="date" defaultValue={dateToInput(i.cureByDate)} />
                  </Field>
                  <Field label="Deficiencies" className="sm:col-span-2">
                    <Textarea name="deficiencies" rows={3} defaultValue={i.deficiencies ?? ""} />
                  </Field>
                </FormGrid>
                <div className="flex flex-col gap-1.5 text-xs text-muted">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="scheduleReinspection" defaultChecked className="accent-navy" /> If failed: schedule re-inspection on cure-by date
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="createWorkOrder" defaultChecked className="accent-navy" /> If failed: create a work order for the deficiencies
                  </label>
                </div>
              </ActionForm>
              <div className="mt-3 border-t border-line pt-3">
                <ActionForm action={deleteInspection.bind(null, i.id)} submitLabel="Delete" submitVariant="danger" confirm="Delete this inspection?" />
              </div>
            </EditPopover>
        </Td>
      </tr>
    );
  };

  return (
    <>
      <PageHeader title="Inspections" subtitle="HQS / NSPIRE inspections drive HAP payments: a failed unit can have its HAP abated until it passes." />

      {openFails.length > 0 && (
        <Card className="mb-6 border-red-200">
          <CardHeader title={`Failed inspections needing cure (${openFails.length})`} />
          <Table>
            <thead>
              <tr>
                <Th>Unit</Th><Th>Type</Th><Th>Inspected</Th><Th>Result</Th><Th>Cure by</Th><Th />
              </tr>
            </thead>
            <tbody>{openFails.map((i) => row(i, true))}</tbody>
          </Table>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Upcoming" />
            {upcoming.length === 0 ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Unit</Th><Th>Type</Th><Th>Scheduled</Th><Th>Status</Th><Th />
                  </tr>
                </thead>
                <tbody>{upcoming.map((i) => row(i))}</tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="History" />
            {history.length === 0 ? (
              <Empty>No completed inspections yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Unit</Th><Th>Type</Th><Th>Inspected</Th><Th>Result</Th><Th />
                  </tr>
                </thead>
                <tbody>{history.map((i) => row(i))}</tbody>
              </Table>
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Schedule inspection" />
          <CardBody>
            <ActionForm action={createInspection} submitLabel="Schedule" resetOnSuccess>
              <Field label="Unit *">
                <UnitSelect />
              </Field>
              <Field label="Type *">
                <EnumSelect name="type" values={INSPECTION_TYPES} labels={typeLabels} defaultValue="HQS_ANNUAL" />
              </Field>
              <Field label="Date *">
                <Input name="scheduledDate" type="date" required />
              </Field>
              <Field label="Inspector">
                <Input name="inspector" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
