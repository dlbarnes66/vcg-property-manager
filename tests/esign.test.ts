// E-signatures: sending, signing, declining, cancelling, links, completion, and the signed PDF.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { db } from "../src/lib/db";
import {
  cancelRequest, completeRequest, createSignatureRequest, declineAsSigner, pendingForOwner, pendingForTenant, reissueLink, sha256, signAsSigner, signerByToken,
} from "../src/lib/esign";
import { deleteObject, getObject, putObject } from "../src/lib/storage";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};
const who = { ip: "203.0.113.7", userAgent: "TestBrowser/1.0" };
const typed = (name: string) => ({ consent: true, type: "typed", text: name, ...who });
// a real 1x1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function finalForm(title: string) {
  return db.formDoc.create({
    data: { title, formType: "residential-lease", state: "NC", category: "LEASE", status: "FINAL", body: `# ${title}\n\nTerms.\n\nTenant: __________`, tenantId: ctx.tenant, leaseId: ctx.lease, propertyId: ctx.property, unitId: ctx.unit },
  });
}

before(async () => {
  const p = await db.property.create({ data: { name: "__esign test", street: "1", city: "x", state: "NC", zip: "1" } });
  const u = await db.unit.create({ data: { propertyId: p.id, label: "1" } });
  const t = await db.tenant.create({ data: { firstName: "__Sig", lastName: "Tenant", email: "sig.tenant@example.org", portalEnabled: true } });
  const t2 = await db.tenant.create({ data: { firstName: "__NoPortal", lastName: "Tenant" } });
  const l = await db.lease.create({ data: { unitId: u.id, tenantId: t.id, startDate: d("2036-01-01"), contractRent: 100000, tenantPortion: 100000 } });
  Object.assign(ctx, { property: p.id, unit: u.id, tenant: t.id, tenant2: t2.id, lease: l.id });
});

