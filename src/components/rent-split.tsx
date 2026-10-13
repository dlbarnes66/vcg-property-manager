"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";

const toNum = (s: string) => {
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Contract rent = tenant portion + HAP. Typing contract rent and tenant portion fills in HAP
 * automatically (the usual case: the PHA's rent determination letter gives you both numbers).
 */
export function RentSplitFields({ defaults }: { defaults?: { contractRent: string; tenantPortion: string; hapAmount: string } }) {
  const [contract, setContract] = useState(defaults?.contractRent ?? "");
  const [tenant, setTenant] = useState(defaults?.tenantPortion ?? "");
  const [hap, setHap] = useState(defaults?.hapAmount ?? "0.00");
  const [hapTouched, setHapTouched] = useState(Boolean(defaults));

  const autoHap = (c: string, t: string) => {
    if (!hapTouched) setHap(Math.max(0, toNum(c) - toNum(t)).toFixed(2));
  };
  const sum = toNum(tenant) + toNum(hap);
  const mismatch = contract !== "" && tenant !== "" && Math.abs(sum - toNum(contract)) > 0.004;

  return (
    <>
      <Field label="Contract rent (total) *">
        <Input name="contractRent" inputMode="decimal" required value={contract}
          onChange={(e) => { setContract(e.target.value); autoHap(e.target.value, tenant); }} placeholder="0.00" />
      </Field>
      <Field label="Tenant portion *" hint="What the veteran pays (often 30% of adjusted income)">
        <Input name="tenantPortion" inputMode="decimal" required value={tenant}
          onChange={(e) => { setTenant(e.target.value); autoHap(contract, e.target.value); }} placeholder="0.00" />
      </Field>
      <Field label="HAP (housing authority pays)" hint={hapTouched ? undefined : "Auto-filled: contract rent − tenant portion"}>
        <Input name="hapAmount" inputMode="decimal" value={hap}
          onChange={(e) => { setHap(e.target.value); setHapTouched(true); }} placeholder="0.00" />
      </Field>
      <div className="flex items-end pb-2 text-xs">
        {mismatch ? (
          <span className="text-red-700">Tenant + HAP = ${sum.toFixed(2)}, which doesn&apos;t equal contract rent.</span>
        ) : (
          <span className="text-muted">Use HAP = 0 for a standard (non-voucher) lease.</span>
        )}
      </div>
    </>
  );
}
