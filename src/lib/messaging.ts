import { randomUUID } from "crypto";
import type { MessageChannel } from "@prisma/client";
import { db } from "./db";
import { computeLeaseLedger, dueDateFor } from "./ledger";
import { isEmail, renderTemplate, toE164, type MergeVars } from "./messaging-core";
import { sendEmail, sendSms } from "./messaging-providers";
import { tenantName } from "./queries";
import { addDays, fmtDate, money, periodOf, todayUTC } from "./utils";

export type Audience =
  | { kind: "tenant"; id: string }
  | { kind: "case-manager"; id: string } // the tenant's VA / HUD-VASH case manager
  | { kind: "property"; id: string } // every tenant with an active lease there
  | { kind: "all-tenants" }
  | { kind: "vendor"; id: string }
  | { kind: "pha"; id: string };

export type Recipient = {
  name: string;
  address: string;
  vars: MergeVars;
  tenantId?: string;
  vendorId?: string;
  housingAuthorityId?: string;
  propertyId?: string;
  leaseId?: string;
};
export type Skipped = { name: string; reason: string };

const isAnnouncement = (a: Audience) => a.kind === "property" || a.kind === "all-tenants";

/**
 * Who a message actually goes to, and who is skipped and why. Rules:
 *  - Texts to tenants require their recorded consent ("OK to text").
 *  - Tenants who opted out of email are left out of announcements (direct messages still go).
 *  - Duplicate addresses in one send are collapsed.
 */
export async function resolveRecipients(audience: Audience, channel: "EMAIL" | "SMS") {
  const recipients: Recipient[] = [];
  const skipped: Skipped[] = [];
  const addr = (raw: string | null | undefined) => (channel === "EMAIL" ? (isEmail(raw) ? raw!.trim().toLowerCase() : null) : toE164(raw));
  const noAddr = channel === "EMAIL" ? "no email on file" : "no valid mobile number";

  if (audience.kind === "vendor" || audience.kind === "pha") {
    const r =
      audience.kind === "vendor"
        ? await db.vendor.findUniqueOrThrow({ where: { id: audience.id } })
        : await db.housingAuthority.findUniqueOrThrow({ where: { id: audience.id } });
    const a = addr(channel === "EMAIL" ? r.email : r.phone);
    if (!a) skipped.push({ name: r.name, reason: noAddr });
    else recipients.push({ name: r.name, address: a, vars: {}, ...(audience.kind === "vendor" ? { vendorId: r.id } : { housingAuthorityId: r.id }) });
    return { recipients, skipped };
  }

  const tenantWhere =
    audience.kind === "tenant" || audience.kind === "case-manager"
      ? { id: audience.id }
      : audience.kind === "property"
        ? { leases: { some: { status: "ACTIVE" as const, unit: { propertyId: audience.id } } } }
        : { leases: { some: { status: "ACTIVE" as const } } };

  const tenants = await db.tenant.findMany({
    where: tenantWhere,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      leases: {
        where: { status: "ACTIVE" },
        orderBy: { startDate: "desc" },
        take: 1,
        include: { unit: { include: { property: true } }, charges: true, payments: true },
      },
    },
  });
  if (audience.kind === "tenant" && tenants.length === 0) throw new Error("Tenant not found");

  const seen = new Set<string>();
  for (const t of tenants) {
    const name = tenantName(t);
    const lease = t.leases[0];
    if (audience.kind === "property" && lease?.unit.propertyId !== audience.id) continue;

    if (audience.kind === "case-manager") {
      const a = addr(channel === "EMAIL" ? t.caseManagerEmail : t.caseManagerPhone);
      const cm = t.caseManagerName ?? "Case manager";
      if (!a) skipped.push({ name: `${cm} (for ${name})`, reason: noAddr });
      else recipients.push({ name: cm, address: a, vars: tenantVars(t, lease), tenantId: t.id, leaseId: lease?.id, propertyId: lease?.unit.propertyId });
      continue;
    }

    if (channel === "SMS" && !t.smsConsent) {
      skipped.push({ name, reason: "hasn't agreed to texts" });
      continue;
    }
    if (channel === "EMAIL" && t.emailOptOut && isAnnouncement(audience)) {
      skipped.push({ name, reason: "opted out of announcements" });
      continue;
    }
    const a = addr(channel === "EMAIL" ? t.email : t.phone);
    if (!a) {
      skipped.push({ name, reason: noAddr });
      continue;
    }
    if (seen.has(a)) {
      skipped.push({ name, reason: "same address as another recipient" });
      continue;
    }
    seen.add(a);
    recipients.push({ name, address: a, vars: tenantVars(t, lease), tenantId: t.id, leaseId: lease?.id, propertyId: lease?.unit.propertyId });
  }
  return { recipients, skipped };
}

