import { z } from "zod";
import type { AgentActionKind, Prisma } from "@prisma/client";
import { db } from "./db";
import { syncLedger } from "./accounting";
import { applyLateFees, generateRentCharges } from "./ledger";
import { sendToAudience, type Audience } from "./messaging";
import { tenantName } from "./queries";
import { money, periodLabel, toDate, todayUTC } from "./utils";

/*
 * Every action the AI (or an "ask first" workflow) wants to take is stored as a PROPOSED AgentAction.
 * Nothing changes until a person approves it. Payloads are validated when proposed AND when executed.
 */

const id = z.string().min(1).max(40);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM");
const links = z
  .object({ propertyId: id, unitId: id, tenantId: id, leaseId: id, maintenanceId: id, vendorId: id, housingAuthorityId: id })
  .partial()
  .strict();

export const schemas = {
  SEND_MESSAGE: z
    .object({
      audience: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("tenant"), id }),
        z.object({ kind: z.literal("case-manager"), id }),
        z.object({ kind: z.literal("property"), id }),
        z.object({ kind: z.literal("all-tenants") }),
        z.object({ kind: z.literal("vendor"), id }),
        z.object({ kind: z.literal("pha"), id }),
      ]),
      channel: z.enum(["EMAIL", "SMS"]),
      subject: z.string().max(200).optional(),
      body: z.string().min(1).max(4000),
    })
    .strict()
    .refine((p) => p.channel === "SMS" || !!p.subject, { message: "An email needs a subject" }),
  CREATE_TASK: z
    .object({
      title: z.string().min(1).max(200),
      description: z.string().max(4000).optional(),
      dueDate: ymd.optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      links: links.optional(),
    })
    .strict(),
  CREATE_WORK_ORDER: z
    .object({ unitId: id, title: z.string().min(1).max(200), description: z.string().max(4000).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "EMERGENCY"]).optional(), vendorId: id.optional() })
    .strict(),
  ADD_NOTE: z
    .object({ body: z.string().min(1).max(10000), links })
    .strict()
    .refine((p) => Object.values(p.links).some(Boolean), { message: "A note must be attached to a record" }),
  RECORD_PAYMENT: z
    .object({
      leaseId: id,
      party: z.enum(["TENANT", "HOUSING_AUTHORITY"]),
      amountCents: z.number().int().positive().max(100_000_00),
      paidOn: ymd,
      method: z.enum(["ACH", "CHECK", "CASH", "CARD", "MONEY_ORDER", "OTHER"]),
      reference: z.string().max(100).optional(),
    })
    .strict(),
  POST_RENT: z.object({ period }).strict(),
  APPLY_LATE_FEES: z.object({ period }).strict(),
} satisfies Record<AgentActionKind, z.ZodTypeAny>;

export type ActionPayload<K extends AgentActionKind> = z.infer<(typeof schemas)[K]>;

function parse<K extends AgentActionKind>(kind: K, payload: unknown): ActionPayload<K> {
  const r = schemas[kind].safeParse(payload);
  if (!r.success) throw new Error(`Invalid ${kind}: ${r.error.issues.map((i) => `${i.path.join(".") || "payload"} ${i.message}`).join("; ")}`);
  return r.data as ActionPayload<K>;
}

