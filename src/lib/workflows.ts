import { Prisma, type AgentActionKind, type Workflow, type WorkflowAction, type WorkflowTrigger } from "@prisma/client";
import { db } from "./db";
import { proposeAction, run } from "./agent-actions";
import { computeLeaseLedger, dueDateFor } from "./ledger";
import { emailConfigured, sendEmail } from "./messaging-providers";
import { tenantName } from "./queries";
import { addDays, dateToInput, daysBetween, fmtDate, periodOf, todayUTC } from "./utils";

/*
 * Workflows: "when X, do Y" rules checked on a schedule (and on demand).
 * Each workflow acts at most once per subject (WorkflowFiring is claimed BEFORE acting), so
 * overlapping runs, retries, and missed days never double-send. Date triggers use windows
 * ("within N days") so a missed scheduled run catches up the next time.
 */

export const TRIGGERS: Record<WorkflowTrigger, { label: string; days: string | null; tenant: boolean }> = {
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

export const ACTIONS: Record<WorkflowAction, { label: string; needsTenant?: boolean; monthlyOnly?: boolean }> = {
  SEND_TEMPLATE: { label: "Email or text the tenant (template)", needsTenant: true },
  CREATE_TASK: { label: "Create a task" },
  NOTIFY_ME: { label: "Email me" },
  POST_RENT: { label: "Post this month's rent", monthlyOnly: true },
  APPLY_LATE_FEES: { label: "Apply late fees", monthlyOnly: true },
};

export function validateWorkflow(w: Pick<Workflow, "trigger" | "action" | "days" | "channel" | "templateId" | "taskTitle">) {
  const t = TRIGGERS[w.trigger];
  const a = ACTIONS[w.action];
  if (a.needsTenant && !t.tenant) throw new Error(`"${a.label}" only works with tenant triggers (rent, lease, recert, inspection coming up)`);
  if (a.monthlyOnly && w.trigger !== "MONTHLY") throw new Error(`"${a.label}" only works with the "Every month" trigger`);
  if (w.trigger === "MONTHLY" && (w.days < 1 || w.days > 28)) throw new Error("Day of the month must be 1–28");
  if (t.days && w.trigger !== "MONTHLY" && (w.days < 0 || w.days > 365)) throw new Error("Days must be 0–365");
  if (w.action === "SEND_TEMPLATE" && (!w.templateId || (w.channel !== "EMAIL" && w.channel !== "SMS"))) throw new Error("Pick a template (its type decides email or text)");
  if (w.action === "CREATE_TASK" && !w.taskTitle?.trim()) throw new Error("Give the task a title");
}

type Subject = {
  key: string;
  label: string; // who/what, for previews and logs
  vars: Record<string, string>; // {{name}} {{unit}} {{property}} {{date}}
  links: { tenantId?: string; leaseId?: string; unitId?: string; propertyId?: string; maintenanceId?: string };
};

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");

/** Who/what a workflow applies to right now. */
export async function findSubjects(w: Workflow, today = todayUTC()): Promise<Subject[]> {
  const prop = w.propertyId ? { unit: { propertyId: w.propertyId } } : {};
  const leaseInclude = { tenant: true, unit: { include: { property: true } } } as const;
  const leaseSubject = (l: { id: string; tenantId: string; unitId: string; tenant: { firstName: string; lastName: string }; unit: { label: string; propertyId: string; property: { name: string } } }, key: string, date: Date) => ({
    key,
    label: `${tenantName(l.tenant)} · ${l.unit.property.name} ${l.unit.label}`,
    vars: { name: tenantName(l.tenant), firstName: l.tenant.firstName, unit: l.unit.label, property: l.unit.property.name, date: fmtDate(date) },
    links: { tenantId: l.tenantId, leaseId: l.id, unitId: l.unitId, propertyId: l.unit.propertyId },
  });

  switch (w.trigger) {
    case "RENT_DUE_SOON": {
      const leases = await db.lease.findMany({ where: { status: "ACTIVE", tenantPortion: { gt: 0 }, ...prop }, include: leaseInclude });
      const out: Subject[] = [];
      for (const l of leases) {
        for (const p of [periodOf(today), periodOf(addDays(today, 32 - today.getUTCDate()))]) {
          const due = dueDateFor(p, l.dueDay);
          const until = daysBetween(today, due);
          if (until >= 0 && until <= w.days && due >= l.startDate && (!l.endDate || due <= l.endDate)) out.push(leaseSubject(l, `lease:${l.id}:${p}`, due));
        }
      }
      return out;
    }
    case "RENT_PAST_DUE": {
      const leases = await db.lease.findMany({ where: { status: "ACTIVE", ...prop }, include: { ...leaseInclude, charges: true, payments: true } });
      return leases.flatMap((l) => {
        const t = computeLeaseLedger(l.charges, l.payments, today).tenant;
        if (t.pastDue <= 0 || !t.oldestPastDue || daysBetween(t.oldestPastDue, today) < w.days) return [];
        return [leaseSubject(l, `lease:${l.id}:${periodOf(t.oldestPastDue)}`, t.oldestPastDue)];
      });
    }
    case "LEASE_ENDING": {
      const leases = await db.lease.findMany({ where: { status: "ACTIVE", endDate: { gte: today, lte: addDays(today, w.days) }, ...prop }, include: leaseInclude });
      return leases.map((l) => leaseSubject(l, `lease-end:${l.id}:${dateToInput(l.endDate!)}`, l.endDate!));
    }
    case "RECERT_DUE": {
      const leases = await db.lease.findMany({ where: { status: "ACTIVE", nextRecertDate: { gte: today, lte: addDays(today, w.days) }, ...prop }, include: leaseInclude });
      return leases.map((l) => leaseSubject(l, `recert:${l.id}:${dateToInput(l.nextRecertDate!)}`, l.nextRecertDate!));
    }
    case "INSPECTION_UPCOMING": {
      const insp = await db.inspection.findMany({
        where: { result: "PENDING", scheduledDate: { gte: today, lte: addDays(today, w.days) }, ...(w.propertyId ? { unit: { propertyId: w.propertyId } } : {}) },
        include: { unit: { include: { property: true, leases: { where: { status: "ACTIVE" }, include: { tenant: true }, take: 1 } } } },
      });
      return insp.flatMap((i) => {
        const l = i.unit.leases[0];
        if (!l) return []; // tenant triggers need someone living there
        return [{ ...leaseSubject({ ...l, unit: i.unit }, `inspection:${i.id}`, i.scheduledDate), links: { tenantId: l.tenantId, leaseId: l.id, unitId: i.unitId, propertyId: i.unit.propertyId } }];
      });
    }
    case "INSPECTION_FAILED": {
      const insp = await db.inspection.findMany({
        where: { result: "FAIL", updatedAt: { gte: addDays(today, -30) }, ...(w.propertyId ? { unit: { propertyId: w.propertyId } } : {}) },
        include: { unit: { include: { property: true } } },
      });
      return insp.map((i) => ({
        key: `inspection-failed:${i.id}`,
        label: `${i.unit.property.name} ${i.unit.label}`,
        vars: { name: "", unit: i.unit.label, property: i.unit.property.name, date: fmtDate(i.cureByDate ?? i.completedDate ?? i.scheduledDate) },
        links: { unitId: i.unitId, propertyId: i.unit.propertyId },
      }));
    }
    case "APPLICATION_RECEIVED": {
      const apps = await db.application.findMany({
        where: { createdAt: { gte: addDays(today, -7) }, ...(w.propertyId ? { listing: { unit: { propertyId: w.propertyId } } } : {}) },
        include: { listing: { include: { unit: { include: { property: true } } } } },
      });
      return apps.map((a) => ({
        key: `application:${a.id}`,
        label: `${a.firstName} ${a.lastName} for ${a.listing.unit.property.name} ${a.listing.unit.label}`,
        vars: { name: `${a.firstName} ${a.lastName}`, firstName: a.firstName, unit: a.listing.unit.label, property: a.listing.unit.property.name, date: fmtDate(a.createdAt) },
        links: { unitId: a.listing.unitId, propertyId: a.listing.unit.propertyId },
      }));
    }
    case "WORK_ORDER_CREATED": {
      const wos = await db.maintenanceRequest.findMany({ where: { createdAt: { gte: addDays(today, -7) }, ...prop }, include: { unit: { include: { property: true } } } });
      return wos.map((o) => ({
        key: `wo:${o.id}`,
        label: `${o.title} · ${o.unit.property.name} ${o.unit.label}`,
        vars: { name: o.title, unit: o.unit.label, property: o.unit.property.name, date: fmtDate(o.reportedOn), priority: o.priority.toLowerCase() },
        links: { unitId: o.unitId, propertyId: o.unit.propertyId, maintenanceId: o.id },
      }));
    }
    case "MONTHLY": {
      if (today.getUTCDate() < w.days) return [];
      const p = periodOf(today);
      return [{ key: `month:${p}`, label: p, vars: { name: "", unit: "", property: "", date: fmtDate(today), period: p }, links: {} }];
    }
  }
}

/** The concrete action for one subject, as an agent action kind + payload (so approvals use the same executor). */
async function plan(w: Workflow, s: Subject, today: Date): Promise<{ kind: AgentActionKind; payload: unknown } | { notify: { subject: string; text: string } }> {
  switch (w.action) {
    case "SEND_TEMPLATE": {
      const t = await db.messageTemplate.findUnique({ where: { id: w.templateId ?? "" } });
      if (!t) throw new Error("The workflow's template was deleted");
      return { kind: "SEND_MESSAGE", payload: { audience: { kind: "tenant", id: s.links.tenantId! }, channel: t.channel === "SMS" ? "SMS" : "EMAIL", ...(t.subject ? { subject: t.subject } : {}), body: t.body } };
    }
    case "CREATE_TASK":
      return {
        kind: "CREATE_TASK",
        payload: {
          title: fill(w.taskTitle ?? w.name, s.vars).slice(0, 200) || w.name,
          description: `Created by workflow "${w.name}"`,
          dueDate: dateToInput(addDays(today, w.taskDueInDays)),
          priority: w.taskPriority,
          links: Object.fromEntries(Object.entries(s.links).filter(([, v]) => v)),
        },
      };
    case "NOTIFY_ME": {
      const line = fill(w.taskTitle?.trim() || `${TRIGGERS[w.trigger].label}: {{name}} {{property}} {{unit}}`, s.vars).replace(/\s+/g, " ").trim();
      return { notify: { subject: line.slice(0, 150), text: `${line}\n\nFrom your workflow "${w.name}".` } };
    }
    case "POST_RENT":
      return { kind: "POST_RENT", payload: { period: s.vars.period } };
    case "APPLY_LATE_FEES":
      return { kind: "APPLY_LATE_FEES", payload: { period: s.vars.period } };
  }
}

export type RunSummary = { workflowId: string; name: string; matched: number; fired: number; failed: number; skippedAlreadyDone: number; preview: string[]; errors: string[] };

const isDup = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Runs one workflow. With dryRun, reports who it would act on without doing or recording anything. */
export async function runWorkflow(w: Workflow, opts: { source: "schedule" | "manual"; dryRun?: boolean; actorEmail?: string; today?: Date; statusCallback?: string }): Promise<RunSummary> {
  const today = opts.today ?? todayUTC();
  const summary: RunSummary = { workflowId: w.id, name: w.name, matched: 0, fired: 0, failed: 0, skippedAlreadyDone: 0, preview: [], errors: [] };
  const subjects = await findSubjects(w, today);
  summary.matched = subjects.length;
  const done = new Set((await db.workflowFiring.findMany({ where: { workflowId: w.id, subjectKey: { in: subjects.map((s) => s.key) } }, select: { subjectKey: true } })).map((f) => f.subjectKey));

  if (opts.dryRun) {
    for (const s of subjects) (done.has(s.key) ? (summary.skippedAlreadyDone++, null) : summary.preview.push(s.label));
    return summary;
  }

  const runRow = await db.workflowRun.create({ data: { workflowId: w.id, source: opts.source } });
  const actor = opts.actorEmail ?? `workflow:${w.name}`;
  for (const s of subjects) {
    if (done.has(s.key)) {
      summary.skippedAlreadyDone++;
      continue;
    }
    // Claim first: a concurrent run hitting the same subject gets a duplicate-key error and moves on.
    let firingId: string;
    try {
      firingId = (await db.workflowFiring.create({ data: { workflowId: w.id, subjectKey: s.key, outcome: "running" } })).id;
    } catch (e) {
      if (isDup(e)) {
        summary.skippedAlreadyDone++;
        continue;
      }
      throw e;
    }
    try {
      const p = await plan(w, s, today);
      let outcome: string;
      let ok = true;
      if ("notify" in p) {
        const to = process.env.MANAGER_EMAIL;
        if (to && emailConfigured()) {
          const r = await sendEmail({ to, subject: p.notify.subject, text: p.notify.text, messageId: firingId });
          if (!r.ok) throw new Error(r.error);
          outcome = `Emailed ${to}`;
        } else {
          await db.task.create({ data: { title: p.notify.subject, description: p.notify.text, dueDate: today, priority: "HIGH", ...Object.fromEntries(Object.entries(s.links).filter(([, v]) => v)) } });
          outcome = "Created a task (email isn't set up)";
        }
      } else if (w.requireApproval) {
        const a = await proposeAction(p.kind, p.payload, { proposedBy: `workflow:${w.name}`, workflowId: w.id, reason: `${TRIGGERS[w.trigger].label}: ${s.label}` });
        outcome = `Waiting for approval: ${a.summary}`;
      } else {
        try {
          outcome = await run(p.kind, p.payload, actor, { statusCallback: opts.statusCallback });
        } catch (e) {
          // "Nobody to send to" (no consent / no email) won't fix itself by retrying: record it as done-but-skipped.
          const msg = e instanceof Error ? e.message : String(e);
          if (/agreed to texts|no email|no valid mobile|opted out|No one to send/i.test(msg)) {
            outcome = `Skipped: ${msg}`;
            ok = false;
          } else throw e;
        }
      }
      await db.workflowFiring.update({ where: { id: firingId }, data: { outcome: outcome.slice(0, 500), ok } });
      summary.fired++;
    } catch (e) {
      // Release the claim so the next run retries (e.g. the email provider was down).
      await db.workflowFiring.delete({ where: { id: firingId } }).catch(() => undefined);
      summary.failed++;
      summary.errors.push(`${s.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await db.workflowRun.update({
    where: { id: runRow.id },
    data: { matched: summary.matched, fired: summary.fired, failed: summary.failed, error: summary.errors.slice(0, 5).join(" | ").slice(0, 2000) || null, finishedAt: new Date() },
  });
  await db.workflow.update({ where: { id: w.id }, data: { lastRunAt: new Date() } });
  return summary;
}

export async function runAllWorkflows(opts: { source: "schedule" | "manual"; actorEmail?: string; today?: Date; statusCallback?: string }) {
  const flows = await db.workflow.findMany({ where: { enabled: true }, orderBy: { createdAt: "asc" } });
  const results: RunSummary[] = [];
  for (const w of flows) {
    try {
      results.push(await runWorkflow(w, opts));
    } catch (e) {
      results.push({ workflowId: w.id, name: w.name, matched: 0, fired: 0, failed: 1, skippedAlreadyDone: 0, preview: [], errors: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return results;
}

/** A sensible starting set. Created turned OFF so you can preview each before enabling. */
export async function addStarterWorkflows() {
  const tpl = async (name: string) => (await db.messageTemplate.findUnique({ where: { name } }))?.id ?? null;
  const smsReminder = await tpl("Rent reminder (text)");
  const pastDue = await tpl("Past-due balance");
  const starters: Prisma.WorkflowCreateManyInput[] = [
    ...(smsReminder ? [{ name: "Text rent reminder 3 days before it's due", trigger: "RENT_DUE_SOON" as const, days: 3, action: "SEND_TEMPLATE" as const, channel: "SMS" as const, templateId: smsReminder }] : []),
    ...(pastDue ? [{ name: "Past-due email 5 days late (ask me first)", trigger: "RENT_PAST_DUE" as const, days: 5, action: "SEND_TEMPLATE" as const, channel: "EMAIL" as const, templateId: pastDue, requireApproval: true }] : []),
    { name: "Recertification prep 60 days out", trigger: "RECERT_DUE", days: 60, action: "CREATE_TASK", taskTitle: "Start recertification paperwork with {{name}} ({{property}} {{unit}}), due {{date}}", taskDueInDays: 7, taskPriority: "HIGH" },
    { name: "Renewal decision 60 days before lease ends", trigger: "LEASE_ENDING", days: 60, action: "CREATE_TASK", taskTitle: "Renewal: {{name}}'s lease at {{property}} {{unit}} ends {{date}}", taskDueInDays: 14 },
    { name: "Fix failed inspections", trigger: "INSPECTION_FAILED", days: 0, action: "CREATE_TASK", taskTitle: "Repair failed inspection items at {{property}} {{unit}} before {{date}} (HAP at risk)", taskDueInDays: 3, taskPriority: "URGENT" },
    { name: "Email me when an application comes in", trigger: "APPLICATION_RECEIVED", days: 0, action: "NOTIFY_ME", taskTitle: "New rental application from {{name}} for {{property}} {{unit}}" },
    { name: "Post rent on the 1st", trigger: "MONTHLY", days: 1, action: "POST_RENT" },
    { name: "Late fees on the 6th (ask me first)", trigger: "MONTHLY", days: 6, action: "APPLY_LATE_FEES", requireApproval: true },
  ];
  const existing = new Set((await db.workflow.findMany({ select: { name: true } })).map((w) => w.name));
  const toAdd = starters.filter((s) => !existing.has(s.name)).map((s) => ({ ...s, enabled: false }));
  if (toAdd.length) await db.workflow.createMany({ data: toAdd });
  return { added: toAdd.length, missingTemplates: !smsReminder || !pastDue };
}