type TenantWithLease = { firstName: string; lastName: string };
type LeaseLite = {
  dueDay: number;
  tenantPortion: number;
  unit: { label: string; property: { name: string } };
  charges: { amount: number; dueDate: Date; party: "TENANT" | "HOUSING_AUTHORITY" }[];
  payments: { amount: number; party: "TENANT" | "HOUSING_AUTHORITY" }[];
};

export function tenantVars(t: TenantWithLease, lease?: LeaseLite): MergeVars {
  const vars: MergeVars = { firstName: t.firstName, lastName: t.lastName };
  if (!lease) return vars;
  const today = todayUTC();
  let due = dueDateFor(periodOf(today), lease.dueDay);
  if (due < today) due = dueDateFor(periodOf(addDays(today, 32 - today.getUTCDate())), lease.dueDay);
  const { tenant } = computeLeaseLedger(lease.charges, lease.payments, today);
  return {
    ...vars,
    property: lease.unit.property.name,
    unit: lease.unit.label,
    balance: money(Math.max(0, tenant.balance)),
    rent: money(lease.tenantPortion),
    dueDate: fmtDate(due),
  };
}

export type SendOutcome = { batchId: string; sent: number; failed: { name: string; error: string }[]; skipped: Skipped[]; blankFields: string[] };

/**
 * Creates one Message per recipient (so each has its own history and delivery status), then sends
 * them a few at a time. Messages are saved before sending, so nothing is lost if a send fails.
 */
export async function sendToAudience(opts: {
  audience: Audience;
  channel: "EMAIL" | "SMS";
  subject?: string | null;
  body: string;
  sentByEmail: string;
  statusCallback?: string;
  context?: { leaseId?: string | null; maintenanceId?: string | null };
}): Promise<SendOutcome> {
  const { recipients, skipped } = await resolveRecipients(opts.audience, opts.channel);
  if (recipients.length > 500) throw new Error("That's more than 500 recipients. Send to one property at a time.");
  const batchId = randomUUID();
  const blank = new Set<string>();
  const bulkSms = opts.channel === "SMS" && recipients.length > 1;

  const rows = await db.$transaction(
    recipients.map((r) => {
      const body = renderTemplate(opts.body, r.vars);
      const subject = opts.subject ? renderTemplate(opts.subject, r.vars) : null;
      body.missing.concat(subject?.missing ?? []).forEach((m) => blank.add(m));
      return db.message.create({
        data: {
          channel: opts.channel as MessageChannel,
          direction: "OUTBOUND",
          status: "QUEUED",
          toAddress: r.address,
          subject: subject?.text ?? null,
          body: bulkSms ? `${body.text}\nReply STOP to opt out.` : body.text,
          batchId,
          sentByEmail: opts.sentByEmail,
          tenantId: r.tenantId,
          vendorId: r.vendorId,
          housingAuthorityId: r.housingAuthorityId,
          propertyId: r.propertyId,
          leaseId: opts.context?.leaseId ?? r.leaseId,
          maintenanceId: opts.context?.maintenanceId,
        },
      });
    }),
  );

  const failed: SendOutcome["failed"] = [];
  let sent = 0;
  const queue = rows.map((m, i) => ({ m, name: recipients[i].name }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const r = await deliver(job.m.id, opts.statusCallback);
      if (r.ok) sent++;
      else failed.push({ name: job.name, error: r.error });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return { batchId, sent, failed, skipped, blankFields: [...blank] };
}

/** Sends one queued message through its provider and records the result. */
export async function deliver(messageId: string, statusCallback?: string) {
  const m = await db.message.findUniqueOrThrow({ where: { id: messageId }, include: { tenant: true, vendor: true, housingAuthority: true } });
  if (m.status !== "QUEUED" && m.status !== "FAILED") return { ok: true as const };
  const toName = m.tenant ? tenantName(m.tenant) : (m.vendor?.name ?? m.housingAuthority?.name);
  const r =
    m.channel === "EMAIL"
      ? await sendEmail({ to: m.toAddress!, toName, subject: m.subject || "(no subject)", text: m.body, messageId: m.id })
      : await sendSms({ to: m.toAddress!, body: m.body, statusCallback });
  if (r.ok) {
    await db.message.update({ where: { id: m.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: r.providerId, fromAddress: r.from, error: null } });
    return { ok: true as const };
  }
  await db.message.update({ where: { id: m.id }, data: { status: "FAILED", error: r.error } });
  return { ok: false as const, error: r.error };
}