/** Plain-English summary with real names, checking that every referenced record exists. */
export async function describe(kind: AgentActionKind, payload: unknown): Promise<string> {
  switch (kind) {
    case "SEND_MESSAGE": {
      const p = parse(kind, payload);
      const ch = p.channel === "EMAIL" ? "Email" : "Text";
      const a = p.audience;
      const who =
        a.kind === "all-tenants"
          ? "all current tenants"
          : a.kind === "tenant"
            ? tenantName(await db.tenant.findUniqueOrThrow({ where: { id: a.id } }))
            : a.kind === "case-manager"
              ? `${tenantName(await db.tenant.findUniqueOrThrow({ where: { id: a.id } }))}'s case manager`
              : a.kind === "property"
                ? `all tenants at ${(await db.property.findUniqueOrThrow({ where: { id: a.id } })).name}`
                : a.kind === "vendor"
                  ? (await db.vendor.findUniqueOrThrow({ where: { id: a.id } })).name
                  : (await db.housingAuthority.findUniqueOrThrow({ where: { id: a.id } })).name;
      return `${ch} ${who}${p.subject ? `: "${p.subject}"` : ""}`;
    }
    case "CREATE_TASK": {
      const p = parse(kind, payload);
      await assertLinks(p.links);
      return `Create task "${p.title}"${p.dueDate ? ` due ${p.dueDate}` : ""}`;
    }
    case "CREATE_WORK_ORDER": {
      const p = parse(kind, payload);
      const u = await db.unit.findUniqueOrThrow({ where: { id: p.unitId }, include: { property: true } });
      return `Open work order "${p.title}" at ${u.property.name} · ${u.label}${p.priority === "EMERGENCY" ? " (emergency)" : ""}`;
    }
    case "ADD_NOTE": {
      const p = parse(kind, payload);
      await assertLinks(p.links);
      return `Add note: "${p.body.slice(0, 80)}${p.body.length > 80 ? "…" : ""}"`;
    }
    case "RECORD_PAYMENT": {
      const p = parse(kind, payload);
      const l = await db.lease.findUniqueOrThrow({ where: { id: p.leaseId }, include: { tenant: true, unit: { include: { property: true } } } });
      return `Record ${money(p.amountCents)} ${p.party === "TENANT" ? `from ${tenantName(l.tenant)}` : "HAP from the housing authority"} (${l.unit.property.name} · ${l.unit.label}) on ${p.paidOn}`;
    }
    case "POST_RENT":
      return `Post ${periodLabel(parse(kind, payload).period)} rent charges for all active leases`;
    case "APPLY_LATE_FEES":
      return `Apply late fees for ${periodLabel(parse(kind, payload).period)}`;
  }
}

async function assertLinks(l?: z.infer<typeof links>) {
  if (!l) return;
  const checks: Promise<unknown>[] = [];
  if (l.propertyId) checks.push(db.property.findUniqueOrThrow({ where: { id: l.propertyId } }));
  if (l.unitId) checks.push(db.unit.findUniqueOrThrow({ where: { id: l.unitId } }));
  if (l.tenantId) checks.push(db.tenant.findUniqueOrThrow({ where: { id: l.tenantId } }));
  if (l.leaseId) checks.push(db.lease.findUniqueOrThrow({ where: { id: l.leaseId } }));
  if (l.maintenanceId) checks.push(db.maintenanceRequest.findUniqueOrThrow({ where: { id: l.maintenanceId } }));
  if (l.vendorId) checks.push(db.vendor.findUniqueOrThrow({ where: { id: l.vendorId } }));
  if (l.housingAuthorityId) checks.push(db.housingAuthority.findUniqueOrThrow({ where: { id: l.housingAuthorityId } }));
  await Promise.all(checks);
}

export async function proposeAction(
  kind: AgentActionKind,
  payload: unknown,
  meta: { proposedBy: string; reason?: string | null; conversationId?: string | null; workflowId?: string | null },
) {
  const data = parse(kind, payload);
  let summary: string;
  try {
    summary = await describe(kind, data);
  } catch (e) {
    if (e instanceof Error && /No .* found|Expected a record/i.test(e.message)) throw new Error("One of the records in that action doesn't exist (check the ids)");
    throw e;
  }
  return db.agentAction.create({
    data: { kind, payload: data as Prisma.InputJsonValue, summary, reason: meta.reason ?? null, proposedBy: meta.proposedBy, conversationId: meta.conversationId ?? null, workflowId: meta.workflowId ?? null },
  });
}

