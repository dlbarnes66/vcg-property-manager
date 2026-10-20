/*
 * Database queries behind the reports. Each returns plain numbers (cents, counts, days) that
 * report-defs.ts turns into tables for the screen, CSV, and PDF.
 */
import type { Prisma } from "@prisma/client";
import { CODES, naturalBalance, syncLedger } from "./accounting";
import { db } from "./db";
import { computePartyLedger, type Aging } from "./ledger";
import { openFailures, tenantName } from "./queries";
import {
  avg, capRate, coveredDays, daysIn, inspectionStatus, leaseInterval, median, recertStatus, vacancyLoss, worstTone, type Status, type Tone,
} from "./report-math";
import { monthsIn } from "./reports";
import { addDays, daysBetween } from "./utils";

export type Range = { from: Date; to: Date; propertyId: string | null };
const end = (to: Date) => addDays(to, 1); // exclusive upper bound for "lt"
const unitWhere = (r: { propertyId: string | null }): Prisma.UnitWhereInput => (r.propertyId ? { propertyId: r.propertyId } : {});
const inForce = (l: { status: string; startDate: Date; endDate: Date | null }, asOf: Date) =>
  l.status === "ACTIVE" && l.startDate <= asOf && (!l.endDate || l.endDate >= asOf);
const isVoucher = (l: { housingAuthorityId: string | null; hapAmount: number }) => !!l.housingAuthorityId || l.hapAmount > 0;

/* ------------------------------------------------------------------------------------------------
 * HAP by housing authority
 * ---------------------------------------------------------------------------------------------- */

export type HapLease = {
  leaseId: string; property: string; unit: string; tenant: string; authority: string; voucherNumber: string | null;
  hapMonthly: number; inForce: boolean; billed: number; received: number; pastDue: number; oldestPastDue: Date | null; aging: Aging;
  failedInspection: { cureByDate: Date | null } | null;
};
export type HapAuthority = {
  authority: string; authorityId: string | null; leases: number; hapMonthly: number; billed: number; received: number;
  pastDue: number; aging: Aging; oldestPastDue: Date | null;
};

export async function hapData(r: Range) {
  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE", "ENDED"] }, OR: [{ housingAuthorityId: { not: null } }, { hapAmount: { gt: 0 } }], unit: unitWhere(r) },
    include: {
      housingAuthority: true, tenant: true,
      unit: { include: { property: true, inspections: true } },
      charges: { where: { party: "HOUSING_AUTHORITY", dueDate: { lt: end(r.to) } } },
      payments: { where: { party: "HOUSING_AUTHORITY", paidOn: { lt: end(r.to) } } },
    },
  });
  const rows: HapLease[] = leases.map((l) => {
    const led = computePartyLedger("HOUSING_AUTHORITY", l.charges, l.payments, r.to);
    const fail = openFailures(l.unit.inspections.filter((i) => (i.completedDate ?? i.scheduledDate) <= r.to))[0];
    return {
      leaseId: l.id, property: l.unit.property.name, unit: l.unit.label, tenant: tenantName(l.tenant),
      authority: l.housingAuthority?.name ?? "No housing authority set", voucherNumber: l.voucherNumber,
      hapMonthly: l.hapAmount, inForce: inForce(l, r.to),
      billed: l.charges.filter((c) => c.dueDate >= r.from).reduce((s, c) => s + c.amount, 0),
      received: l.payments.filter((p) => p.paidOn >= r.from).reduce((s, p) => s + p.amount, 0),
      pastDue: led.pastDue, oldestPastDue: led.oldestPastDue, aging: led.aging,
      failedInspection: fail ? { cureByDate: fail.cureByDate } : null,
    };
  });
  const by = new Map<string, HapAuthority>();
  for (const [i, l] of rows.entries()) {
    const a = by.get(l.authority) ?? {
      authority: l.authority, authorityId: leases[i].housingAuthorityId, leases: 0, hapMonthly: 0, billed: 0, received: 0, pastDue: 0,
      aging: { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }, oldestPastDue: null,
    };
    if (l.inForce) {
      a.leases++;
      a.hapMonthly += l.hapMonthly;
    }
    a.billed += l.billed;
    a.received += l.received;
    a.pastDue += l.pastDue;
    for (const k of Object.keys(a.aging) as (keyof Aging)[]) a.aging[k] += l.aging[k];
    if (l.oldestPastDue && (!a.oldestPastDue || l.oldestPastDue < a.oldestPastDue)) a.oldestPastDue = l.oldestPastDue;
    by.set(l.authority, a);
  }
  const authorities = [...by.values()].sort((a, b) => b.pastDue - a.pastDue || a.authority.localeCompare(b.authority));
  return { leases: rows, authorities };
}

