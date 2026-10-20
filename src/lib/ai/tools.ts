import type { AgentActionKind } from "@prisma/client";
import { db } from "../db";
import { balanceSheet, profitAndLoss } from "../accounting";
import { calendarItems } from "../calendar";
import { computeLeaseLedger } from "../ledger";
import { tenantName } from "../queries";
import { delinquency, rentRoll } from "../reports";
import { detailOf, proposeAction } from "../agent-actions";
import { REPORTS, reportByKey } from "../report-defs";
import { fmtCell, readParams } from "../report-kit";
import { addDays, dateToInput, money, periodOf, toDate, todayUTC } from "../utils";

/*
 * Tools the AI can call. Read tools return compact JSON (money already formatted).
 * "propose_*" tools never change anything: they queue an AgentAction for a person to approve.
 */

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[] };
export type ToolDef = { name: string; description: string; input_schema: JsonSchema };
type Ctx = { conversationId?: string | null; proposedBy: string };
type Handler = (input: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const d = (v: unknown) => {
  try {
    return str(v) ? toDate(str(v)!) : null;
  } catch {
    return null;
  }
};

const read: Record<string, { def: Omit<ToolDef, "name">; run: Handler }> = {
  portfolio_summary: {
    def: { description: "Headline numbers: units, occupancy, this month's rent billed vs collected, past-due totals (tenant vs housing authority), open work orders, open/overdue tasks, new applications, unread text replies.", input_schema: { type: "object", properties: {} } },
    run: async () => {
      const today = todayUTC();
      const period = periodOf(today);
      const [roll, late, charges, pays, wo, tasks, overdue, apps, unread] = await Promise.all([
        rentRoll(today), delinquency(today),
        db.charge.aggregate({ where: { period, type: "RENT" }, _sum: { amount: true } }),
        db.payment.aggregate({ where: { paidOn: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)) } }, _sum: { amount: true } }),
        db.maintenanceRequest.groupBy({ by: ["priority"], where: { status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } }, _count: true }),
        db.task.count({ where: { status: { not: "DONE" } } }),
        db.task.count({ where: { status: { not: "DONE" }, dueDate: { lt: today } } }),
        db.application.count({ where: { status: "NEW" } }),
        db.message.count({ where: { direction: "INBOUND", readAt: null } }),
      ]);
      const occupied = roll.filter((r) => r.status === "Occupied").length;
      return {
        today: dateToInput(today),
        units: roll.length, occupied, vacant: roll.length - occupied,
        rentBilledThisMonth: money(charges._sum.amount ?? 0), collectedThisMonth: money(pays._sum.amount ?? 0),
        pastDueTenants: money(late.filter((r) => r.party === "Tenant").reduce((s, r) => s + r.pastDue, 0)),
        pastDueHousingAuthorities: money(late.filter((r) => r.party !== "Tenant").reduce((s, r) => s + r.pastDue, 0)),
        openWorkOrders: Object.fromEntries(wo.map((w) => [w.priority, w._count])),
        openTasks: tasks, overdueTasks: overdue, newApplications: apps, unreadTextReplies: unread,
      };
    },
  },
  search: {
    def: { description: "Find tenants, properties, units, vendors, housing authorities, or applicants by name, email, phone, or unit label. Returns ids to use with other tools.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    run: async (i) => {
      const q = str(i.query) ?? "";
      const has = { contains: q, mode: "insensitive" as const };
      const [tenants, props, units, vendors, phas, apps] = await Promise.all([
        db.tenant.findMany({ where: { OR: [{ firstName: has }, { lastName: has }, { email: has }, { phone: { contains: q } }, ...(q.includes(" ") ? [{ AND: [{ firstName: { contains: q.split(" ")[0], mode: "insensitive" as const } }, { lastName: { contains: q.split(" ").slice(1).join(" "), mode: "insensitive" as const } }] }] : [])] }, take: 10 }),
        db.property.findMany({ where: { OR: [{ name: has }, { street: has }, { city: has }] }, take: 10 }),
        db.unit.findMany({ where: { label: has }, include: { property: true }, take: 10 }),
        db.vendor.findMany({ where: { OR: [{ name: has }, { trade: has }] }, take: 10 }),
        db.housingAuthority.findMany({ where: { name: has }, take: 5 }),
        db.application.findMany({ where: { OR: [{ firstName: has }, { lastName: has }, { email: has }] }, take: 5 }),
      ]);
      return [
        ...tenants.map((t) => ({ type: "tenant", id: t.id, name: tenantName(t), phone: t.phone, email: t.email })),
        ...props.map((p) => ({ type: "property", id: p.id, name: p.name, address: `${p.street}, ${p.city}` })),
        ...units.map((u) => ({ type: "unit", id: u.id, name: `${u.property.name} · ${u.label}` })),
        ...vendors.map((v) => ({ type: "vendor", id: v.id, name: v.name, trade: v.trade })),
        ...phas.map((h) => ({ type: "housing_authority", id: h.id, name: h.name })),
        ...apps.map((a) => ({ type: "applicant", id: a.id, name: `${a.firstName} ${a.lastName}`, status: a.status })),
      ];
    },
  },
  tenant_details: {
    def: { description: "Everything about one tenant: contact, case manager, text consent, current lease with rent split, balances (tenant and HAP, past due), recent payments, open work orders, recent messages and notes.", input_schema: { type: "object", properties: { tenantId: { type: "string" } }, required: ["tenantId"] } },
    run: async (i) => {
      const t = await db.tenant.findUnique({
        where: { id: str(i.tenantId) ?? "" },
        include: {
          leases: { orderBy: { startDate: "desc" }, take: 2, include: { unit: { include: { property: true } }, charges: true, payments: { orderBy: { paidOn: "desc" } }, housingAuthority: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 5 },
          noteEntries: { orderBy: { createdAt: "desc" }, take: 5 },
          maintenanceRequests: { where: { status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } }, take: 5 },
        },
      });
      if (!t) return { error: "No tenant with that id" };
      return {
        id: t.id, name: tenantName(t), email: t.email, phone: t.phone, veteran: t.isVeteran, okToText: t.smsConsent, emailAnnouncementsOptOut: t.emailOptOut,
        caseManager: t.caseManagerName ? { name: t.caseManagerName, phone: t.caseManagerPhone, email: t.caseManagerEmail } : null,
        portal: t.portalEnabled ? (t.clerkUserId ? "active" : "invited") : "not invited",
        leases: t.leases.map((l) => {
          const led = computeLeaseLedger(l.charges, l.payments);
          return {
            leaseId: l.id, status: l.status, unitId: l.unitId, unit: `${l.unit.property.name} · ${l.unit.label}`, start: dateToInput(l.startDate), end: l.endDate ? dateToInput(l.endDate) : "month-to-month",
            contractRent: money(l.contractRent), tenantPays: money(l.tenantPortion), hapPays: money(l.hapAmount), housingAuthority: l.housingAuthority?.name ?? null, dueDay: l.dueDay,
            nextRecert: l.nextRecertDate ? dateToInput(l.nextRecertDate) : null,
            tenantBalance: money(led.tenant.balance), tenantPastDue: money(led.tenant.pastDue), oldestTenantPastDue: led.tenant.oldestPastDue ? dateToInput(led.tenant.oldestPastDue) : null,
            hapBalance: money(led.authority.balance), hapPastDue: money(led.authority.pastDue),
            recentPayments: l.payments.slice(0, 5).map((p) => ({ date: dateToInput(p.paidOn), amount: money(p.amount), from: p.party === "TENANT" ? "tenant" : "housing authority", method: p.method })),
          };
        }),
        openWorkOrders: t.maintenanceRequests.map((w) => ({ id: w.id, title: w.title, status: w.status, priority: w.priority })),
        recentMessages: t.messages.map((m) => ({ date: dateToInput(m.createdAt), direction: m.direction, channel: m.channel, status: m.status, subject: m.subject, text: m.body.slice(0, 300) })),
        recentNotes: t.noteEntries.map((n) => ({ date: dateToInput(n.createdAt), text: n.body.slice(0, 300) })),
      };
    },
  },
  delinquency: {
    def: { description: "Everyone (tenant or housing authority) with money past due, with aging buckets and contact info, largest first.", input_schema: { type: "object", properties: {} } },
    run: async () =>
      (await delinquency()).map((r) => ({
        leaseId: r.leaseId, unit: `${r.property} · ${r.unit}`, tenant: r.tenant, owedBy: r.party === "Tenant" ? "tenant" : r.payer, phone: r.phone, pastDue: money(r.pastDue),
        oldestUnpaid: r.oldestPastDue ? dateToInput(r.oldestPastDue) : null, days0to30: money(r.aging.current + r.aging.d30), days31to60: money(r.aging.d60), days61to90: money(r.aging.d90), over90: money(r.aging.over90),
      })),
  },
  rent_roll: {
    def: { description: "Every unit with tenant, lease dates, contract rent, tenant portion, HAP, and balance. Optionally one property.", input_schema: { type: "object", properties: { propertyId: { type: "string" } } } },
    run: async (i) => {
      const pid = str(i.propertyId);
      const prop = pid ? await db.property.findUnique({ where: { id: pid } }) : null;
      return (await rentRoll())
        .filter((r) => !prop || r.property === prop.name)
        .map((r) => ({ unit: `${r.property} · ${r.unit}`, status: r.status, tenant: r.tenant, leaseId: r.leaseId, contractRent: money(r.contractRent), tenantPortion: money(r.tenantPortion), hap: money(r.hapAmount), balance: money(r.balance), leaseEnd: r.leaseEnd ? dateToInput(r.leaseEnd) : null }));
    },
  },
  work_orders: {
    def: { description: "Maintenance work orders. status: open (default), closed, or all.", input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "closed", "all"] }, propertyId: { type: "string" } } } },
    run: async (i) => {
      const s = str(i.status) ?? "open";
      const rows = await db.maintenanceRequest.findMany({
        where: {
          ...(s === "open" ? { status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } } : s === "closed" ? { status: { in: ["COMPLETED", "CANCELLED"] } } : {}),
          ...(str(i.propertyId) ? { unit: { propertyId: str(i.propertyId) } } : {}),
        },
        orderBy: { reportedOn: "desc" },
        take: 40,
        include: { unit: { include: { property: true } }, vendor: true, submittedBy: true },
      });
      return rows.map((w) => ({ id: w.id, title: w.title, unitId: w.unitId, unit: `${w.unit.property.name} · ${w.unit.label}`, status: w.status, priority: w.priority, reported: dateToInput(w.reportedOn), scheduled: w.scheduledOn ? dateToInput(w.scheduledOn) : null, vendor: w.vendor?.name ?? null, fromTenant: w.submittedBy ? tenantName(w.submittedBy) : null, cost: w.cost != null ? money(w.cost) : null }));
    },
  },
  upcoming: {
    def: { description: "Calendar for the next N days (default 14): events, inspections, cure deadlines, repairs, lease starts/ends, recertifications, tasks, rent due days.", input_schema: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } } } },
    run: async (i) => {
      const n = Math.min(90, Math.max(1, Number(i.days) || 14));
      const today = todayUTC();
      return (await calendarItems(today, addDays(today, n))).map((c) => ({ date: dateToInput(c.day), kind: c.kind, title: c.title }));
    },
  },
  tasks: {
    def: { description: "Tasks. status: open (default) or done.", input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "done"] } } } },
    run: async (i) =>
      (await db.task.findMany({ where: { status: str(i.status) === "done" ? "DONE" : { not: "DONE" } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], take: 50 })).map((t) => ({
        id: t.id, title: t.title, due: t.dueDate ? dateToInput(t.dueDate) : null, priority: t.priority, status: t.status, repeats: t.recurrence,
      })),
  },
  financial_report: {
    def: {
      description: "Profit & loss (pl) for a date range, or balance sheet (bs) as of a date. Optional propertyId. Dates YYYY-MM-DD; defaults: this year to today.",
      input_schema: { type: "object", properties: { report: { type: "string", enum: ["pl", "bs"] }, from: { type: "string" }, to: { type: "string" }, propertyId: { type: "string" } }, required: ["report"] },
    },
    run: async (i) => {
      const today = todayUTC();
      const to = d(i.to) ?? today;
      const from = d(i.from) ?? new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
      const pid = str(i.propertyId) ?? null;
      if (i.report === "bs") {
        const r = await balanceSheet(to, pid);
        const fmt = (rows: { code: string; name: string; balance: number }[]) => rows.map((a) => ({ account: `${a.code} ${a.name}`, balance: money(a.balance) }));
        return { asOf: dateToInput(to), assets: fmt(r.assets), liabilities: fmt(r.liabilities), equity: fmt(r.equity), currentEarnings: money(r.earnings), totalAssets: money(r.totalAssets), balanced: r.balanced };
      }
      const r = await profitAndLoss(from, to, pid);
      return {
        from: dateToInput(from), to: dateToInput(to),
        income: r.income.map((a) => ({ account: `${a.code} ${a.name}`, amount: money(a.balance) })), expenses: r.expenses.map((a) => ({ account: `${a.code} ${a.name}`, amount: money(a.balance) })),
        totalIncome: money(r.totalIncome), totalExpenses: money(r.totalExpenses), netIncome: money(r.netIncome),
      };
    },
  },
  run_report: {
    def: {
      description:
        "Run one of the app's reports and get its numbers. Reports: " +
        REPORTS.map((r) => `${r.key} (${r.title}${r.mode === "asOf" ? ", as of a date" : ", date range"})`).join("; ") +
        ". Dates YYYY-MM-DD; for as-of reports pass only `to`. Defaults vary by report (often year to date). Optional propertyId (from search).",
      input_schema: {
        type: "object",
        properties: { report: { type: "string", enum: REPORTS.map((r) => r.key) }, from: { type: "string" }, to: { type: "string" }, propertyId: { type: "string" } },
        required: ["report"],
      },
    },
    run: async (i) => {
      const def = reportByKey(String(i.report ?? ""));
      if (!def) return { error: "Unknown report" };
      const property = str(i.propertyId) ? await db.property.findUnique({ where: { id: str(i.propertyId)! }, select: { id: true, name: true } }) : null;
      const p = readParams({ from: str(i.from), to: str(i.to), propertyId: property?.id }, def.defaultRange, () => property?.name ?? null);
      if (def.mode === "asOf") p.from = p.to;
      const r = await def.build(p);
      const qs = new URLSearchParams({ from: dateToInput(p.from), to: dateToInput(p.to), ...(p.propertyId ? { propertyId: p.propertyId } : {}) });
      return {
        report: r.title, period: r.period, link: `/reports/${def.key}?${qs}`,
        headline: r.kpis.map((k) => `${k.label}: ${k.value}${k.sub ? ` (${k.sub})` : ""}`),
        tables: r.tables.map((t) => {
          const cols = t.columns.filter((c) => c.fmt !== "bar");
          return {
            title: t.title, totalRows: t.rows.length,
            rows: t.rows.slice(0, 40).map((row) => Object.fromEntries(cols.map((c) => [c.label || c.key, fmtCell(c.fmt, row[c.key])]))),
          };
        }),
        notes: r.notes,
      };
    },
  },
  applications: {
    def: { description: "Rental applications. Default: new, screening, and approved.", input_schema: { type: "object", properties: { status: { type: "string", enum: ["NEW", "SCREENING", "APPROVED", "DENIED", "WITHDRAWN", "CONVERTED"] } } } },
    run: async (i) =>
      (await db.application.findMany({
        where: str(i.status) ? { status: str(i.status) as never } : { status: { in: ["NEW", "SCREENING", "APPROVED"] } },
        orderBy: { createdAt: "desc" }, take: 30, include: { listing: { include: { unit: { include: { property: true } } } } },
      })).map((a) => ({
        id: a.id, name: `${a.firstName} ${a.lastName}`, for: `${a.listing.unit.property.name} · ${a.listing.unit.label}`, received: dateToInput(a.createdAt), status: a.status,
        voucher: a.hasVoucher ? a.voucherType : null, monthlyIncome: a.monthlyIncome != null ? money(a.monthlyIncome) : null,
        checklist: { id: a.idVerified, income: a.incomeVerified, voucher: a.voucherVerified, reference: a.referenceChecked, background: a.backgroundReviewed },
      })),
  },
  recent_messages: {
    def: { description: "Recent emails/texts/calls, newest first. Optional tenantId. Includes unread text replies from tenants.", input_schema: { type: "object", properties: { tenantId: { type: "string" }, unreadOnly: { type: "boolean" } } } },
    run: async (i) =>
      (await db.message.findMany({
        where: { ...(str(i.tenantId) ? { tenantId: str(i.tenantId) } : {}), ...(i.unreadOnly ? { direction: "INBOUND", readAt: null } : {}) },
        orderBy: { createdAt: "desc" }, take: 25, include: { tenant: true, vendor: true },
      })).map((m) => ({ date: dateToInput(m.createdAt), with: m.tenant ? tenantName(m.tenant) : (m.vendor?.name ?? m.toAddress ?? m.fromAddress), tenantId: m.tenantId, direction: m.direction, channel: m.channel, status: m.status, subject: m.subject, text: m.body.slice(0, 400) })),
  },
};

