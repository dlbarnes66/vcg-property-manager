import { db } from "./db";
import { computeLeaseLedger, type Aging } from "./ledger";
import { inForceLeaseWhere, tenantName } from "./queries";
import { addDays, todayUTC } from "./utils";

export type RentRollRow = {
  propertyId: string;
  property: string;
  unit: string;
  beds: number;
  baths: number;
  marketRent: number | null;
  status: "Occupied" | "Vacant";
  leaseId: string | null;
  tenant: string | null;
  leaseStart: Date | null;
  leaseEnd: Date | null;
  contractRent: number;
  tenantPortion: number;
  hapAmount: number;
  housingAuthority: string | null;
  balance: number;
};

export async function rentRoll(asOf = todayUTC(), propertyId: string | null = null): Promise<RentRollRow[]> {
  const units = await db.unit.findMany({
    where: propertyId ? { propertyId } : {},
    orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
    include: {
      property: true,
      leases: { where: inForceLeaseWhere(asOf), include: { tenant: true, housingAuthority: true, charges: true, payments: true } },
    },
  });
  return units.map((u) => {
    const l = u.leases[0];
    const ledger = l ? computeLeaseLedger(l.charges, l.payments, asOf) : null;
    return {
      propertyId: u.propertyId,
      property: u.property.name,
      unit: u.label,
      beds: u.bedrooms,
      baths: u.bathrooms,
      marketRent: u.marketRent,
      status: l ? "Occupied" : "Vacant",
      leaseId: l?.id ?? null,
      tenant: l ? tenantName(l.tenant) : null,
      leaseStart: l?.startDate ?? null,
      leaseEnd: l?.endDate ?? null,
      contractRent: l?.contractRent ?? 0,
      tenantPortion: l?.tenantPortion ?? 0,
      hapAmount: l?.hapAmount ?? 0,
      housingAuthority: l?.housingAuthority?.name ?? null,
      balance: ledger ? ledger.tenant.balance + ledger.authority.balance : 0,
    };
  });
}

export type DelinquencyRow = {
  leaseId: string;
  property: string;
  unit: string;
  tenant: string;
  party: "Tenant" | "Housing authority";
  payer: string; // tenant name or PHA name
  phone: string | null;
  pastDue: number;
  oldestPastDue: Date | null;
  aging: Aging;
  leaseStatus: string;
};

/** Every lease (active or ended) with money past due, split by who owes it. */
export async function delinquency(asOf = todayUTC(), propertyId: string | null = null): Promise<DelinquencyRow[]> {
  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE", "ENDED"] }, ...(propertyId ? { unit: { propertyId } } : {}) },
    include: { tenant: true, housingAuthority: true, unit: { include: { property: true } }, charges: true, payments: true },
  });
  const rows: DelinquencyRow[] = [];
  for (const l of leases) {
    const { tenant, authority } = computeLeaseLedger(l.charges, l.payments, asOf);
    const base = { leaseId: l.id, property: l.unit.property.name, unit: l.unit.label, tenant: tenantName(l.tenant), leaseStatus: l.status };
    if (tenant.pastDue > 0)
      rows.push({ ...base, party: "Tenant", payer: tenantName(l.tenant), phone: l.tenant.phone, pastDue: tenant.pastDue, oldestPastDue: tenant.oldestPastDue, aging: tenant.aging });
    if (authority.pastDue > 0)
      rows.push({
        ...base, party: "Housing authority", payer: l.housingAuthority?.name ?? "Housing authority", phone: l.housingAuthority?.phone ?? null,
        pastDue: authority.pastDue, oldestPastDue: authority.oldestPastDue, aging: authority.aging,
      });
  }
  return rows.sort((a, b) => b.pastDue - a.pastDue);
}

/** Simple monthly cash flow: rent/fees collected vs. maintenance spend, by calendar month. */
export async function cashFlow(from: Date, to: Date, propertyId: string | null = null) {
  const unit = propertyId ? { propertyId } : undefined;
  const [payments, maint] = await Promise.all([
    db.payment.findMany({ where: { paidOn: { gte: from, lt: addDays(to, 1) }, ...(unit ? { lease: { unit } } : {}) }, select: { amount: true, paidOn: true, party: true } }),
    db.maintenanceRequest.findMany({
      where: { completedOn: { gte: from, lt: addDays(to, 1) }, cost: { not: null }, ...(unit ? { unit } : {}) },
      select: { cost: true, completedOn: true },
    }),
  ]);
  const out = monthsIn(from, to).map((period) => ({ period, tenant: 0, hap: 0, maintenance: 0, net: 0 }));
  const idx = (d: Date) => out.findIndex((o) => o.period === d.toISOString().slice(0, 7));
  for (const p of payments) {
    const i = idx(p.paidOn);
    if (i >= 0) out[i][p.party === "TENANT" ? "tenant" : "hap"] += p.amount;
  }
  for (const m of maint) {
    const i = idx(m.completedOn!);
    if (i >= 0) out[i].maintenance += m.cost ?? 0;
  }
  for (const o of out) o.net = o.tenant + o.hap - o.maintenance;
  return out;
}

/** "YYYY-MM" for every calendar month touching [from, to]. */
export function monthsIn(from: Date, to: Date) {
  const out: string[] = [];
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)))
    out.push(d.toISOString().slice(0, 7));
  return out;
}

/* ---------- CSV ---------- */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Guard against spreadsheet formula injection from user-entered names
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}
