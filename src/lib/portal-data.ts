import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { computeLeaseLedger } from "./ledger";

/** The lease a tenant's portal is about: their current active lease, else their most recent one. */
export async function portalLease(tenantId: string) {
  const include = { unit: { include: { property: true } }, charges: true, payments: true, onlinePayments: true } as const;
  return (
    (await db.lease.findFirst({ where: { tenantId, status: "ACTIVE" }, orderBy: { startDate: "desc" }, include })) ??
    (await db.lease.findFirst({ where: { tenantId, status: "ENDED" }, orderBy: { startDate: "desc" }, include }))
  );
}

/**
 * Documents a tenant may see: only ones you marked "Show in tenant portal", and only if attached to
 * the tenant, one of their leases, a work order they submitted, or the unit/property they live in now.
 */
export async function tenantDocumentWhere(tenantId: string): Promise<Prisma.DocumentWhereInput> {
  const current = await db.lease.findFirst({ where: { tenantId, status: "ACTIVE" }, orderBy: { startDate: "desc" }, include: { unit: true } });
  const scopes: Prisma.DocumentWhereInput[] = [
    { tenantId },
    { lease: { tenantId } },
    { maintenance: { submittedByTenantId: tenantId } },
  ];
  if (current) scopes.push({ unitId: current.unitId }, { propertyId: current.unit.propertyId });
  return { sharedWithTenant: true, OR: scopes };
}

export type PortalLease = NonNullable<Awaited<ReturnType<typeof portalLease>>>;

/** What the tenant can pay online right now: their own balance minus bank transfers still clearing. HAP is never included. */
export function payableNow(lease: Pick<PortalLease, "charges" | "payments" | "onlinePayments">) {
  const { tenant } = computeLeaseLedger(lease.charges, lease.payments);
  const processing = lease.onlinePayments.filter((p) => p.status === "PROCESSING").reduce((s, p) => s + p.amount, 0);
  return { balance: tenant.balance, pastDue: tenant.pastDue, processing, payable: tenant.balance - processing, ledger: tenant };
}