const proposeSchemas: Record<string, { kind: AgentActionKind; description: string; properties: Record<string, unknown>; required: string[] }> = {
  propose_send_message: {
    kind: "SEND_MESSAGE",
    description: "Draft an email or text for the user to approve. audience.kind: tenant | case-manager (id = tenantId) | property | all-tenants | vendor | pha. Texts only reach tenants marked OK to text. Merge fields like {{firstName}} {{balance}} {{rent}} {{dueDate}} {{property}} {{unit}} are filled per recipient.",
    properties: {
      audience: { type: "object", properties: { kind: { type: "string", enum: ["tenant", "case-manager", "property", "all-tenants", "vendor", "pha"] }, id: { type: "string" } }, required: ["kind"] },
      channel: { type: "string", enum: ["EMAIL", "SMS"] }, subject: { type: "string" }, body: { type: "string" },
    },
    required: ["audience", "channel", "body"],
  },
  propose_create_task: {
    kind: "CREATE_TASK",
    description: "Suggest a task. dueDate YYYY-MM-DD. links can attach it to a propertyId, unitId, tenantId, leaseId, maintenanceId, vendorId, or housingAuthorityId.",
    properties: { title: { type: "string" }, description: { type: "string" }, dueDate: { type: "string" }, priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] }, links: { type: "object" } },
    required: ["title"],
  },
  propose_create_work_order: {
    kind: "CREATE_WORK_ORDER",
    description: "Suggest opening a maintenance work order for a unit (use the unitId from search/tenant_details).",
    properties: { unitId: { type: "string" }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "EMERGENCY"] }, vendorId: { type: "string" } },
    required: ["unitId", "title"],
  },
  propose_add_note: {
    kind: "ADD_NOTE",
    description: "Suggest an internal note on a record. links must include at least one of propertyId, unitId, tenantId, leaseId, maintenanceId, vendorId, housingAuthorityId.",
    properties: { body: { type: "string" }, links: { type: "object" } },
    required: ["body", "links"],
  },
  propose_record_payment: {
    kind: "RECORD_PAYMENT",
    description: "Suggest recording a payment the user told you about. amountCents is an integer number of cents. party TENANT or HOUSING_AUTHORITY. paidOn YYYY-MM-DD.",
    properties: { leaseId: { type: "string" }, party: { type: "string", enum: ["TENANT", "HOUSING_AUTHORITY"] }, amountCents: { type: "integer" }, paidOn: { type: "string" }, method: { type: "string", enum: ["ACH", "CHECK", "CASH", "CARD", "MONEY_ORDER", "OTHER"] }, reference: { type: "string" } },
    required: ["leaseId", "party", "amountCents", "paidOn", "method"],
  },
  propose_post_rent: { kind: "POST_RENT", description: "Suggest posting a month's rent charges (period YYYY-MM).", properties: { period: { type: "string" } }, required: ["period"] },
  propose_apply_late_fees: { kind: "APPLY_LATE_FEES", description: "Suggest applying late fees for a month (period YYYY-MM).", properties: { period: { type: "string" } }, required: ["period"] },
};

