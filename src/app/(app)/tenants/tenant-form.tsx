import type { Tenant } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { Field, FormGrid, Input, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";

export function TenantForm({
  action,
  tenant,
  submitLabel,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  tenant?: Tenant;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormGrid>
        <Field label="First name *">
          <Input name="firstName" defaultValue={tenant?.firstName} required />
        </Field>
        <Field label="Last name *">
          <Input name="lastName" defaultValue={tenant?.lastName} required />
        </Field>
        <Field label="Email" hint={tenant?.portalEnabled ? "Changing this turns off portal access until you re-invite them." : "Needed to invite them to the resident portal."}>
          <Input name="email" type="email" defaultValue={tenant?.email ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="phone" type="tel" defaultValue={tenant?.phone ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="isVeteran" defaultChecked={tenant?.isVeteran ?? true} className="size-4 accent-navy" />
          Veteran
        </label>
      </FormGrid>

      <div className="text-sm font-semibold">VA / HUD-VASH case manager</div>
      <FormGrid className="sm:grid-cols-3">
        <Field label="Name">
          <Input name="caseManagerName" defaultValue={tenant?.caseManagerName ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="caseManagerPhone" type="tel" defaultValue={tenant?.caseManagerPhone ?? ""} />
        </Field>
        <Field label="Email">
          <Input name="caseManagerEmail" type="email" defaultValue={tenant?.caseManagerEmail ?? ""} />
        </Field>
      </FormGrid>

      <div className="text-sm font-semibold">Emergency contact</div>
      <FormGrid>
        <Field label="Name">
          <Input name="emergencyContactName" defaultValue={tenant?.emergencyContactName ?? ""} />
        </Field>
        <Field label="Phone">
          <Input name="emergencyContactPhone" type="tel" defaultValue={tenant?.emergencyContactPhone ?? ""} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={tenant?.notes ?? ""} />
        </Field>
      </FormGrid>
    </ActionForm>
  );
}
