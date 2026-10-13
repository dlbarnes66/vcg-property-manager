import type { Charge, Lease, Party, Payment } from "@prisma/client";
import { db } from "./db";
import { addDays, daysBetween, periodBounds, todayUTC } from "./utils";

/* ------------------------------------------------------------------------------------------------
 * Pure ledger math (no database) — easy to unit test.
 * Payments for a party are applied to that party's charges oldest-first (FIFO).
 * ---------------------------------------------------------------------------------------------- */

export type Aging = { current: number; d30: number; d60: number; d90: number; over90: number };

export type PartyLedger = {
  party: Party;
  charged: number; // all charges, including not-yet-due
  paid: number;
  balance: number; // charged - paid (negative = credit)
  pastDue: number; // unpaid amount on charges whose due date has passed
  oldestPastDue: Date | null;
  aging: Aging; // buckets of pastDue by days late
};

const emptyAging = (): Aging => ({ current: 0, d30: 0, d60: 0, d90: 0, over90: 0 });

export function computePartyLedger(
  party: Party,
  charges: Pick<Charge, "amount" | "dueDate" | "party">[],
  payments: Pick<Payment, "amount" | "party">[],
  asOf: Date = todayUTC(),
): PartyLedger {
  const mine = charges.filter((c) => c.party === party).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const paid = payments.filter((p) => p.party === party).reduce((s, p) => s + p.amount, 0);
  const charged = mine.reduce((s, c) => s + c.amount, 0);

  let pool = paid;
  let pastDue = 0;
  let oldestPastDue: Date | null = null;
  const aging = emptyAging();

  for (const c of mine) {
    const applied = Math.min(pool, c.amount);
    pool -= applied;
    const open = c.amount - applied;
    if (open <= 0 || c.dueDate > asOf) continue;

    pastDue += open;
    oldestPastDue ??= c.dueDate;
    const late = daysBetween(c.dueDate, asOf);
    if (late <= 0) aging.current += open; // due today
    else if (late <= 30) aging.d30 += open;
    else if (late <= 60) aging.d60 += open;
    else if (late <= 90) aging.d90 += open;
    else aging.over90 += open;
  }

  return { party, charged, paid, balance: charged - paid, pastDue, oldestPastDue, aging };
}

export function computeLeaseLedger(
  charges: Pick<Charge, "amount" | "dueDate" | "party">[],
  payments: Pick<Payment, "amount" | "party">[],
  asOf: Date = todayUTC(),
) {
  return {
    tenant: computePartyLedger("TENANT", charges, payments, asOf),
    authority: computePartyLedger("HOUSING_AUTHORITY", charges, payments, asOf),
  };
}

/** Rent due date inside a period, clamping dueDay 31 to the month's last day. */
export function dueDateFor(period: string, dueDay: number) {
  const { start, daysInMonth } = periodBounds(period);
  return addDays(start, Math.min(Math.max(dueDay, 1), daysInMonth) - 1);
}

/** Is a lease in force at any point during the period? */
export function leaseCoversPeriod(lease: Pick<Lease, "status" | "startDate" | "endDate">, period: string) {
  if (lease.status !== "ACTIVE") return false;
  const { start, end } = periodBounds(period);
  return lease.startDate <= end && (lease.endDate == null || lease.endDate >= start);
}

/* ------------------------------------------------------------------------------------------------
 * Database operations
 * ---------------------------------------------------------------------------------------------- */

/**
 * Creates the month's rent charges for every active lease: one for the tenant portion and one
 * for the housing authority (HAP) portion. Safe to run repeatedly — duplicates are skipped by
 * the (leaseId, type, party, period) unique constraint.
 */
export async function generateRentCharges(period: string) {
  periodBounds(period); // validates
  const leases = await db.lease.findMany({ where: { status: "ACTIVE" } });
  const rows = leases
    .filter((l) => leaseCoversPeriod(l, period))
    .flatMap((l) => {
      const dueDate = dueDateFor(period, l.dueDay);
      const out = [];
      if (l.tenantPortion > 0)
        out.push({ leaseId: l.id, type: "RENT" as const, party: "TENANT" as const, amount: l.tenantPortion, dueDate, period, description: "Rent — tenant portion" });
      if (l.hapAmount > 0)
        out.push({ leaseId: l.id, type: "RENT" as const, party: "HOUSING_AUTHORITY" as const, amount: l.hapAmount, dueDate, period, description: "Rent — HAP portion" });
      return out;
    });
  const res = await db.charge.createMany({ data: rows, skipDuplicates: true });
  return { created: res.count, eligibleLeases: new Set(rows.map((r) => r.leaseId)).size };
}

/**
 * Adds a flat late fee (tenant only — never charge the housing authority a late fee) for the
 * period when the tenant still has a past-due balance after the grace period.
 */
export async function applyLateFees(period: string, asOf: Date = todayUTC()) {
  const leases = await db.lease.findMany({
    where: { status: "ACTIVE", lateFeeAmount: { gt: 0 } },
    include: { charges: true, payments: true },
  });

  let created = 0;
  for (const l of leases) {
    const rent = l.charges.find((c) => c.type === "RENT" && c.party === "TENANT" && c.period === period);
    if (!rent) continue;
    if (asOf <= addDays(rent.dueDate, l.lateFeeGraceDays)) continue;
    if (l.charges.some((c) => c.type === "LATE_FEE" && c.period === period)) continue;

    const { tenant } = computeLeaseLedger(l.charges, l.payments, asOf);
    if (tenant.pastDue <= 0) continue;

    const res = await db.charge.createMany({
      data: [{ leaseId: l.id, type: "LATE_FEE", party: "TENANT", amount: l.lateFeeAmount, dueDate: asOf, period, description: "Late fee" }],
      skipDuplicates: true,
    });
    created += res.count;
  }
  return { created };
}
