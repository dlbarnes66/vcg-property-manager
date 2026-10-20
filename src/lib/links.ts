import { optStr } from "./form";

/** The records a note, task, event, or message can be attached to. */
export const LINK_KEYS = ["propertyId", "unitId", "tenantId", "leaseId", "maintenanceId", "vendorId", "housingAuthorityId"] as const;
export type LinkKey = (typeof LINK_KEYS)[number];
export type Links = Partial<Record<LinkKey, string>>;

export function readLinks(fd: FormData, allowed: readonly LinkKey[] = LINK_KEYS): Partial<Record<LinkKey, string | null>> {
  return Object.fromEntries(allowed.map((k) => [k, optStr(fd, k)]));
}

/** Prisma include that pulls just enough of each linked record to label it. */
export const linkInclude = {
  property: { select: { id: true, name: true } },
  unit: { select: { id: true, label: true, propertyId: true, property: { select: { name: true } } } },
  tenant: { select: { id: true, firstName: true, lastName: true } },
  lease: { select: { id: true, unit: { select: { label: true, property: { select: { name: true } } } } } },
  maintenance: { select: { id: true, title: true } },
  vendor: { select: { id: true, name: true } },
  housingAuthority: { select: { id: true, name: true } },
} as const;

type Linked = {
  property?: { id: string; name: string } | null;
  unit?: { id: string; label: string; propertyId: string; property: { name: string } } | null;
  tenant?: { id: string; firstName: string; lastName: string } | null;
  lease?: { id: string; unit: { label: string; property: { name: string } } } | null;
  maintenance?: { id: string; title: string } | null;
  vendor?: { id: string; name: string } | null;
  housingAuthority?: { id: string; name: string } | null;
};

/** Most specific link first: work order > lease > tenant > unit > property > vendor > PHA. */
export function linkLabel(r: Linked): { href: string; label: string } | null {
  if (r.maintenance) return { href: `/maintenance/${r.maintenance.id}`, label: `Work order · ${r.maintenance.title}` };
  if (r.lease) return { href: `/leases/${r.lease.id}`, label: `Lease · ${r.lease.unit.property.name} ${r.lease.unit.label}` };
  if (r.tenant) return { href: `/tenants/${r.tenant.id}`, label: `${r.tenant.firstName} ${r.tenant.lastName}` };
  if (r.unit) return { href: `/properties/${r.unit.propertyId}`, label: `${r.unit.property.name} · ${r.unit.label}` };
  if (r.property) return { href: `/properties/${r.property.id}`, label: r.property.name };
  if (r.vendor) return { href: `/vendors`, label: `Vendor · ${r.vendor.name}` };
  if (r.housingAuthority) return { href: `/housing-authorities`, label: r.housingAuthority.name };
  return null;
}
