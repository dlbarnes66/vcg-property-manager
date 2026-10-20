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
    await db.bankTransaction.deleteMany();
    await db.reconciliation.deleteMany();
    await db.journalEntry.deleteMany();
    await db.billPayment.deleteMany();
    await db.bill.deleteMany();
    await db.message.deleteMany();
    await db.messageTemplate.deleteMany();
    await db.note.deleteMany();
    await db.task.deleteMany();
    await db.calendarEvent.deleteMany();
    await db.application.deleteMany();
    await db.listing.deleteMany();
    await db.onlinePayment.deleteMany();
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
  const smoke = await db.maintenanceRequest.create({ data: { unitId: units[0].id, vendorId: vendor.id, title: "Replace smoke detector", priority: "HIGH", status: "COMPLETED", reportedOn: d(`${months[2]}-09`), completedOn: d(`${months[2]}-12`), cost: $(85) } });
  await db.maintenanceRequest.create({ data: { unitId: dA.id, title: "Yard cleanup after storm", priority: "LOW", status: "COMPLETED", reportedOn: d(`${months[1]}-18`), completedOn: d(`${months[1]}-25`), cost: $(120) } });

  await db.inspection.create({ data: { unitId: dB.id, type: "HQS_ANNUAL", scheduledDate: d(`${months[3]}-05`), completedDate: d(`${months[3]}-05`), result: "FAIL", deficiencies: "Heating system inoperable; missing outlet cover in bedroom", cureByDate: new Date(Date.now() + 10 * 86_400_000) } });
  await db.inspection.create({ data: { unitId: units[3].id, type: "HQS_ANNUAL", scheduledDate: new Date(Date.now() + 12 * 86_400_000) } });
  await db.inspection.create({ data: { unitId: units[0].id, type: "HQS_INITIAL", scheduledDate: start, completedDate: start, result: "PASS" } });

  // Leasing: a live listing for a vacant unit, with one application
  const vacant = units[5]; // Unit 202
  const listing = await db.listing.create({
    data: {
      unitId: vacant.id, slug: "oak-ridge-202", status: "PUBLISHED", publishedAt: new Date(), headline: "Updated 1BR at Oak Ridge, vouchers welcome",
      description: "Second-floor one-bedroom with new flooring, updated kitchen, and on-site laundry. Close to the VA clinic and bus line.",
      rent: $(950), deposit: $(500), acceptsVouchers: true, utilitiesIncluded: "Water and trash", petPolicy: "Cats OK. Service and support animals always welcome.",
    },
  });
  await db.application.create({
    data: {
      listingId: listing.id, firstName: "Kevin", lastName: "Price", email: "kevin.price@example.org", phone: "(251) 555-0150", isVeteran: true, householdSize: 1,
      monthlyIncome: $(1450), incomeSource: "VA disability", hasVoucher: true, voucherType: "HUD-VASH", housingAuthorityName: "Gulf Coast Housing Authority (demo)",
      caseManagerName: "VA HUD-VASH Team (demo)", caseManagerPhone: "(251) 555-0199", consentAt: new Date(),
    },
  });

  // Accounting: opening bank balance and a paid repair bill (rent and payments post automatically)
  await db.account.createMany({ data: (await import("../src/lib/accounting")).DEFAULT_CHART, skipDuplicates: true });
  const acct = async (code: string) => (await db.account.findUniqueOrThrow({ where: { code } })).id;
  await db.journalEntry.create({
    data: {
      date: d(`${months[0]}-01`), memo: "Opening balance", source: "MANUAL",
      lines: { create: [{ accountId: await acct("1000"), debit: $(25000) }, { accountId: await acct("3000"), credit: $(25000) }] },
    },
  });
  const bill = await db.bill.create({
    data: { vendorId: vendor.id, propertyId: oak.id, expenseAccountId: await acct("5000"), maintenanceId: smoke.id, billDate: d(`${months[2]}-12`), amount: $(85), description: "Replace smoke detector", status: "PAID" },
  });
  await db.billPayment.create({ data: { billId: bill.id, bankAccountId: await acct("1000"), date: d(`${months[2]}-14`), amount: $(85), method: "CHECK", reference: "1001" } });

  // Mortgage on Oak Ridge (purchase, then monthly payments split into interest and principal) and a couple of other bills
  await db.journalEntry.create({
    data: {
      date: d("2025-03-15"), memo: "Purchase of Oak Ridge Apartments", source: "MANUAL",
      lines: { create: [{ accountId: await acct("1500"), debit: $(1_250_000), propertyId: oak.id }, { accountId: await acct("2500"), credit: $(937_500), propertyId: oak.id }, { accountId: await acct("3000"), credit: $(312_500), propertyId: oak.id }] },
    },
  });
  for (const p of months)
    await db.journalEntry.create({
      data: {
        date: d(`${p}-05`), memo: "Mortgage payment", source: "MANUAL",
        lines: { create: [{ accountId: await acct("5700"), debit: $(3_900), propertyId: oak.id }, { accountId: await acct("2500"), debit: $(1_450), propertyId: oak.id }, { accountId: await acct("1000"), credit: $(5_350), propertyId: oak.id }] },
      },
    });
  await db.bill.create({ data: { payee: "Gulf States Insurance (demo)", propertyId: oak.id, expenseAccountId: await acct("5200"), billDate: d(`${months[1]}-01`), amount: $(3_200), description: "Property insurance — 6 months", status: "OPEN" } });
  await db.bill.create({ data: { payee: "Mobile Area Water (demo)", propertyId: duplex.id, expenseAccountId: await acct("5100"), billDate: d(`${months[3]}-02`), amount: $(180), description: "Water & sewer", status: "OPEN" } });

  console.log("Seeded demo data: 2 properties, 10 units, 7 leases (6 HUD-VASH), 3 work orders, 3 inspections, 1 live listing with an application, opening books.");
}

main().finally(() => db.$disconnect());
