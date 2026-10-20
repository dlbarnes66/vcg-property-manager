"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";

type Opt = { id: string; label: string };
const blank = () => ({ key: Math.random().toString(36).slice(2), debit: "", credit: "" });
const num = (s: string) => (Number.isFinite(Number(s.replace(/[$,]/g, ""))) ? Number(s.replace(/[$,]/g, "")) : 0);

export function JournalEntryForm({ action, accounts, properties, today }: { action: (p: ActionResult, fd: FormData) => Promise<ActionResult>; accounts: Opt[]; properties: Opt[]; today: string }) {
  const [rows, setRows] = useState([blank(), blank()]);
  const dr = rows.reduce((s, r) => s + num(r.debit), 0);
  const cr = rows.reduce((s, r) => s + num(r.credit), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const set = (i: number, k: "debit" | "credit", v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v, ...(v ? { [k === "debit" ? "credit" : "debit"]: "" } : {}) } : r)));

  return (
    <ActionForm action={action} submitLabel="Save entry" onSuccess={() => setRows([blank(), blank()])} resetOnSuccess>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date *"><Input type="date" name="date" defaultValue={today} required /></Field>
        <Field label="Memo" className="sm:col-span-2"><Input name="memo" placeholder="Opening balance, owner contribution, correction…" /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-1 font-medium">Account</th><th className="w-28 pb-1 font-medium">Debit</th><th className="w-28 pb-1 font-medium">Credit</th><th className="w-40 pb-1 font-medium">Property</th><th className="pb-1 font-medium">Line memo</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="py-1 pr-2">
                  <Select name="line.accountId" defaultValue="">
                    <option value="">—</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </Select>
                </td>
                <td className="py-1 pr-2"><Input name="line.debit" inputMode="decimal" value={r.debit} onChange={(e) => set(i, "debit", e.target.value)} /></td>
                <td className="py-1 pr-2"><Input name="line.credit" inputMode="decimal" value={r.credit} onChange={(e) => set(i, "credit", e.target.value)} /></td>
                <td className="py-1 pr-2">
                  <Select name="line.propertyId" defaultValue="">
                    <option value="">—</option>
                    {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </Select>
                </td>
                <td className="py-1 pr-2"><Input name="line.memo" /></td>
                <td className="py-1">
                  {rows.length > 2 && (
                    <button type="button" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted hover:text-ink"><X size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-sm">
              <td className="pt-2">
                <button type="button" onClick={() => setRows([...rows, blank()])} className="inline-flex items-center gap-1 text-navy hover:underline"><Plus size={14} /> Add line</button>
              </td>
              <td className="tabular pt-2 font-medium">{dr.toFixed(2)}</td>
              <td className="tabular pt-2 font-medium">{cr.toFixed(2)}</td>
              <td colSpan={3} className={`pt-2 text-xs ${diff === 0 && dr > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {dr === 0 ? "" : diff === 0 ? "Balanced" : `Off by ${Math.abs(diff).toFixed(2)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ActionForm>
  );
}
