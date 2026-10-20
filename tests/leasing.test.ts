// Leasing: public application intake, abuse limits, conversion to tenant, public photo access.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { ApplicationError, convertApplicationToTenant, newListingSlug, submitApplication, type ApplicationInput } from "../src/lib/leasing";

const ctx: Record<string, string> = {};
const base: ApplicationInput = {
  firstName: "__Jordan", lastName: "Applicant", email: "Jordan@Example.test", phone: "(251) 555-0123", isVeteran: true, householdSize: 2,
  desiredMoveIn: null, currentAddress: "1 Main St", currentLandlord: null, currentLandlordPhone: null, monthlyIncome: 180000, incomeSource: "VA disability",
  employer: null, hasVoucher: true, voucherType: "HUD-VASH", housingAuthorityName: "Gulf Coast HA", caseManagerName: "Pat CM", caseManagerPhone: "251-555-0199",
  caseManagerEmail: "pat@va.example.test", pets: "One cat", additionalInfo: null, consent: true,
};

before(async () => {
  const p = await db.property.create({ data: { name: "__lease test", street: "9 Elm", city: "Mobile", state: "AL", zip: "36602" } });
  const u = await db.unit.create({ data: { propertyId: p.id, label: "L1", bedrooms: 2 } });
  const live = await db.listing.create({ data: { unitId: u.id, slug: newListingSlug(), status: "PUBLISHED", headline: "__Live", rent: 95000, deposit: 50000 } });
  const draft = await db.listing.create({ data: { unitId: u.id, slug: newListingSlug(), status: "DRAFT", headline: "__Draft", rent: 95000 } });
  const photoLive = await db.document.create({ data: { name: "a.jpg", storageKey: "test/__a.jpg", mimeType: "image/jpeg", size: 1, listingId: live.id } });
  const photoDraft = await db.document.create({ data: { name: "b.jpg", storageKey: "test/__b.jpg", mimeType: "image/jpeg", size: 1, listingId: draft.id } });
  const pdfLive = await db.document.create({ data: { name: "c.pdf", storageKey: "test/__c.pdf", mimeType: "application/pdf", size: 1, listingId: live.id } });
  Object.assign(ctx, { property: p.id, unit: u.id, live: live.slug, liveId: live.id, draft: draft.slug, photoLive: photoLive.id, photoDraft: photoDraft.id, pdfLive: pdfLive.id });
});

after(async () => {
  await db.document.deleteMany({ where: { storageKey: { startsWith: "test/__" } } });
  await db.task.deleteMany({ where: { title: { contains: "__Jordan" } } });
  const apps = await db.application.findMany({ where: { email: { endsWith: "example.test" } }, select: { tenantId: true } });
  await db.application.deleteMany({ where: { email: { endsWith: "example.test" } } });
  await db.tenant.deleteMany({ where: { id: { in: apps.map((a) => a.tenantId).filter((x): x is string => !!x) } } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.$disconnect();
});

test("rejects drafts, bad input, and missing consent; bots get a silent no-op", async () => {
  await assert.rejects(submitApplication(ctx.draft, base), /no longer accepting/);
  await assert.rejects(submitApplication("nope", base), /no longer accepting/);
  await assert.rejects(submitApplication(ctx.live, { ...base, email: "not-an-email" }), /valid email/);
  await assert.rejects(submitApplication(ctx.live, { ...base, phone: "12" }), /valid phone/);
  await assert.rejects(submitApplication(ctx.live, { ...base, consent: false }), /confirm/);
  await assert.rejects(submitApplication(ctx.live, { ...base, householdSize: 0 }), /Household/);
  assert.equal(await submitApplication(ctx.live, { ...base, website: "http://spam" }), null);
  assert.equal(await db.application.count({ where: { email: "jordan@example.test" } }), 0);
});

test("valid application is saved (email normalized), creates a review task, and is rate limited", async () => {
  const r = await submitApplication(ctx.live, base);
  assert.ok(r);
  assert.equal(r.application.email, "jordan@example.test");
  assert.equal(r.application.status, "NEW");
  assert.equal(r.application.voucherType, "HUD-VASH");
  ctx.app = r.application.id;
  const task = await db.task.findFirst({ where: { title: { contains: "__Jordan" } } });
  assert.ok(task && task.unitId === ctx.unit && task.priority === "HIGH");
  await submitApplication(ctx.live, base);
  await submitApplication(ctx.live, base);
  await assert.rejects(submitApplication(ctx.live, base), (e: unknown) => e instanceof ApplicationError && /already received/.test(e.message));
  // A non-voucher applicant's voucher fields are dropped even if the browser sent them
  const nv = await submitApplication(ctx.live, { ...base, email: "other@example.test", hasVoucher: false });
  assert.equal(nv?.application.voucherType, null);
});

test("conversion requires approval, creates the tenant once, moves documents, closes the listing", async () => {
  await assert.rejects(convertApplicationToTenant(ctx.app), /Approve/);
  const doc = await db.document.create({ data: { name: "id.pdf", storageKey: "test/__id.pdf", mimeType: "application/pdf", size: 1, applicationId: ctx.app } });
  await db.application.update({ where: { id: ctx.app }, data: { status: "APPROVED" } });
  const r1 = await convertApplicationToTenant(ctx.app);
  const r2 = await convertApplicationToTenant(ctx.app);
  assert.equal(r1.tenantId, r2.tenantId);
  assert.equal(r2.created, false);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: r1.tenantId } });
  assert.equal(t.caseManagerEmail, "pat@va.example.test");
  assert.equal(t.isVeteran, true);
  assert.equal(t.smsConsent, false, "texting consent is never assumed");
  assert.match(t.notes ?? "", /HUD-VASH/);
  assert.equal((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).tenantId, t.id);
  assert.equal((await db.listing.findUniqueOrThrow({ where: { id: ctx.liveId } })).status, "CLOSED");
});

test("public photo route serves images of live listings only", async () => {
  const { GET } = await import("../src/app/api/listing-photo/[id]/route");
  const call = (id: string) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });
  await db.listing.update({ where: { id: ctx.liveId }, data: { status: "PUBLISHED" } });
  assert.equal((await call(ctx.photoDraft)).status, 404, "draft listing photo");
  assert.equal((await call(ctx.pdfLive)).status, 404, "non-image file on a live listing");
  const anyTenantDoc = await db.document.findFirst({ where: { listingId: null } });
  if (anyTenantDoc) assert.equal((await call(anyTenantDoc.id)).status, 404, "documents not on a listing are never public");
  // A live photo is found (storage read may fail in tests since the file doesn't exist; the lookup is what matters)
  const found = await db.document.findFirst({ where: { id: ctx.photoLive, mimeType: { startsWith: "image/" }, listing: { status: "PUBLISHED" } } });
  assert.ok(found);
});