/** Runs an approved action exactly once. Safe against double clicks. */
export async function approveAndExecute(actionId: string, approverEmail: string, opts: { statusCallback?: string } = {}) {
  const claimed = await db.agentAction.updateMany({
    where: { id: actionId, status: "PROPOSED" },
    data: { status: "EXECUTED", decidedByEmail: approverEmail, decidedAt: new Date() },
  });
  if (claimed.count === 0) throw new Error("This action was already approved or rejected");
  const action = await db.agentAction.findUniqueOrThrow({ where: { id: actionId } });
  try {
    const result = await run(action.kind, action.payload, approverEmail, opts);
    return db.agentAction.update({ where: { id: actionId }, data: { result } });
  } catch (e) {
    return db.agentAction.update({ where: { id: actionId }, data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } });
  }
}

export async function rejectAction(actionId: string, email: string) {
  const r = await db.agentAction.updateMany({ where: { id: actionId, status: "PROPOSED" }, data: { status: "REJECTED", decidedByEmail: email, decidedAt: new Date() } });
  if (r.count === 0) throw new Error("This action was already approved or rejected");
}

/** Performs an action immediately (used by workflows that don't require approval, and by approvals). */
export async function run(kind: AgentActionKind, payload: unknown, actorEmail: string, opts: { statusCallback?: string } = {}): Promise<string> {
  switch (kind) {
    case "SEND_MESSAGE": {
      const p = parse(kind, payload);
      const out = await sendToAudience({ audience: p.audience as Audience, channel: p.channel, subject: p.subject ?? null, body: p.body, sentByEmail: actorEmail, statusCallback: opts.statusCallback });
      if (out.sent === 0) throw new Error(out.failed[0]?.error || out.skipped.map((s) => `${s.name}: ${s.reason}`).join("; ") || "No one to send to");
      return `Sent to ${out.sent}${out.skipped.length ? `, skipped ${out.skipped.length}` : ""}${out.failed.length ? `, failed ${out.failed.length}` : ""}`;
    }
    case "CREATE_TASK": {
      const p = parse(kind, payload);
      await assertLinks(p.links);
      const t = await db.task.create({
        data: { title: p.title, description: p.description, priority: p.priority ?? "NORMAL", dueDate: p.dueDate ? toDate(p.dueDate) : null, createdByEmail: actorEmail, ...(p.links ?? {}) },
      });
      return `Task created: ${t.title}`;
    }
    case "CREATE_WORK_ORDER": {
      const p = parse(kind, payload);
      const wo = await db.maintenanceRequest.create({ data: { unitId: p.unitId, title: p.title, description: p.description, priority: p.priority ?? "NORMAL", vendorId: p.vendorId } });
      return `Work order created: ${wo.title}`;
    }
    case "ADD_NOTE": {
      const p = parse(kind, payload);
      await assertLinks(p.links);
      await db.note.create({ data: { body: p.body, authorEmail: actorEmail, ...p.links } });
      return "Note added";
    }
    case "RECORD_PAYMENT": {
      const p = parse(kind, payload);
      const pay = await db.payment.create({
        data: { leaseId: p.leaseId, party: p.party, amount: p.amountCents, paidOn: toDate(p.paidOn)!, method: p.method, reference: p.reference, notes: "Recorded via AI agent (approved)" },
      });
      await syncLedger();
      return `Payment of ${money(pay.amount)} recorded`;
    }
    case "POST_RENT": {
      const r = await generateRentCharges(parse(kind, payload).period);
      await syncLedger();
      return `Posted ${r.created} rent charges across ${r.eligibleLeases} leases`;
    }
    case "APPLY_LATE_FEES": {
      const r = await applyLateFees(parse(kind, payload).period, todayUTC());
      await syncLedger();
      return `Applied ${r.created} late fees`;
    }
  }
}

/** The full content a person should read before approving (e.g. the exact message text). */
export function detailOf(kind: AgentActionKind, payload: unknown): string | null {
  const p = payload as Record<string, unknown>;
  if (kind === "SEND_MESSAGE") return [p.subject ? `Subject: ${p.subject}` : null, String(p.body ?? "")].filter(Boolean).join("\n\n");
  if (kind === "CREATE_TASK" || kind === "CREATE_WORK_ORDER") return (p.description as string) ?? null;
  if (kind === "ADD_NOTE") return String(p.body ?? "");
  return null;
}
