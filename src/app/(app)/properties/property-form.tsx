import type { Property } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { Field, FormGrid, Input, Textarea } from "@/components/ui";
import { PROPERTY_TYPES } from "@/lib/enums";
import type { ActionResult } from "@/lib/actions-util";
import { centsToInput, dateToInput } from "@/lib/utils";

export function PropertyForm({
  action,
  property,
  submitLabel,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  property?: Property;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormGrid>
        <Field label="Property name *">
          <Input name="name" defaultValue={property?.name} placeholder="Oak Street Apartments" required />
        </Field>
        <Field label="Type">
          <EnumSelect name="type" values={PROPERTY_TYPES} defaultValue={property?.type ?? "MULTIFAMILY"} />
        </Field>
        <Field label="Street *" className="sm:col-span-2">
          <Input name="street" defaultValue={property?.street} required />
        </Field>
        <Field label="City *">
          <Input name="city" defaultValue={property?.city} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="State *">
            <Input name="state" defaultValue={property?.state} maxLength={2} placeholder="AL" required />
          </Field>
          <Field label="ZIP *">
            <Input name="zip" defaultValue={property?.zip} required />
          </Field>
        </div>
        <Field label="Purchase price">
          <Input name="purchasePrice" inputMode="decimal" defaultValue={centsToInput(property?.purchasePrice)} placeholder="0.00" />
        </Field>
        <Field label="Purchase date">
          <Input name="purchaseDate" type="date" defaultValue={dateToInput(property?.purchaseDate)} />
        </Field>
        {!property && (
          <Field label="Number of units to create" hint="Optional. Creates Unit 1…N; you can rename them after.">
            <Input name="unitCount" type="number" min={0} max={500} placeholder="e.g. 12" />
          </Field>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={property?.notes ?? ""} />
        </Field>
      </FormGrid>
    </ActionForm>
  );
}
