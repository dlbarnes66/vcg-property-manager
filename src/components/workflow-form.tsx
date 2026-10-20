"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, FormGrid, Input, Select } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";

type Opt = { id: string; label: string };
export type WorkflowDefaults = {
  name?: string; trigger?: string; days?: number; action?: string; templateId?: string | null; taskTitle?: string | null;
  taskDueInDays?: number; taskPriority?: string; requireApproval?: boolean; propertyId?: string | null;
};

const TRIGGERS: Record<string, { label: string; days: string | null; tenant: boolean }> = {
  RENT_DUE_SOON: { label: "Rent is due soon", days: "Days before the due date", tenant: true },
  RENT_PAST_DUE: { label: "Tenant is past due", days: "Days after the due date", tenant: true },
  LEASE_ENDING: { label: "Lease is ending", days: "Days before the end date", tenant: true },
  RECERT_DUE: { label: "Recertification is coming up", days: "Days before the recert date", tenant: true },
  INSPECTION_UPCOMING: { label: "Inspection is coming up", days: "Days before the inspection", tenant: true },
  INSPECTION_FAILED: { label: "An inspection failed", days: null, tenant: false },
  APPLICATION_RECEIVED: { label: "A rental application comes in", days: null, tenant: false },
  WORK_ORDER_CREATED: { label: "A work order is created", days: null, tenant: false },
  MONTHLY: { label: "Every month", days: "Day of the month (1–28)", tenant: false },
};
const ACTIONS: Record<string, { label: string; needsTenant?: boolean; monthlyOnly?: boolean }> = {
  SEND_TEMPLATE: { label: "Email or text the tenant (template)", needsTenant: true },
  CREATE_TASK: { label: "Create a task" },
  NOTIFY_ME: { label: "Email me" },
  POST_RENT: { label: "Post this month's rent", monthlyOnly: true },
  APPLY_LATE_FEES: { label: "Apply late fees", monthlyOnly: true },
};

export function WorkflowForm({
  action, templates, properties, defaults, submitLabel,
}: {
  action: (p: ActionResult, fd: FormData) => Promise<ActionResult>;
  templates: (Opt & { channel: string })[];
  properties: Opt[];
  defaults?: WorkflowDefaults;
  submitLabel: string;
}) {
  const [trigger, setTrigger] = useState(defaults?.trigger ?? "RENT_PAST_DUE");
  const [act, setAct] = useState(defaults?.action ?? "CREATE_TASK");
  const t = TRIGGERS[trigger];
  const okActions = Object.entries(ACTIONS).filter(([, a]) => (!a.needsTenant || t.tenant) && (!a.monthlyOnly || trigger === "MONTHLY"));
  const actValid = okActions.some(([k]) => k === act);
  const current = actValid ? act : okActions[0][0];

  return (
    <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={!defaults}>
      <Field label="Name *"><Input name="name" defaultValue={defaults?.name} placeholder="Text reminder 3 days before rent is due" required maxLength={120} /></Field>
      <FormGrid>
        <Field label="When">
          <Select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {Object.entries(TRIGGERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        {t.days ? (
          <Field label={t.days}><Input type="number" name="days" min={trigger === "MONTHLY" ? 1 : 0} max={trigger === "MONTHLY" ? 28 : 365} defaultValue={defaults?.days ?? (trigger === "MONTHLY" ? 1 : 3)} required /></Field>
        ) : (
          <input type="hidden" name="days" value="0" />
        )}
        <Field label="Do this" className="sm:col-span-2">
          <Select name="action" value={current} onChange={(e) => setAct(e.target.value)}>
            {okActions.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
      </FormGrid>
      {current === "SEND_TEMPLATE" && (
        <Field label="Template" hint={templates.length ? "Texts only go to tenants marked OK to text." : "Create a template under Communications → Templates first."}>
          <Select name="templateId" defaultValue={defaults?.templateId ?? ""} required>
            <option value="">Choose…</option>
            {templates.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.channel === "SMS" ? "text" : "email"})</option>)}
          </Select>
        </Field>
      )}
      {(current === "CREATE_TASK" || current === "NOTIFY_ME") && (
        <>
          <Field label={current === "CREATE_TASK" ? "Task title *" : "Message"} hint="Fill-ins: {{name}} {{property}} {{unit}} {{date}}">
            <Input name="taskTitle" defaultValue={defaults?.taskTitle ?? ""} required={current === "CREATE_TASK"} placeholder="Follow up with {{name}} about {{property}} {{unit}}" />
          </Field>
          {current === "CREATE_TASK" && (
            <FormGrid>
              <Field label="Due in (days)"><Input type="number" name="taskDueInDays" min={0} max={365} defaultValue={defaults?.taskDueInDays ?? 1} /></Field>
              <Field label="Priority">
                <Select name="taskPriority" defaultValue={defaults?.taskPriority ?? "NORMAL"}>
                  {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
                </Select>
              </Field>
            </FormGrid>
          )}
        </>
      )}
      <Field label="Only for property">
        <Select name="propertyId" defaultValue={defaults?.propertyId ?? ""}>
          <option value="">All properties</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>
      {current !== "NOTIFY_ME" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="requireApproval" defaultChecked={defaults?.requireApproval ?? false} className="mt-0.5 size-4 accent-navy" />
          <span>Ask me first <span className="block text-xs text-muted">Each action waits in Approvals instead of running automatically.</span></span>
        </label>
      )}
    </ActionForm>
  );
}
