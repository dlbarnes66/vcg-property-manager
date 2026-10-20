"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";

export function ApplicationForm({ action }: { action: (p: ActionResult, fd: FormData) => Promise<ActionResult> }) {
  const [voucher, setVoucher] = useState("no");
  return (
    <ActionForm action={action} submitLabel="Submit application">
      {/* Honeypot: hidden from people, tempting to bots */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-0 overflow-hidden">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <h2 className="text-sm font-semibold">About you</h2>
      <FormGrid>
        <Field label="First name *"><Input name="firstName" autoComplete="given-name" required maxLength={100} /></Field>
        <Field label="Last name *"><Input name="lastName" autoComplete="family-name" required maxLength={100} /></Field>
        <Field label="Email *"><Input type="email" name="email" autoComplete="email" required /></Field>
        <Field label="Mobile phone *"><Input type="tel" name="phone" autoComplete="tel" required /></Field>
        <Field label="Are you a veteran?">
          <Select name="isVeteran" defaultValue="">
            <option value="">Prefer not to say</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </Field>
        <Field label="People in household *"><Input type="number" name="householdSize" min={1} max={20} defaultValue={1} required /></Field>
        <Field label="Desired move-in"><Input type="date" name="desiredMoveIn" /></Field>
      </FormGrid>

      <h2 className="mt-2 text-sm font-semibold">Where you live now</h2>
      <FormGrid>
        <Field label="Current address" className="sm:col-span-2"><Input name="currentAddress" autoComplete="street-address" /></Field>
        <Field label="Current landlord"><Input name="currentLandlord" /></Field>
        <Field label="Landlord phone"><Input type="tel" name="currentLandlordPhone" /></Field>
      </FormGrid>

      <h2 className="mt-2 text-sm font-semibold">Income</h2>
      <FormGrid>
        <Field label="Monthly household income"><Input name="monthlyIncome" inputMode="decimal" placeholder="0.00" /></Field>
        <Field label="Source" hint="Job, VA disability, SSI, retirement…"><Input name="incomeSource" /></Field>
        <Field label="Employer (if any)" className="sm:col-span-2"><Input name="employer" /></Field>
      </FormGrid>

      <h2 className="mt-2 text-sm font-semibold">Housing voucher</h2>
      <Field label="Do you have a housing voucher?">
        <Select name="hasVoucher" value={voucher} onChange={(e) => setVoucher(e.target.value)}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </Field>
      {voucher === "yes" && (
        <FormGrid>
          <Field label="Voucher type">
            <Select name="voucherType" defaultValue="HUD-VASH">
              <option>HUD-VASH</option>
              <option>Housing Choice Voucher (Section 8)</option>
              <option>Other</option>
            </Select>
          </Field>
          <Field label="Housing authority"><Input name="housingAuthorityName" placeholder="Mobile Housing Authority" /></Field>
          <Field label="Case manager name"><Input name="caseManagerName" /></Field>
          <Field label="Case manager phone"><Input type="tel" name="caseManagerPhone" /></Field>
          <Field label="Case manager email" className="sm:col-span-2"><Input type="email" name="caseManagerEmail" /></Field>
        </FormGrid>
      )}

      <h2 className="mt-2 text-sm font-semibold">Anything else</h2>
      <Field label="Pets or assistance animals"><Input name="pets" /></Field>
      <Field label="Anything you'd like us to know"><Textarea name="additionalInfo" rows={3} /></Field>
      <Field label="Documents (optional, up to 5)" hint="Photo ID, proof of income, voucher paperwork. PDF or photos, 10 MB each.">
        <Input type="file" name="files" multiple accept="application/pdf,image/*" className="h-auto py-1.5" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-navy" />
        <span>The information I provided is true and complete, and I authorize the property manager to verify it, including contacting my landlord, employer, and housing authority.</span>
      </label>
      <p className="text-xs text-muted">We never ask for your Social Security number on this form.</p>
    </ActionForm>
  );
}
