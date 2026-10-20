// Tenant portal: online payment posting and per-tenant data isolation. Runs against DATABASE_URL.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { applyStripeOutcome } from "../src/lib/online-payments";
import { payableNow, tenantDocumentWhere } from "../src/lib/portal-data";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};

before(async () => {
  const p = await db.property.create({ data: { name: "__portal test", street: "1", city: "x", state: "AL", zip: "1" } });
  const u1 = await db.unit.create({ data: { propertyId: p.id, label: "P1" } });
  const u2 = await db.unit.create({ data: { propertyId: p.id, label: "P2" } });
  const a = await db.tenant.create({ data: { firstName: "__Alice", lastName: "A", email: "alice@example.test", portalEnabled: true } });
  const b = await db.tenant.create({ data: { firstName: "__Bob", lastName: "B", email: "bob@example.test", portalEnabled: true } });
  const la = await db.lease.create({ data: { unitId: u1.id, tenantId: a.id, startDate: d("2030-01-01"), contractRent: 100000, tenantPortion: 30000, hapAmount: 70000 } });
  const lb = await db.lease.create({ data: { unitId: u2.id, tenantId: b.id, startDate: d("2030-01-01"), contractRent: 90000, tenantPortion: 90000 } });
  await db.charge.createMany({
    data: [
      { leaseId: la.id, type: "RENT", party: "TENANT", amount: 30000, dueDate: d("2030-02-01"), period: "2030-02" },
      { leaseId: la.id, type: "RENT", party: "HOUSING_AUTHORITY", amount: 70000, dueDate: d("2030-02-01"), period: "2030-02" },
    ],
  });
  Object.assign(ctx, { property: p.id, unit1: u1.id, unit2: u2.id, alice: a.id, bob: b.id, leaseA: la.id, leaseB: lb.id });
});

after(async () => {
  await db.document.deleteMany({ where: { name: { startsWith: "__" } } });
  await db.lease.deleteMany({ where: { unit: { propertyId: ctx.property } } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.deleteMany({ where: { id: { in: [ctx.alice, ctx.bob] } } });
  await db.$disconnect();
});

test("ACH: processing does not touch the ledger; success posts exactly once, even concurrently", async () => {
  const op = await db.onlinePayment.create({ data: { leaseId: ctx.leaseA, tenantId: ctx.alice, amount: 30000, checkoutSessionId: "cs_test_ach_1" } });
  const pi = { id: "pi_test_ach_1", amountReceived: 0, methodType: "us_bank_account", errorMessage: null };

  await applyStripeOutcome(op.checkoutSessionId, { sessionStatus: "complete", paymentIntent: { ...pi, status: "processing" } });
  assert.equal((await db.onlinePayment.findUniqueOrThrow({ where: { id: op.id } })).status, "PROCESSING");
  assert.equal(await db.payment.count({ where: { leaseId: ctx.leaseA } }), 0);

  // Processing money is not payable again
  let lease = await db.lease.findUniqueOrThrow({ where: { id: ctx.leaseA }, include: { charges: true, payments: true, onlinePayments: true } });
  assert.equal(payableNow(lease).payable, 0);
  assert.equal(payableNow(lease).balance, 30000); // HAP's $700 is never the tenant's to pay

  const ok = { sessionStatus: "complete" as const, paymentIntent: { ...pi, status: "succeeded", amountReceived: 30000 } };
  await Promise.all([applyStripeOutcome(op.checkoutSessionId, ok), applyStripeOutcome(op.checkoutSessionId, ok), applyStripeOutcome(op.checkoutSessionId, ok)]);
  await applyStripeOutcome(op.checkoutSessionId, ok);

  const payments = await db.payment.findMany({ where: { leaseId: ctx.leaseA } });
  assert.equal(payments.length, 1);
  assert.equal(payments[0].party, "TENANT");
  assert.equal(payments[0].method, "ACH");
  assert.equal(payments[0].amount, 30000);
  assert.equal((await db.onlinePayment.findUniqueOrThrow({ where: { id: op.id } })).status, "SUCCEEDED");

  lease = await db.lease.findUniqueOrThrow({ where: { id: ctx.leaseA }, include: { charges: true, payments: true, onlinePayments: true } });
  assert.equal(payableNow(lease).balance, 0);
});

test("failed and abandoned payments never post", async () => {
  const f = await db.onlinePayment.create({ data: { leaseId: ctx.leaseB, tenantId: ctx.bob, amount: 5000, checkoutSessionId: "cs_test_fail" } });
  await applyStripeOutcome(f.checkoutSessionId, {
    sessionStatus: "complete",
    paymentIntent: { id: "pi_test_fail", status: "requires_payment_method", amountReceived: 0, methodType: "us_bank_account", errorMessage: "Insufficient funds" },
  });
  const failed = await db.onlinePayment.findUniqueOrThrow({ where: { id: f.id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureReason, "Insufficient funds");

  const x = await db.onlinePayment.create({ data: { leaseId: ctx.leaseB, tenantId: ctx.bob, amount: 5000, checkoutSessionId: "cs_test_expired" } });
  await applyStripeOutcome(x.checkoutSessionId, { sessionStatus: "expired", paymentIntent: null });
  assert.equal((await db.onlinePayment.findUniqueOrThrow({ where: { id: x.id } })).status, "EXPIRED");

  assert.equal(await db.payment.count({ where: { leaseId: ctx.leaseB } }), 0);
  // Unknown sessions are ignored
  assert.equal(await applyStripeOutcome("cs_not_ours", { sessionStatus: "complete", paymentIntent: null }), null);
});

test("tenants only see documents shared with them", async () => {
  const mk = (name: string, data: Record<string, unknown>) =>
    db.document.create({ data: { name, storageKey: `test/${name}`, mimeType: "application/pdf", size: 1, ...data } });
  const aliceLease = await mk("__alice-lease", { leaseId: ctx.leaseA, sharedWithTenant: true });
  const aliceUnshared = await mk("__alice-internal", { leaseId: ctx.leaseA, sharedWithTenant: false });
  const bobLease = await mk("__bob-lease", { leaseId: ctx.leaseB, sharedWithTenant: true });
  const bobUnit = await mk("__bob-unit", { unitId: ctx.unit2, sharedWithTenant: true });
  const rules = await mk("__community-rules", { propertyId: ctx.property, sharedWithTenant: true });

  const seen = async (tenantId: string) =>
    (await db.document.findMany({ where: { AND: [await tenantDocumentWhere(tenantId), { name: { startsWith: "__" } }] } })).map((x) => x.id).sort();

  assert.deepEqual(await seen(ctx.alice), [aliceLease.id, rules.id].sort());
  assert.deepEqual(await seen(ctx.bob), [bobLease.id, bobUnit.id, rules.id].sort());
  assert.ok(!(await seen(ctx.alice)).includes(aliceUnshared.id));

  // A moved-out tenant keeps their lease docs but loses the building's
  await db.lease.update({ where: { id: ctx.leaseB }, data: { status: "ENDED", endDate: d("2030-03-31") } });
  assert.deepEqual(await seen(ctx.bob), [bobLease.id]);
});
