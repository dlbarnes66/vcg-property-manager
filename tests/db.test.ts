// Integration tests against the database in DATABASE_URL. Seeds its own isolated records and cleans up.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { applyLateFees, generateRentCharges, computeLeaseLedger } from "../src/lib/ledger";
import { delinquency, rentRoll } from "../src/lib/reports";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ids: { property?: string; tenant?: string; ha?: string } = {};

after(async () => {
  if (ids.property) {
    await db.lease.deleteMany({ where: { unit: { propertyId: ids.property } } });
    await db.property.delete({ where: { id: ids.property } });
  }
  if (ids.tenant) await db.tenant.delete({ where: { id: ids.tenant } });
  if (ids.ha) await db.housingAuthority.delete({ where: { id: ids.ha } });
  await db.$disconnect();
});

test("rent run is idempotent, splits tenant/HAP, and late fees hit tenant only", async () => {
  const ha = await db.housingAuthority.create({ data: { name: "__test PHA" } });
  const p = await db.property.create({ data: { name: "__test prop", street: "1", city: "x", state: "AL", zip: "1" } });
  const u = await db.unit.create({ data: { propertyId: p.id, label: "T1" } });
  const t = await db.tenant.create({ data: { firstName: "__Test", lastName: "Tenant" } });
  Object.assign(ids, { property: p.id, tenant: t.id, ha: ha.id });

  const lease = await db.lease.create({
    data: { unitId: u.id, tenantId: t.id, startDate: d("2030-01-15"), contractRent: 100000, tenantPortion: 30000, hapAmount: 70000, dueDay: 31, lateFeeAmount: 2500, lateFeeGraceDays: 5, housingAuthorityId: ha.id },
  });

  await generateRentCharges("2030-02");
  await generateRentCharges("2030-02"); // second run must not double
  const charges = await db.charge.findMany({ where: { leaseId: lease.id } });
  assert.equal(charges.length, 2);
  assert.deepEqual(charges.map((c) => c.party).sort(), ["HOUSING_AUTHORITY", "TENANT"]);
  assert.equal(charges[0].dueDate.toISOString().slice(0, 10), "2030-02-28");

  // Not yet past grace → no fee
  assert.equal((await applyLateFees("2030-02", d("2030-03-03"))).created >= 0, true);
  assert.equal(await db.charge.count({ where: { leaseId: lease.id, type: "LATE_FEE" } }), 0);

  // HAP pays, tenant doesn't → one late fee on the tenant, even if run twice
  await db.payment.create({ data: { leaseId: lease.id, party: "HOUSING_AUTHORITY", amount: 70000, paidOn: d("2030-02-28") } });
  await applyLateFees("2030-02", d("2030-03-10"));
  await applyLateFees("2030-02", d("2030-03-11"));
  const fees = await db.charge.findMany({ where: { leaseId: lease.id, type: "LATE_FEE" } });
  assert.equal(fees.length, 1);
  assert.equal(fees[0].party, "TENANT");

  const full = await db.lease.findUniqueOrThrow({ where: { id: lease.id }, include: { charges: true, payments: true } });
  const ledger = computeLeaseLedger(full.charges, full.payments, d("2030-03-11"));
  assert.equal(ledger.tenant.pastDue, 32500);
  assert.equal(ledger.authority.pastDue, 0);

  // Paid-up tenant gets no fee in the next month
  await generateRentCharges("2030-03");
  await db.payment.create({ data: { leaseId: lease.id, party: "TENANT", amount: 62500, paidOn: d("2030-03-20") } });
  await applyLateFees("2030-03", d("2030-04-10"));
  assert.equal(await db.charge.count({ where: { leaseId: lease.id, type: "LATE_FEE" } }), 1);
});

test("reports run against seeded data", async () => {
  const roll = await rentRoll();
  assert.ok(roll.length > 0, "seed first: npm run db:seed");
  const late = await delinquency();
  for (const r of late) assert.ok(r.pastDue > 0);
});
