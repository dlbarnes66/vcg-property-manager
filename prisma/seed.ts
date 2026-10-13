/**
 * Demo data so you can click around before entering real properties.
 *   npm run db:seed          → adds demo data (refuses if you already have properties)
 *   npm run db:seed -- --reset → wipes EVERYTHING first (dev only!)
 * All names below are fictional.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const $ = (n: number) => Math.round(n * 100);

function monthsBack(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return dt.toISOString().slice(0, 7);
  });
}

async function main() {
  if (process.argv.includes("--reset")) {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
    await db.document.deleteMany();
    await db.payment.deleteMany();
    await db.charge.deleteMany();
    await db.inspection.deleteMany();
    await db.maintenanceRequest.deleteMany();
    await db.lease.deleteMany();
    await db.unit.deleteMany();
    await db.property.deleteMany();
    await db.tenant.deleteMany();
    await db.vendor.deleteMany();
    await db.housingAuthority.deleteMany();
  } else if ((await db.property.count()) > 0) {
    console.log("Database already has properties; skipping seed. Use --reset to wipe (dev only).");
    return;
  }

  const pha = await db.housingAuthority.create({
    data: { name: "Gulf Coast Housing Authority (demo)", contactName: "HCV Landlord Desk", phone: "(251) 555-0100", email: "landlords@example.org" },
  });

  const oak = await db.property.create({
    data: { name: "Oak Ridge Apartments", type: "MULTIFAMILY", street: "100 Oak Ridge Dr", city: "Mobile", state: "AL", zip: "36602", purchasePrice: $(1_250_000), purchaseDate: d("2025-03-15") },
  });
  const units = await Promise.all(
    ["101", "102", "103", "104", "201", "202", "203", "204"].map((label, i) =>
      db.unit.create({ data: { propertyId: oak.id, label: `Unit ${label}`, bedrooms: i % 4 === 3 ? 2 : 1, bathrooms: 1, sqft: i % 4 === 3 ? 850 : 650, marketRent: $(i % 4 === 3 ? 1150 : 950) } }),
    ),
  );
  const duplex = await db.property.create({
    data: { name: "Dauphin St Duplex", type: "DUPLEX", street: "2210 Dauphin St", city: "Mobile", state: "AL", zip: "36606", purchasePrice: $(210_000), purchaseDate: d("2025-08-01") },
  });
  const dA = await db.unit.create({ data: { propertyId: duplex.id, label: "Side A", bedrooms: 2, bathrooms: 1, marketRent: $(1050) } });
  const dB = await db.unit.create({ data: { propertyId: duplex.id, label: "Side B", bedrooms: 2, bathrooms: 1, marketRent: $(1050) } });

  const vendor = await db.vendor.create({ data: { name: "Bayside Plumbing (demo)", trade: "Plumbing", phone: "(251) 555-0142" } });
  await db.vendor.create({ data: { name: "Coastal HVAC (demo)", trade: "HVAC", phone: "(251) 555-0177" } });

  const people = [
    ["Marcus", "Hill"], ["Denise", "Carter"], ["Robert", "Nguyen"], ["Angela", "Brooks"], ["James", "Ortiz"], ["Lisa", "Freeman"], ["Tony", "Reyes"],
  ];
  const tenants = await Promise.all(
    people.map(([f, l], i) =>
      db.tenant.create({
        data: { firstName: f, lastName: l, phone: `(251) 555-01${(10 + i).toString()}`, isVeteran: true, caseManagerName: "VA HUD-VASH Team (demo)", caseManagerPhone: "(251) 555-0199" },
      }),
    ),
  );

  const months = monthsBack(4);
  const start = d(`${months[0]}-01`);
  const leaseSpecs = [
    { unit: units[0], t: tenants[0], contract: 950, tenantPart: 285 },
    { unit: units[1], t: tenants[1], contract: 950, tenantPart: 190 },
    { unit: units[2], t: tenants[2], contract: 950, tenantPart: 0 }, // zero-income: HAP pays all
    { unit: units[3], t: tenants[3], contract: 1150, tenantPart: 345 },
    { unit: units[4], t: tenants[4], contract: 950, tenantPart: 950, hap: false }, // market-rate
    { unit: dA, t: tenants[5], contract: 1050, tenantPart: 310 },
    { unit: dB, t: tenants[6], contract: 1050, tenantPart: 260 },
  ];

  for (const [i, s] of leaseSpecs.entries()) {
    const hap = s.hap === false ? 0 : s.contract - s.tenantPart;
    const lease = await db.lease.create({
      data: {
        unitId: s.unit.id, tenantId: s.t.id, status: "ACTIVE", startDate: start, endDate: d(`${Number(months[0].slice(0, 4)) + 1}${months[0].slice(4)}-01`),
        contractRent: $(s.contract), tenantPortion: $(s.tenantPart), hapAmount: $(hap), dueDay: 1, securityDeposit: $(s.tenantPart || 100),
        lateFeeAmount: $(25), lateFeeGraceDays: 5, housingAuthorityId: hap ? pha.id : null, voucherNumber: hap ? `V-2026-${1000 + i}` : null,
        hapContractStart: hap ? start : null, nextRecertDate: hap ? new Date(Date.now() + (20 + i * 15) * 86_400_000) : null, moveInDate: start,
      },
    });
    for (const [mi, p] of months.entries()) {
      const due = d(`${p}-01`);
      if (lease.tenantPortion) await db.charge.create({ data: { leaseId: lease.id, type: "RENT", party: "TENANT", amount: lease.tenantPortion, dueDate: due, period: p, description: "Rent — tenant portion" } });
      if (lease.hapAmount) await db.charge.create({ data: { leaseId: lease.id, type: "RENT", party: "HOUSING_AUTHORITY", amount: lease.hapAmount, dueDate: due, period: p, description: "Rent — HAP portion" } });
      const isCurrent = mi === months.length - 1;
      // Tenant 2 (Denise) skipped the last two months; Tony underpaid this month; HAP for duplex Side B is late this month
      const tenantPays = !(i === 1 && mi >= months.length - 2) && !(isCurrent && i === 6);
      if (lease.tenantPortion && tenantPays)
        await db.payment.create({ data: { leaseId: lease.id, party: "TENANT", amount: lease.tenantPortion, paidOn: d(`${p}-03`), method: "ACH" } });
      if (isCurrent && i === 6) await db.payment.create({ data: { leaseId: lease.id, party: "TENANT", amount: $(100), paidOn: d(`${p}-04`), method: "CASH" } });
      if (lease.hapAmount && !(isCurrent && i === 6))
        await db.payment.create({ data: { leaseId: lease.id, party: "HOUSING_AUTHORITY", amount: lease.hapAmount, paidOn: d(`${p}-02`), method: "ACH", reference: `HAP-${p}` } });
    }
  }

  await db.maintenanceRequest.create({ data: { unitId: units[1].id, title: "Kitchen faucet leaking", priority: "NORMAL", status: "SCHEDULED", vendorId: vendor.id, scheduledOn: new Date(Date.now() + 2 * 86_400_000) } });
  await db.maintenanceRequest.create({ data: { unitId: dB.id, title: "No heat", priority: "EMERGENCY", status: "OPEN" } });
  await db.maintenanceRequest.create({ data: { unitId: units[0].id, title: "Replace smoke detector", priority: "HIGH", status: "COMPLETED", completedOn: d(`${months[2]}-12`), cost: $(85) } });

  await db.inspection.create({ data: { unitId: dB.id, type: "HQS_ANNUAL", scheduledDate: d(`${months[3]}-05`), completedDate: d(`${months[3]}-05`), result: "FAIL", deficiencies: "Heating system inoperable; missing outlet cover in bedroom", cureByDate: new Date(Date.now() + 10 * 86_400_000) } });
  await db.inspection.create({ data: { unitId: units[3].id, type: "HQS_ANNUAL", scheduledDate: new Date(Date.now() + 12 * 86_400_000) } });
  await db.inspection.create({ data: { unitId: units[0].id, type: "HQS_INITIAL", scheduledDate: start, completedDate: start, result: "PASS" } });

  console.log("Seeded demo data: 2 properties, 10 units, 7 leases (6 HUD-VASH), 3 work orders, 3 inspections.");
}

main().finally(() => db.$disconnect());