after(async () => {
  const reqs = await db.signatureRequest.findMany({ where: { formDoc: { propertyId: ctx.property } }, include: { signedDocument: true } });
  for (const r of reqs) {
    await deleteObject(r.originalKey).catch(() => {});
    if (r.signedDocument) await deleteObject(r.signedDocument.storageKey).catch(() => {});
  }
  await db.formDoc.deleteMany({ where: { propertyId: ctx.property } });
  await db.task.deleteMany({ where: { propertyId: ctx.property } });
  await db.document.deleteMany({ where: { propertyId: ctx.property } });
  await db.lease.delete({ where: { id: ctx.lease } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.deleteMany({ where: { id: { in: [ctx.tenant, ctx.tenant2] } } });
  await db.$disconnect();
});

test("sending: needs a finished form, valid signers, and only one open request per form", async () => {
  const draft = await db.formDoc.create({ data: { title: "__draft", formType: "x", state: "NC", category: "LEASE", body: "# x", propertyId: ctx.property } });
  await assert.rejects(createSignatureRequest(draft.id, { signers: [{ role: "LANDLORD", name: "Me", isOwner: true }] }), /Finish the form/);
  const f = await finalForm("__Lease A");
  await assert.rejects(createSignatureRequest(f.id, { signers: [] }), /at least one signer/);
  await assert.rejects(createSignatureRequest(f.id, { signers: [{ role: "COSIGNER", name: "Bob", email: "not-an-email" }] }), /doesn't look right/);
  await assert.rejects(createSignatureRequest(f.id, { signers: [{ role: "COSIGNER", name: "Bob" }] }), /needs an email/);
  await assert.rejects(createSignatureRequest(f.id, { signers: [{ role: "TENANT", name: "No Portal", tenantId: ctx.tenant2 }] }), /invite them to the tenant portal/);

  const { request, links } = await createSignatureRequest(f.id, {
    signers: [{ role: "TENANT", name: "__Sig Tenant", tenantId: ctx.tenant }, { role: "COSIGNER", name: "Bob Guarantor", email: "Bob@Example.org" }, { role: "LANDLORD", name: "Darryl Barnes", isOwner: true }],
    message: "Please sign by Friday", createdByEmail: "me@example.com",
  });
  assert.deepEqual(links.map((l) => l.via), ["portal", "link", "app"]);
  const link = links[1];
  assert.ok(link.token && link.token.length >= 40);
  const stored = await db.signer.findUniqueOrThrow({ where: { id: link.signerId } });
  assert.equal(stored.email, "bob@example.org");
  assert.equal(stored.tokenHash, sha256(link.token!), "only the hash of the link is stored");
  const orig = await getObject(request.originalKey);
  assert.ok("body" in orig && sha256(orig.body) === request.originalHash, "fingerprint matches the frozen PDF");
  assert.equal(request.pageCount, 1);
  await assert.rejects(createSignatureRequest(f.id, { signers: [{ role: "LANDLORD", name: "Me", isOwner: true }] }), /already out for signature/);
  Object.assign(ctx, { reqA: request.id, tenantSigner: links[0].signerId, bob: link.signerId, owner: links[2].signerId, bobToken: link.token! });

  assert.deepEqual((await pendingForTenant(ctx.tenant)).map((s) => s.id), [ctx.tenantSigner]);
  assert.ok((await pendingForOwner()).some((s) => s.id === ctx.owner));
});

test("private links: valid, wrong, and replaced", async () => {
  assert.equal((await signerByToken(ctx.bobToken))?.id, ctx.bob);
  assert.equal(await signerByToken("x".repeat(43)), null);
  assert.equal(await signerByToken("../../etc"), null);
  const fresh = await reissueLink(ctx.bob);
  assert.equal(await signerByToken(ctx.bobToken), null, "old link stops working");
  assert.equal((await signerByToken(fresh.token))?.id, ctx.bob);
  ctx.bobToken = fresh.token;
});

test("signing rules: consent, a name, a real drawn image, and only once", async () => {
  await assert.rejects(signAsSigner(ctx.tenantSigner, { ...typed("__Sig Tenant"), consent: false }), /agree to sign electronically/);
  await assert.rejects(signAsSigner(ctx.tenantSigner, typed("  ")), /full name/);
  await assert.rejects(signAsSigner(ctx.tenantSigner, { consent: true, type: "drawn", text: "Sig", image: "data:image/png;base64,AAAA" }), /isn't valid/);
  await assert.rejects(signAsSigner(ctx.tenantSigner, { consent: true, type: "drawn", text: "Sig", image: null }), /Draw your signature/);

  const r = await signAsSigner(ctx.tenantSigner, { consent: true, type: "drawn", text: "__Sig Tenant", image: PNG, ...who });
  assert.equal(r.status, "PENDING");
  await assert.rejects(signAsSigner(ctx.tenantSigner, typed("__Sig Tenant")), /already signed/);
  const s = await db.signer.findUniqueOrThrow({ where: { id: ctx.tenantSigner } });
  assert.deepEqual([s.status, s.signatureType, s.ip, s.userAgent], ["SIGNED", "drawn", who.ip, who.userAgent]);
  assert.ok(s.consentAt && s.signedAt);
});

test("last two signers at the same moment: the signed PDF is made exactly once", async () => {
  const results = await Promise.allSettled([signAsSigner(ctx.bob, typed("Bob Guarantor")), signAsSigner(ctx.owner, typed("Darryl Barnes"))]);
  assert.ok(results.every((x) => x.status === "fulfilled"), JSON.stringify(results));
  const r = await db.signatureRequest.findUniqueOrThrow({ where: { id: ctx.reqA }, include: { signedDocument: true, events: true } });
  assert.equal(r.status, "COMPLETED");
  assert.ok(r.signedDocument);
  assert.equal(await db.document.count({ where: { propertyId: ctx.property, name: { contains: "(signed)" } } }), 1);
  assert.deepEqual([r.signedDocument!.category, r.signedDocument!.sharedWithTenant, r.signedDocument!.tenantId, r.signedDocument!.leaseId], ["LEASE", true, ctx.tenant, ctx.lease]);
  const file = await getObject(r.signedDocument!.storageKey);
  assert.ok("body" in file);
  assert.equal(sha256(file.body), r.signedHash);
  const pdf = await PDFDocument.load(file.body);
  assert.ok(pdf.getPageCount() >= 2, "original page + certificate");
  for (const t of ["created", "viewed", "consented", "signed", "completed"].filter((x) => x !== "viewed")) assert.ok(r.events.some((e) => e.type === t), t);
  assert.equal(r.events.filter((e) => e.type === "signed").length, 3);
  assert.equal(await completeRequest(ctx.reqA), null, "completing again does nothing");
  await assert.rejects(signAsSigner(ctx.bob, typed("Bob")), /already fully signed/);
  assert.equal((await signerByToken(ctx.bobToken))?.id, ctx.bob, "the link still works to download the signed copy");
});

test("declining closes the request and creates a task for you", async () => {
  const f = await finalForm("__Lease B");
  const { links } = await createSignatureRequest(f.id, { signers: [{ role: "TENANT", name: "__Sig Tenant", tenantId: ctx.tenant }, { role: "LANDLORD", name: "Me", isOwner: true }] });
  await declineAsSigner(links[0].signerId, "Rent amount is wrong", who);
  const r = await db.signatureRequest.findFirstOrThrow({ where: { formDocId: f.id } });
  assert.equal(r.status, "DECLINED");
  assert.ok(await db.task.findFirst({ where: { propertyId: ctx.property, title: { contains: "declined to sign" }, description: { contains: "Rent amount is wrong" } } }));
  await assert.rejects(signAsSigner(links[1].signerId, typed("Me")), /no longer active/);
});

test("cancelling kills the links", async () => {
  const f = await finalForm("__Lease C");
  const { request, links } = await createSignatureRequest(f.id, { signers: [{ role: "COSIGNER", name: "Carl", email: "carl@example.org" }] });
  await cancelRequest(request.id, "me@example.com");
  assert.equal(await signerByToken(links[0].token!), null);
  await assert.rejects(signAsSigner(links[0].signerId, typed("Carl")), /no longer active/);
  await assert.rejects(cancelRequest(request.id, null), /still waiting/);
});

test("a changed original is caught; the request stays open and can be retried", async () => {
  const f = await finalForm("__Lease D");
  const { request, links } = await createSignatureRequest(f.id, { signers: [{ role: "LANDLORD", name: "Me", isOwner: true }] });
  const good = await getObject(request.originalKey);
  await putObject(request.originalKey, Buffer.from("%PDF-1.7 tampered"), "application/pdf");
  await assert.rejects(signAsSigner(links[0].signerId, typed("Me")), /doesn't match its fingerprint/);
  let r = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { events: true } });
  assert.equal(r.status, "PENDING");
  assert.ok(r.events.some((e) => e.type === "completion_failed"));
  await putObject(request.originalKey, (good as { body: Buffer }).body, "application/pdf");
  assert.ok(await completeRequest(request.id));
  r = await db.signatureRequest.findUniqueOrThrow({ where: { id: request.id }, include: { events: true } });
  assert.equal(r.status, "COMPLETED");
});
