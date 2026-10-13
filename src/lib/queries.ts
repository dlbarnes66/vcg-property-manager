import type { Prisma } from "@prisma/client";
import { todayUTC } from "./utils";

/** Lease is ACTIVE and in force today (start ≤ today ≤ end-or-open). Drives occupancy. */
export function inForceLeaseWhere(asOf: Date = todayUTC()): Prisma.LeaseWhereInput {
  return {
    status: "ACTIVE",
    startDate: { lte: asOf },
    OR: [{ endDate: null }, { endDate: { gte: asOf } }],
  };
}

export const tenantName = (t: { firstName: string; lastName: string }) => `${t.firstName} ${t.lastName}`;
export const unitName = (u: { label: string; property: { name: string } }) => `${u.property.name} · ${u.label}`;

/** A failed inspection stays "open" until a later inspection on the same unit records any result. */
export function openFailures<T extends { id: string; unitId: string; result: string; completedDate: Date | null; scheduledDate: Date }>(all: T[]): T[] {
  const when = (i: T) => (i.completedDate ?? i.scheduledDate).getTime();
  return all.filter(
    (i) => i.result === "FAIL" && !all.some((r) => r.id !== i.id && r.unitId === i.unitId && r.result !== "PENDING" && when(r) > when(i)),
  );
}
