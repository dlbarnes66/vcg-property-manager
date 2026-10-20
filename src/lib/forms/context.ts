import { db } from "../db";
import { computePartyLedger } from "../ledger";
import { getLandlord } from "../settings";
import { toStateCode } from "../states";
import { dateToInput, money, todayUTC } from "../utils";
import type { Facts } from "./prompt";

export type Subject = { leaseId?: string | null; tenantId?: string | null; propertyId?: string | null; vendorId?: string | null };

const date = (d: Date | null | undefined) => (d ? dateToInput(d) : null);
const cents = (n: number | null | undefined) => (n == null ? null : money(n));

/**
 * Everything the drafter should know about the form's subject, plus the ids to link the form to.
 * A lease implies its tenant, unit, and property.
 */
export async function gatherFacts(s: Subject) {
  const landlord = await getLandlord();
  const facts: Facts = {
    Landlord: {
      "Owner (legal name)": landlord.ownerName, "Property manager": landlord.managerName, "Notice address": landlord.address,
      Phone: landlord.phone, Email: landlord.email,
    },
  };
  const links: { leaseId: string | null; tenantId: string | null; propertyId: string | null; unitId: string | null; vendorId: string | null } = {
    leaseId: null, tenantId: null, propertyId: null, unitId: null, vendorId: null,
  };
  let state: string | null = null;

  if (s.leaseId) {
    const l = await db.lease.findUniqueOrThrow({
      where: { id: s.leaseId },
      include: { tenant: true, housingAuthority: true, unit: { include: { property: true } }, charges: true, payments: true },
    });
    const p = l.unit.property;
    const led = computePartyLedger("TENANT", l.charges, l.payments, todayUTC());
    Object.assign(links, { leaseId: l.id, tenantId: l.tenantId, unitId: l.unitId, propertyId: p.id });
    state = toStateCode(p.state);
    facts.Property = { Name: p.name, Address: `${p.street}, ${p.city}, ${p.state} ${p.zip}`, Type: p.type.replace("_", " ").toLowerCase() };
    facts.Unit = { Unit: l.unit.label, Bedrooms: l.unit.bedrooms, Bathrooms: l.unit.bathrooms, "Square feet": l.unit.sqft };
    facts.Tenant = tenantFacts(l.tenant);
    facts.Lease = {
      Status: l.status.toLowerCase(), "Start date": date(l.startDate), "End date": date(l.endDate) ?? (l.status === "ACTIVE" ? "month-to-month (no end date)" : null),
      "Move-in date": date(l.moveInDate), "Total contract rent / month": cents(l.contractRent), "Tenant portion / month": cents(l.tenantPortion),
      "Rent due day": l.dueDay, "Late fee": l.lateFeeAmount ? `${cents(l.lateFeeAmount)} after ${l.lateFeeGraceDays} days` : "none",
      "Security deposit": cents(l.securityDeposit),
    };
    if (l.housingAuthorityId || l.hapAmount > 0)
      facts["Voucher / HUD-VASH"] = {
        "Housing authority": l.housingAuthority?.name, "Housing authority contact": [l.housingAuthority?.contactName, l.housingAuthority?.phone, l.housingAuthority?.email].filter(Boolean).join(", "),
        "HAP (paid by housing authority) / month": cents(l.hapAmount), "Voucher number": l.voucherNumber, "HAP contract start": date(l.hapContractStart),
        "Next recertification": date(l.nextRecertDate),
      };
    facts["Tenant account today"] = { "Tenant portion past due": cents(led.pastDue), "Oldest unpaid charge due": date(led.oldestPastDue), "Tenant balance (incl. not yet due)": cents(led.balance) };
  } else if (s.tenantId) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } });
    links.tenantId = t.id;
    facts.Tenant = tenantFacts(t);
  }
  const propertyId = links.propertyId ?? s.propertyId ?? null;
  if (propertyId && !facts.Property) {
    const p = await db.property.findUniqueOrThrow({ where: { id: propertyId }, include: { _count: { select: { units: true } } } });
    links.propertyId = p.id;
    state = toStateCode(p.state);
    facts.Property = { Name: p.name, Address: `${p.street}, ${p.city}, ${p.state} ${p.zip}`, Type: p.type.replace("_", " ").toLowerCase(), Units: p._count.units };
  }
  if (s.vendorId) {
    const v = await db.vendor.findUniqueOrThrow({ where: { id: s.vendorId } });
    links.vendorId = v.id;
    facts.Vendor = { Name: v.name, Trade: v.trade, Phone: v.phone, Email: v.email };
  }
  return { facts, links, state };
}

function tenantFacts(t: { firstName: string; lastName: string; email: string | null; phone: string | null; isVeteran: boolean; caseManagerName: string | null; caseManagerPhone: string | null; caseManagerEmail: string | null }) {
  return {
    Name: `${t.firstName} ${t.lastName}`, Email: t.email, Phone: t.phone, Veteran: t.isVeteran ? "yes" : null,
    "VA case manager": [t.caseManagerName, t.caseManagerPhone, t.caseManagerEmail].filter(Boolean).join(", ") || null,
  };
}
