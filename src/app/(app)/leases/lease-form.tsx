import type { Lease } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { RentSplitFields } from "@/components/rent-split";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { LEASE_STATUSES } from "@/lib/enums";
import type { ActionResult } from "@/lib/actions-util";
import { centsToInput, dateToInput } from "@/lib/utils";

export async function LeaseForm({
  action,
  lease,
  submitLabel,
  preset,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  lease?: Lease;
  submitLabel: string;
  preset?: { unitId?: string; tenantId?: string; contractRent?: string; deposit?: string };
}) {
  const [properties, tenants, has] = await Promise.all([
    db.property.findMany({ orderBy: { name: "asc" }, include: { units: { orderBy: { label: "asc" } } } }),
    db.tenant.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    db.housingAuthority.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <FormGrid>
        <Field label="Unit *">
          <Select name="unitId" defaultValue={lease?.unitId ?? preset?.unitId ?? ""} required>
            <option value="">Select a unit…</option>
            {properties.map((p) => (
              <optgroup key={p.id} label={p.name}>
                {p.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {p.name} · {u.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Tenant (head of household) *">
          <Select name="tenantId" defaultValue={lease?.tenantId ?? preset?.tenantId ?? ""} required>
            <option value="">Select a tenant…</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.lastName}, {t.firstName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date *">
          <Input name="startDate" type="date" defaultValue={dateToInput(lease?.startDate)} required />
        </Field>
        <Field label="End date" hint="Leave blank for month-to-month">
          <Input name="endDate" type="date" defaultValue={dateToInput(lease?.endDate)} />
        </Field>
        <Field label="Status">
          <EnumSelect name="status" values={LEASE_STATUSES} defaultValue={lease?.status ?? "ACTIVE"} />
        </Field>
        <Field label="Rent due day" hint="Day of month (31 = last day)">
          <Input name="dueDay" type="number" min={1} max={31} defaultValue={lease?.dueDay ?? 1} />
        </Field>
      </FormGrid>

      <div className="text-sm font-semibold">Rent</div>
      <FormGrid>
        <RentSplitFields
          defaults={
            lease
              ? { contractRent: centsToInput(lease.contractRent), tenantPortion: centsToInput(lease.tenantPortion), hapAmount: centsToInput(lease.hapAmount) }
              : undefined
          }
          initialContract={preset?.contractRent}
        />
        <Field label="Security deposit">
          <Input name="securityDeposit" inputMode="decimal" defaultValue={lease ? centsToInput(lease.securityDeposit) : (preset?.deposit ?? "0.00")} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Late fee (tenant only)">
            <Input name="lateFeeAmount" inputMode="decimal" defaultValue={centsToInput(lease?.lateFeeAmount ?? 0)} />
          </Field>
          <Field label="Grace days">
            <Input name="lateFeeGraceDays" type="number" min={0} defaultValue={lease?.lateFeeGraceDays ?? 5} />
          </Field>
        </div>
      </FormGrid>

      <div className="text-sm font-semibold">HUD-VASH / voucher</div>
      <FormGrid>
        <Field label="Housing authority" hint={has.length === 0 ? "Add one under Housing Authorities first" : undefined}>
          <Select name="housingAuthorityId" defaultValue={lease?.housingAuthorityId ?? ""}>
            <option value="">None (no voucher)</option>
            {has.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Voucher #">
          <Input name="voucherNumber" defaultValue={lease?.voucherNumber ?? ""} />
        </Field>
        <Field label="HAP contract start">
          <Input name="hapContractStart" type="date" defaultValue={dateToInput(lease?.hapContractStart)} />
        </Field>
        <Field label="Next annual recertification">
          <Input name="nextRecertDate" type="date" defaultValue={dateToInput(lease?.nextRecertDate)} />
        </Field>
        <Field label="Move-in date">
          <Input name="moveInDate" type="date" defaultValue={dateToInput(lease?.moveInDate)} />
        </Field>
        <Field label="Move-out date">
          <Input name="moveOutDate" type="date" defaultValue={dateToInput(lease?.moveOutDate)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea name="notes" defaultValue={lease?.notes ?? ""} />
        </Field>
      </FormGrid>

      {!lease && (
        <div className="flex flex-col gap-2 rounded-md bg-paper p-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="chargeThisMonth" defaultChecked className="size-4 accent-navy" />
            Create this month&apos;s rent charges now (if the lease covers this month)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="chargeDeposit" defaultChecked className="size-4 accent-navy" />
            Charge the security deposit to the tenant
          </label>
        </div>
      )}
    </ActionForm>
  );
}