/* ------------------------------------------------------------------------------------------------
 * HUD-VASH compliance: recertifications and inspections for voucher households in force
 * ---------------------------------------------------------------------------------------------- */

const COUNTS_FOR_ANNUAL = new Set(["HQS_INITIAL", "HQS_ANNUAL", "NSPIRE", "REINSPECTION"]);

export type ComplianceRow = {
  leaseId: string; property: string; unit: string; tenant: string; authority: string | null; caseManager: string | null;
  nextRecert: Date | null; recert: Status; lastPass: Date | null; nextInspectionDue: Date | null; scheduled: Date | null;
  cureBy: Date | null; inspection: Status; tone: Tone;
};

export async function complianceData(r: { to: Date; propertyId: string | null }) {
  const asOf = r.to;
  const leases = await db.lease.findMany({
    where: { status: "ACTIVE", startDate: { lte: asOf }, OR: [{ endDate: null }, { endDate: { gte: asOf } }], unit: unitWhere(r) },
    include: { tenant: true, housingAuthority: true, unit: { include: { property: true, inspections: true } } },
  });
  const rows: ComplianceRow[] = leases.filter(isVoucher).map((l) => {
    const insp = l.unit.inspections.filter((i) => (i.completedDate ?? i.scheduledDate) <= asOf || i.result === "PENDING");
    const lastPass = insp
      .filter((i) => i.result === "PASS" && COUNTS_FOR_ANNUAL.has(i.type) && i.completedDate && i.completedDate <= asOf)
      .reduce<Date | null>((m, i) => (!m || i.completedDate! > m ? i.completedDate! : m), null);
    const scheduled = insp
      .filter((i) => i.result === "PENDING" && !i.completedDate && i.scheduledDate >= addDays(asOf, -30))
      .reduce<Date | null>((m, i) => (!m || i.scheduledDate < m ? i.scheduledDate : m), null);
    const fail = openFailures(insp.filter((i) => i.result !== "PENDING"))[0];
    const recert = recertStatus(l.nextRecertDate, asOf);
    const inspection = inspectionStatus({ lastPass, scheduled, hasOpenFail: !!fail, openFailCureBy: fail?.cureByDate }, asOf);
    return {
      leaseId: l.id, property: l.unit.property.name, unit: l.unit.label, tenant: tenantName(l.tenant),
      authority: l.housingAuthority?.name ?? null, caseManager: l.tenant.caseManagerName,
      nextRecert: l.nextRecertDate, recert, lastPass, nextInspectionDue: inspection.nextDue, scheduled, cureBy: fail?.cureByDate ?? null,
      inspection, tone: worstTone(recert.tone, inspection.tone),
    };
  });
  rows.sort((a, b) => Math.min(a.recert.rank, a.inspection.rank) - Math.min(b.recert.rank, b.inspection.rank) || a.property.localeCompare(b.property) || a.unit.localeCompare(b.unit));
  return {
    rows,
    recertOverdue: rows.filter((x) => x.recert.tone === "bad").length,
    recertSoon: rows.filter((x) => x.recert.tone === "warn" && x.nextRecert).length,
    recertMissing: rows.filter((x) => !x.nextRecert).length,
    inspectionIssues: rows.filter((x) => x.inspection.tone === "bad").length,
    inspectionSoon: rows.filter((x) => x.inspection.code === "soon-unscheduled").length,
  };
}

