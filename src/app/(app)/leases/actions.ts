"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optDate, optInt, optMoney, optStr, reqDate, reqMoney, reqStr } from "@/lib/form";
import { CHARGE_TYPES, LEASE_STATUSES, PARTIES, PAYMENT_METHODS } from "@/lib/enums";
import { dueDateFor, leaseCoversPeriod } from "@/lib/ledger";
import { money, periodOf, todayUTC } from "@/lib/utils";
import { assertNotReconciled } from "@/lib/accounting";

function leaseData(fd: FormData) {
  const contractRent = reqMoney(fd, "contractRent", "Contract rent");
  const tenantPortion = reqMoney(fd, "tenantPortion", "Tenant portion");
  const hapAmount = optMoney(fd, "hapAmount", "HAP amount") ?? 0;
  if (tenantPortion + hapAmount !== contractRent)
    throw new Error(
      `Tenant portion (${money(tenantPortion)}) + HAP (${money(hapAmount)}) = ${money(tenantPortion + hapAmount)}, but contract rent is ${money(contractRent)}. They must match.`,
    );

  const housingAuthorityId = optStr(fd, "housingAuthorityId");
  if (hapAmount > 0 && !housingAuthorityId) throw new Error("Pick the housing authority that pays the HAP portion");

  const startDate = reqDate(fd, "startDate", "Start date");
  const endDate = optDate(fd, "endDate");
  if (endDate && endDate < startDate) throw new Error("End date is before start date");

  const dueDay = optInt(fd, "dueDay", "Due day") ?? 1;
  if (dueDay < 1 || dueDay > 31) throw new Error("Due day must be 1–31");

  return {
    unitId: reqStr(fd, "unitId", "Unit"),
    tenantId: reqStr(fd, "tenantId", "Tenant"),
    status: oneOf(fd, "status", LEASE_STATUSES, "ACTIVE"),
    startDate,
    endDate,
    contractRent,
    tenantPortion,
    hapAmount,
    dueDay,
    securityDeposit: optMoney(fd, "securityDeposit", "Security deposit") ?? 0,
    lateFeeAmount: optMoney(fd, "lateFeeAmount", "Late fee") ?? 0,
    lateFeeGraceDays: optInt(fd, "lateFeeGraceDays", "Grace days") ?? 5,
    housingAuthorityId,
    voucherNumber: optStr(fd, "voucherNumber"),
    hapContractStart: optDate(fd, "hapContractStart"),
    nextRecertDate: optDate(fd, "nextRecertDate"),
    moveInDate: optDate(fd, "moveInDate"),
    moveOutDate: optDate(fd, "moveOutDate"),
    notes: optStr(fd, "notes"),
  };
}

/** Prevent two active leases on the same unit with overlapping dates. */
async function assertNoOverlap(d: { unitId: string; status: string; startDate: Date; endDate: Date | null }, excludeId?: string) {
  if (d.status !== "ACTIVE") return;
  const clash = await db.lease.findFirst({
    where: {
      id: excludeId ? { not: excludeId } : undefined,
      unitId: d.unitId,
      status: "ACTIVE",
      AND: [
        { OR: [{ endDate: null }, { endDate: { gte: d.startDate } }] },
        d.endDate ? { startDate: { lte: d.endDate } } : {},
      ],
    },
    include: { tenant: true },
  });
  if (clash)
    throw new Error(`This unit already has an active lease for ${clash.tenant.firstName} ${clash.tenant.lastName} during those dates. End that lease first.`);
}

export async function createLease(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const data = leaseData(fd);
    await assertNoOverlap(data);

    const lease = await db.$transaction(async (tx) => {
      const l = await tx.lease.create({ data });
      const extra = [];
      if (bool(fd, "chargeDeposit") && l.securityDeposit > 0)
        extra.push({ leaseId: l.id, type: "SECURITY_DEPOSIT" as const, party: "TENANT" as const, amount: l.securityDeposit, dueDate: l.startDate, description: "Security deposit" });
      const period = periodOf(todayUTC());
      if (bool(fd, "chargeThisMonth") && leaseCoversPeriod(l, period)) {
        const dueDate = dueDateFor(period, l.dueDay);
        if (l.tenantPortion > 0) extra.push({ leaseId: l.id, type: "RENT" as const, party: "TENANT" as const, amount: l.tenantPortion, dueDate, period, description: "Rent — tenant portion" });
        if (l.hapAmount > 0) extra.push({ leaseId: l.id, type: "RENT" as const, party: "HOUSING_AUTHORITY" as const, amount: l.hapAmount, dueDate, period, description: "Rent — HAP portion" });
      }
      if (extra.length) await tx.charge.createMany({ data: extra, skipDuplicates: true });
      return l;
    });

    revalidatePath("/leases");
    redirect(`/leases/${lease.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateLease(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const data = leaseData(fd);
    await assertNoOverlap(data, id);
    await db.lease.update({ where: { id }, data });
    revalidatePath(`/leases/${id}`);
    redirect(`/leases/${id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function endLease(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const endDate = reqDate(fd, "endDate", "End date");
    await db.lease.update({ where: { id }, data: { status: "ENDED", endDate, moveOutDate: optDate(fd, "moveOutDate") ?? endDate } });
    revalidatePath(`/leases/${id}`);
    return { ok: true, message: "Lease ended" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteLease(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await assertNotReconciled({ leaseId: id });
    if (await db.payment.count({ where: { leaseId: id } }))
      throw new Error("This lease has payments recorded. End it instead of deleting so your history stays intact.");
    await db.lease.delete({ where: { id } });
    revalidatePath("/leases");
    redirect("/leases");
  } catch (e) {
    return toActionError(e);
  }
}

export async function addCharge(leaseId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const amount = reqMoney(fd, "amount", "Amount");
    if (amount === 0) throw new Error("Amount must be more than $0");
    await db.charge.create({
      data: {
        leaseId,
        type: oneOf(fd, "type", CHARGE_TYPES),
        party: oneOf(fd, "party", PARTIES, "TENANT"),
        amount,
        dueDate: reqDate(fd, "dueDate", "Due date"),
        description: optStr(fd, "description"),
      },
    });
    revalidatePath(`/leases/${leaseId}`);
    return { ok: true, message: `Charged ${money(amount)}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordPayment(leaseId: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const id = leaseId ?? reqStr(fd, "leaseId", "Lease");
    const amount = reqMoney(fd, "amount", "Amount");
    if (amount === 0) throw new Error("Amount must be more than $0");
    await db.payment.create({
      data: {
        leaseId: id,
        party: oneOf(fd, "party", PARTIES, "TENANT"),
        amount,
        paidOn: reqDate(fd, "paidOn", "Date"),
        method: oneOf(fd, "method", PAYMENT_METHODS, "ACH"),
        reference: optStr(fd, "reference"),
        notes: optStr(fd, "notes"),
      },
    });
    revalidatePath(`/leases/${id}`);
    revalidatePath("/payments");
    revalidatePath("/");
    return { ok: true, message: `Recorded ${money(amount)}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteCharge(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await assertNotReconciled({ chargeId: id });
    const c = await db.charge.delete({ where: { id } });
    revalidatePath(`/leases/${c.leaseId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deletePayment(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await assertNotReconciled({ paymentId: id });
    const p = await db.payment.delete({ where: { id } });
    revalidatePath(`/leases/${p.leaseId}`);
    revalidatePath("/payments");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