export const toolDefs: ToolDef[] = [
  ...Object.entries(read).map(([name, t]) => ({ name, ...t.def })),
  ...Object.entries(proposeSchemas).map(([name, p]) => ({
    name,
    description: `${p.description} This only creates a proposal the user must approve; it does NOT do it.`,
    input_schema: { type: "object" as const, properties: { ...p.properties, reason: { type: "string", description: "One sentence on why" } }, required: p.required },
  })),
];

export const isProposeTool = (name: string) => name in proposeSchemas;

export async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  if (name in read) return read[name].run(input, ctx);
  const p = proposeSchemas[name];
  if (!p) return { error: `Unknown tool ${name}` };
  const { reason, ...payload } = input;
  const a = await proposeAction(p.kind, payload, { proposedBy: ctx.proposedBy, conversationId: ctx.conversationId, reason: typeof reason === "string" ? reason : null });
  return { proposed: true, actionId: a.id, summary: a.summary, detail: detailOf(p.kind, a.payload), reason: a.reason, note: "Queued for the user's approval. It has NOT happened yet; say so." };
}

export const toolLabel = (name: string, input: Record<string, unknown>) =>
  ({
    portfolio_summary: "Checked the portfolio summary",
    search: `Searched for “${String(input.query ?? "")}”`,
    tenant_details: "Looked up a tenant",
    delinquency: "Checked who's past due",
    rent_roll: "Read the rent roll",
    work_orders: "Checked work orders",
    upcoming: "Checked the calendar",
    tasks: "Checked tasks",
    financial_report: input.report === "bs" ? "Ran the balance sheet" : "Ran the profit & loss",
    applications: "Checked applications",
    run_report: `Ran the ${reportByKey(String(input.report ?? ""))?.title.toLowerCase() ?? "report"} report`,
    recent_messages: "Read recent messages",
  })[name] ?? (isProposeTool(name) ? "Drafted an action for your approval" : name);