/** Inspections completed in a range, by result (for the investor summary). */
export async function inspectionsCompleted(r: Range) {
  const list = await db.inspection.findMany({ where: { completedDate: { gte: r.from, lt: end(r.to) }, unit: unitWhere(r) }, select: { result: true } });
  return { total: list.length, passed: list.filter((i) => i.result === "PASS").length, failed: list.filter((i) => i.result === "FAIL").length };
}

/* ------------------------------------------------------------------------------------------------
 * Voucher mix (rent split) as of a date
 * ---------------------------------------------------------------------------------------------- */

export async function voucherMixData(r: { to: Date; propertyId: string | null }) {
  const props = await db.property.findMany({
    where: r.propertyId ? { id: r.propertyId } : {},
    orderBy: { name: "asc" },
    include: { units: { include: { leases: { where: { status: "ACTIVE", startDate: { lte: r.to }, OR: [{ endDate: null }, { endDate: { gte: r.to } }] }, include: { tenant: true } } } } },
  });
  return props.map((p) => {
    const leases = p.units.flatMap((u) => u.leases.slice(0, 1));
    const v = leases.filter(isVoucher);
    return {
      propertyId: p.id, property: p.name, units: p.units.length, occupied: leases.length,
      voucher: v.length, veterans: leases.filter((l) => l.tenant.isVeteran).length,
      contractRent: leases.reduce((s, l) => s + l.contractRent, 0),
      tenantPortion: leases.reduce((s, l) => s + l.tenantPortion, 0),
      hap: leases.reduce((s, l) => s + l.hapAmount, 0),
      voucherTenantPortion: v.reduce((s, l) => s + l.tenantPortion, 0),
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Property performance (accrual, from the books)
 * ---------------------------------------------------------------------------------------------- */

export type PerfRow = {
  propertyId: string | null; property: string; units: number; occupied: number; gpr: number; rentBilled: number; collected: number;
  income: number; opex: number; noi: number; interest: number; principal: number; debtService: number; cashFlow: number;
  purchasePrice: number | null; capRate: number | null;
};

export async function performanceData(r: Range) {
  await syncLedger();
  const days = daysIn(r.from, r.to);
  const months = days / (365 / 12);
  const [props, accounts, sums, charges, payments] = await Promise.all([
    db.property.findMany({
      where: r.propertyId ? { id: r.propertyId } : {},
      orderBy: { name: "asc" },
      include: { units: { include: { leases: { where: { status: "ACTIVE", startDate: { lte: r.to }, OR: [{ endDate: null }, { endDate: { gte: r.to } }] } } } } },
    }),
    db.account.findMany(),
    db.journalLine.groupBy({
      by: ["propertyId", "accountId"],
      where: { entry: { date: { gte: r.from, lt: end(r.to) } }, ...(r.propertyId ? { propertyId: r.propertyId } : {}) },
      _sum: { debit: true, credit: true },
    }),
    db.charge.groupBy({ by: ["leaseId"], where: { type: "RENT", dueDate: { gte: r.from, lt: end(r.to) }, lease: { unit: unitWhere(r) } }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["leaseId"], where: { paidOn: { gte: r.from, lt: end(r.to) }, lease: { unit: unitWhere(r) } }, _sum: { amount: true } }),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const leaseProp = new Map(
    (await db.lease.findMany({ where: { id: { in: [...charges, ...payments].map((c) => c.leaseId) } }, select: { id: true, unit: { select: { propertyId: true } } } })).map((l) => [l.id, l.unit.propertyId]),
  );
  const blank = (propertyId: string | null, property: string): PerfRow => ({
    propertyId, property, units: 0, occupied: 0, gpr: 0, rentBilled: 0, collected: 0, income: 0, opex: 0, noi: 0, interest: 0, principal: 0, debtService: 0, cashFlow: 0, purchasePrice: null, capRate: null,
  });
  const rows = new Map<string | null, PerfRow>();
  for (const p of props) {
    const row = blank(p.id, p.name);
    row.units = p.units.length;
    row.occupied = p.units.filter((u) => u.leases.length).length;
    row.gpr = Math.round(p.units.reduce((s, u) => s + (u.marketRent ?? u.leases[0]?.contractRent ?? 0), 0) * months);
    row.purchasePrice = p.purchasePrice;
    rows.set(p.id, row);
  }
  for (const s of sums) {
    const a = acct.get(s.accountId);
    if (!a) continue;
    const key = s.propertyId && rows.has(s.propertyId) ? s.propertyId : null;
    if (key === null && r.propertyId) continue;
    if (!rows.has(key)) rows.set(key, blank(null, "Not assigned to a property"));
    const row = rows.get(key)!;
    const dr = s._sum.debit ?? 0;
    const cr = s._sum.credit ?? 0;
    if (a.type === "INCOME") row.income += naturalBalance(a.type, dr, cr);
    else if (a.type === "EXPENSE" && a.code === CODES.MORTGAGE_INTEREST) row.interest += dr - cr;
    else if (a.type === "EXPENSE") row.opex += dr - cr;
    else if (a.code === CODES.MORTGAGE) row.principal += dr - cr; // paying down the loan debits Mortgage Payable
  }
  for (const c of charges) {
    const row = rows.get(leaseProp.get(c.leaseId) ?? "");
    if (row) row.rentBilled += c._sum.amount ?? 0;
  }
  for (const p of payments) {
    const row = rows.get(leaseProp.get(p.leaseId) ?? "");
    if (row) row.collected += p._sum.amount ?? 0;
  }
  const out = [...rows.values()];
  for (const row of out) {
    row.noi = row.income - row.opex;
    row.principal = Math.max(0, row.principal);
    row.debtService = row.interest + row.principal;
    row.cashFlow = row.noi - row.debtService;
    row.capRate = capRate(row.noi, days, row.purchasePrice);
  }
  const unassigned = rows.get(null);
  const listed = [...out.filter((x) => x.propertyId !== null), ...(unassigned && (unassigned.income || unassigned.opex || unassigned.interest || unassigned.principal) ? [unassigned] : [])];
  const total = listed.reduce((t, x) => {
    for (const k of ["units", "occupied", "gpr", "rentBilled", "collected", "income", "opex", "noi", "interest", "principal", "debtService", "cashFlow"] as const) t[k] += x[k];
    t.purchasePrice = (t.purchasePrice ?? 0) + (x.purchasePrice ?? 0);
    return t;
  }, blank(null, "Total"));
  total.capRate = capRate(listed.filter((x) => x.purchasePrice).reduce((s, x) => s + x.noi, 0), days, total.purchasePrice);
  return { rows: listed, total, days };
}

/* ------------------------------------------------------------------------------------------------
 * Collections by month (billed vs collected, tenant vs HAP)
 * ---------------------------------------------------------------------------------------------- */

export async function collectionsData(r: Range) {
  const [charges, payments] = await Promise.all([
    db.charge.findMany({ where: { dueDate: { gte: r.from, lt: end(r.to) }, type: { not: "SECURITY_DEPOSIT" }, lease: { unit: unitWhere(r) } }, select: { amount: true, dueDate: true, party: true } }),
    db.payment.findMany({ where: { paidOn: { gte: r.from, lt: end(r.to) }, lease: { unit: unitWhere(r) } }, select: { amount: true, paidOn: true, party: true } }),
  ]);
  const months = monthsIn(r.from, r.to).map((period) => ({ period, tenantBilled: 0, tenantCollected: 0, hapBilled: 0, hapCollected: 0 }));
  const at = (d: Date) => months.find((m) => m.period === d.toISOString().slice(0, 7));
  for (const c of charges) {
    const m = at(c.dueDate);
    if (m) m[c.party === "TENANT" ? "tenantBilled" : "hapBilled"] += c.amount;
  }
  for (const p of payments) {
    const m = at(p.paidOn);
    if (m) m[p.party === "TENANT" ? "tenantCollected" : "hapCollected"] += p.amount;
  }
  const sum = (k: keyof (typeof months)[number]) => months.reduce((s, m) => s + (m[k] as number), 0);
  return { months, tenantBilled: sum("tenantBilled"), tenantCollected: sum("tenantCollected"), hapBilled: sum("hapBilled"), hapCollected: sum("hapCollected") };
}

/* ------------------------------------------------------------------------------------------------
 * Vacancy loss
 * ---------------------------------------------------------------------------------------------- */

export async function vacancyData(r: Range) {
  const units = await db.unit.findMany({
    where: unitWhere(r),
    orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
    include: { property: true, leases: { where: { status: { in: ["ACTIVE", "ENDED"] }, startDate: { lte: r.to } }, orderBy: { startDate: "desc" } } },
  });
  const rows = units.map((u) => {
    const ownedFrom = u.property.purchaseDate ?? new Date(Date.UTC(u.createdAt.getUTCFullYear(), u.createdAt.getUTCMonth(), u.createdAt.getUTCDate()));
    const from = ownedFrom > r.from ? ownedFrom : r.from;
    const total = from > r.to ? 0 : daysIn(from, r.to);
    const occupied = total ? coveredDays(u.leases.map(leaseInterval), from, r.to) : 0;
    const vacant = total - occupied;
    const rent = u.marketRent ?? u.leases[0]?.contractRent ?? 0;
    const vacantNow = !u.leases.some((l) => inForce(l, r.to));
    return { property: u.property.name, unit: u.label, rent, total, occupied, vacant, loss: vacancyLoss(rent, vacant), vacantNow, rentMissing: !u.marketRent && !u.leases.length };
  });
  return {
    rows,
    unitDays: rows.reduce((s, x) => s + x.total, 0),
    occupiedDays: rows.reduce((s, x) => s + x.occupied, 0),
    loss: rows.reduce((s, x) => s + x.loss, 0),
    vacantNow: rows.filter((x) => x.vacantNow).length,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Work orders
 * ---------------------------------------------------------------------------------------------- */

export async function workOrderData(r: Range) {
  const list = await db.maintenanceRequest.findMany({
    where: {
      unit: unitWhere(r),
      OR: [
        { reportedOn: { gte: r.from, lt: end(r.to) } },
        { completedOn: { gte: r.from, lt: end(r.to) } },
        { reportedOn: { lt: end(r.to) }, status: { not: "CANCELLED" }, OR: [{ completedOn: null }, { completedOn: { gt: r.to } }] },
      ],
    },
    include: { unit: { include: { property: true } }, vendor: true },
  });
  const opened = list.filter((w) => w.reportedOn >= r.from && w.reportedOn < end(r.to));
  const completed = list.filter((w) => w.completedOn && w.completedOn >= r.from && w.completedOn < end(r.to) && w.status === "COMPLETED");
  const openAtEnd = list.filter((w) => w.reportedOn < end(r.to) && w.status !== "CANCELLED" && (!w.completedOn || w.completedOn > r.to));
  const close = (w: (typeof list)[number]) => Math.max(0, daysBetween(w.reportedOn, w.completedOn!));
  const closeDays = completed.map(close);

  const byProp = new Map<string, { property: string; opened: number; completed: number; closeDays: number[]; open: number; urgentOpen: number; cost: number }>();
  const row = (name: string) => byProp.get(name) ?? byProp.set(name, { property: name, opened: 0, completed: 0, closeDays: [], open: 0, urgentOpen: 0, cost: 0 }).get(name)!;
  for (const w of opened) row(w.unit.property.name).opened++;
  for (const w of completed) {
    const x = row(w.unit.property.name);
    x.completed++;
    x.closeDays.push(close(w));
    x.cost += w.cost ?? 0;
  }
  for (const w of openAtEnd) {
    const x = row(w.unit.property.name);
    x.open++;
    if (w.priority === "HIGH" || w.priority === "EMERGENCY") x.urgentOpen++;
  }
  const months = monthsIn(r.from, r.to).map((period) => ({
    period,
    opened: opened.filter((w) => w.reportedOn.toISOString().startsWith(period)).length,
    completed: completed.filter((w) => w.completedOn!.toISOString().startsWith(period)).length,
  }));
  const aging = openAtEnd
    .map((w) => ({ id: w.id, property: w.unit.property.name, unit: w.unit.label, title: w.title, priority: w.priority, status: w.status, reportedOn: w.reportedOn, age: Math.max(0, daysBetween(w.reportedOn, r.to)), vendor: w.vendor?.name ?? null }))
    .sort((a, b) => b.age - a.age);
  return {
    opened: opened.length, completed: completed.length, open: openAtEnd.length,
    urgentOpen: openAtEnd.filter((w) => w.priority === "HIGH" || w.priority === "EMERGENCY").length,
    avgClose: avg(closeDays), medianClose: median(closeDays), cost: completed.reduce((s, w) => s + (w.cost ?? 0), 0),
    byProperty: [...byProp.values()].sort((a, b) => a.property.localeCompare(b.property)).map((x) => ({ ...x, avgClose: avg(x.closeDays) })),
    months, aging,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Spending: by category and property (from the books), by vendor (bills + unbilled work orders)
 * ---------------------------------------------------------------------------------------------- */

export async function spendingData(r: Range) {
  await syncLedger();
  const [lines, accounts, props, bills, wos] = await Promise.all([
    db.journalLine.groupBy({
      by: ["propertyId", "accountId"],
      where: { account: { type: "EXPENSE" }, entry: { date: { gte: r.from, lt: end(r.to) } }, ...(r.propertyId ? { propertyId: r.propertyId } : {}) },
      _sum: { debit: true, credit: true },
    }),
    db.account.findMany({ where: { type: "EXPENSE" } }),
    db.property.findMany({ select: { id: true, name: true } }),
    db.bill.findMany({ where: { status: { not: "VOID" }, billDate: { gte: r.from, lt: end(r.to) }, ...(r.propertyId ? { propertyId: r.propertyId } : {}) }, include: { vendor: true } }),
    db.maintenanceRequest.findMany({
      where: { status: "COMPLETED", completedOn: { gte: r.from, lt: end(r.to) }, cost: { gt: 0 }, bills: { none: { status: { not: "VOID" } } }, unit: unitWhere(r) },
      include: { vendor: true },
    }),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const byAccount = new Map<string, { account: string; amount: number }>();
  const byProperty = new Map<string, { property: string; amount: number }>();
  for (const l of lines) {
    const a = acct.get(l.accountId);
    if (!a) continue;
    const amt = (l._sum.debit ?? 0) - (l._sum.credit ?? 0);
    const ak = `${a.code} ${a.name}`;
    byAccount.set(ak, { account: ak, amount: (byAccount.get(ak)?.amount ?? 0) + amt });
    const pk = (l.propertyId && propName.get(l.propertyId)) || "Not assigned to a property";
    byProperty.set(pk, { property: pk, amount: (byProperty.get(pk)?.amount ?? 0) + amt });
  }
  const byVendor = new Map<string, { vendor: string; bills: number; billed: number; unbilled: number }>();
  const v = (name: string) => byVendor.get(name) ?? byVendor.set(name, { vendor: name, bills: 0, billed: 0, unbilled: 0 }).get(name)!;
  for (const b of bills) {
    const x = v(b.vendor?.name ?? b.payee ?? "No vendor");
    x.bills++;
    x.billed += b.amount;
  }
  for (const w of wos) v(w.vendor?.name ?? "No vendor").unbilled += w.cost ?? 0;
  const total = [...byAccount.values()].reduce((s, x) => s + x.amount, 0);
  const byCode = (code: string) => [...byAccount.entries()].filter(([k]) => k.startsWith(`${code} `)).reduce((s, [, x]) => s + x.amount, 0);
  return {
    total, repairs: byCode(CODES.REPAIRS), interest: byCode(CODES.MORTGAGE_INTEREST),
    byAccount: [...byAccount.values()].filter((x) => x.amount).sort((a, b) => b.amount - a.amount),
    byProperty: [...byProperty.values()].filter((x) => x.amount).sort((a, b) => b.amount - a.amount),
    byVendor: [...byVendor.values()].sort((a, b) => b.billed + b.unbilled - (a.billed + a.unbilled)),
    unbilled: wos.reduce((s, w) => s + (w.cost ?? 0), 0),
  };
}
