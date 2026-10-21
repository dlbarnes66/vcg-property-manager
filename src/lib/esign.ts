import "server-only";
import { createHash, randomBytes, randomUUID } from "crypto";
import type { SignerRole } from "@prisma/client";
import { db } from "./db";
import { buildSignedPdf, pageCount } from "./esign-pdf";
import { DOC_CATEGORY } from "./forms/catalog";
import { formToPdf } from "./forms/pdf";
import { isEmail } from "./messaging-core";
import { emailConfigured, sendEmail } from "./messaging-providers";
import { stateName } from "./states";
import { getObject, putObject } from "./storage";
import { addDays, todayUTC } from "./utils";

/*
 * Built-in e-signatures. A finished form is frozen into a PDF (with its SHA-256), sent to signers,
 * and once everyone has signed, a final PDF with a signature certificate and audit trail is saved
 * to Documents. Tenants sign in their portal; you sign in the app; anyone else gets a private link.
 */

export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const LINK_DAYS = 30;
const MAX_SIGNERS = 6;
const MAX_SIGNATURE_BYTES = 150_000;

export type SignerInput = { role: SignerRole; name: string; email?: string | null; tenantId?: string | null; isOwner?: boolean };
export type Who = { ip?: string | null; userAgent?: string | null };
type Link = { signerId: string; name: string; email: string | null; via: "portal" | "link" | "app"; token?: string };

async function event(requestId: string, type: string, o: { signerId?: string | null; detail?: string | null } & Who = {}) {
  await db.signatureEvent.create({ data: { requestId, type, signerId: o.signerId ?? null, detail: o.detail?.slice(0, 500) ?? null, ip: o.ip?.slice(0, 64) ?? null, userAgent: o.userAgent?.slice(0, 300) ?? null } });
}

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token), tokenExpiresAt: addDays(new Date(), LINK_DAYS) };
}

/** Freeze the form into a PDF and create the request. Returns how each signer will sign (with link tokens to send). */
export async function createSignatureRequest(formDocId: string, o: { signers: SignerInput[]; message?: string | null; createdByEmail?: string | null }) {
  const form = await db.formDoc.findUniqueOrThrow({ where: { id: formDocId } });
  if (form.status !== "FINAL") throw new Error("Finish the form (save the PDF) before sending it for signature");
  if (await db.signatureRequest.findFirst({ where: { formDocId, status: "PENDING" } })) throw new Error("This form is already out for signature. Cancel that request first to send a new one.");
  const signers = o.signers.map((s) => ({ ...s, name: s.name.trim().slice(0, 120), email: s.email?.trim().toLowerCase() || null }));
  if (!signers.length) throw new Error("Add at least one signer");
  if (signers.length > MAX_SIGNERS) throw new Error(`Up to ${MAX_SIGNERS} signers`);
  if (signers.filter((s) => s.isOwner).length > 1) throw new Error("Only one landlord signer");
  for (const s of signers) {
    if (!s.name) throw new Error("Every signer needs a name");
    if (s.email && !isEmail(s.email)) throw new Error(`${s.name}'s email doesn't look right`);
  }

  // Decide how each person signs: you in the app, tenants in their portal, everyone else by private link.
  const tenants = await db.tenant.findMany({ where: { id: { in: signers.map((s) => s.tenantId).filter((x): x is string => !!x) } } });
  const plan = signers.map((s) => {
    if (s.isOwner) return { ...s, via: "app" as const, tenantId: null };
    const t = s.tenantId ? tenants.find((x) => x.id === s.tenantId) : null;
    if (t?.portalEnabled) return { ...s, via: "portal" as const, email: s.email ?? t.email?.toLowerCase() ?? null };
    if (!s.email) throw new Error(`${s.name} needs an email address${t ? " (or invite them to the tenant portal)" : ""}`);
    return { ...s, via: "link" as const, tenantId: t?.id ?? null };
  });

  const pdf = await formToPdf(form.title, form.body, `${form.title} · ${stateName(form.state)}`);
  const originalKey = `signatures/${randomUUID()}/original.pdf`;
  await putObject(originalKey, pdf, "application/pdf");
  const request = await db.signatureRequest.create({
    data: {
      formDocId, title: form.title, message: o.message?.trim().slice(0, 1000) || null, bodySnapshot: form.body, originalKey, originalHash: sha256(pdf),
      pageCount: await pageCount(pdf), createdByEmail: o.createdByEmail ?? null,
    },
  });
  const links: Link[] = [];
  for (const s of plan) {
    const tok = s.via === "link" ? newToken() : null;
    const signer = await db.signer.create({
      data: { requestId: request.id, role: s.role, name: s.name, email: s.email ?? null, tenantId: s.tenantId ?? null, isOwner: !!s.isOwner, tokenHash: tok?.tokenHash, tokenExpiresAt: tok?.tokenExpiresAt },
    });
    links.push({ signerId: signer.id, name: signer.name, email: signer.email, via: s.via, token: tok?.token });
  }
  await event(request.id, "created", { detail: `Sent by ${o.createdByEmail ?? "landlord"} to ${plan.map((s) => s.name).join(", ")} · SHA-256 ${request.originalHash}` });
  return { request, links };
}

/** Emails each signer (when email is set up). Returns who couldn't be emailed so you can share their link yourself. */
export async function notifySigners(requestId: string, links: Link[], origin: string) {
  const req = await db.signatureRequest.findUniqueOrThrow({ where: { id: requestId } });
  const notSent: { name: string; url: string | null; reason: string }[] = [];
  for (const l of links) {
    if (l.via === "app") continue;
    const url = l.via === "link" ? `${origin}/s/${l.token}` : `${origin}/portal/sign/${l.signerId}`;
    if (!l.email || !emailConfigured()) {
      notSent.push({ name: l.name, url: l.via === "link" ? url : null, reason: !l.email ? "no email on file" : "email isn't set up" });
      continue;
    }
    const r = await sendEmail({
      to: l.email, toName: l.name, messageId: `sig-${l.signerId}`,
      subject: `Please sign: ${req.title}`,
      text: `Hi ${l.name.split(" ")[0]},\n\nPlease review and sign "${req.title}".${req.message ? `\n\n${req.message}` : ""}\n\n${l.via === "portal" ? "Sign in to your resident portal to sign:" : "Open this private link to review and sign (it works for 30 days; please don't forward it):"}\n${url}\n\nThank you.`,
    });
    if (r.ok) await event(requestId, "emailed", { signerId: l.signerId, detail: l.email });
    else notSent.push({ name: l.name, url: l.via === "link" ? url : null, reason: r.error });
  }
  return notSent;
}

/** New private link for an emailed signer (the old one stops working). */
export async function reissueLink(signerId: string) {
  const s = await db.signer.findUniqueOrThrow({ where: { id: signerId }, include: { request: true } });
  if (s.isOwner || s.status !== "PENDING" || s.request.status !== "PENDING") throw new Error("This signer doesn't need a new link");
  if (!s.email) throw new Error("This signer signs in the tenant portal");
  const tok = newToken();
  await db.signer.update({ where: { id: signerId }, data: { tokenHash: tok.tokenHash, tokenExpiresAt: tok.tokenExpiresAt } });
  await event(s.requestId, "link_reissued", { signerId });
  return { signerId, name: s.name, email: s.email, via: "link" as const, token: tok.token };
}

export async function signerByToken(token: string) {
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const s = await db.signer.findUnique({ where: { tokenHash: sha256(token) }, include: { request: { include: { signers: true } } } });
  if (!s || (s.status === "PENDING" && s.tokenExpiresAt && s.tokenExpiresAt < new Date())) return null;
  return s;
}

export async function recordView(signerId: string, who: Who) {
  const s = await db.signer.findUniqueOrThrow({ where: { id: signerId } });
  const recent = await db.signatureEvent.findFirst({ where: { signerId, type: "viewed", at: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (!recent && s.status === "PENDING") await event(s.requestId, "viewed", { signerId, ...who });
}

function checkSignature(type: string, text: string, image: string | null) {
  if (!text.trim()) throw new Error("Type your full name");
  if (type !== "typed" && type !== "drawn") throw new Error("Choose how to sign");
  if (type === "drawn") {
    if (!image || !image.startsWith("data:image/png;base64,")) throw new Error("Draw your signature in the box");
    const bytes = Buffer.from(image.split(",")[1], "base64");
    if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error("That signature image is too large. Please clear it and try again.");
    if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("That signature image isn't valid");
  }
}

/** Records a signature (once). When the last person signs, the signed PDF is produced. */
export async function signAsSigner(signerId: string, o: { consent: boolean; type: string; text: string; image?: string | null } & Who) {
  if (!o.consent) throw new Error("Check the box to agree to sign electronically");
  checkSignature(o.type, o.text, o.image ?? null);
  const s = await db.signer.findUniqueOrThrow({ where: { id: signerId }, include: { request: true } });
  if (s.request.status !== "PENDING") throw new Error(s.request.status === "COMPLETED" ? "This document is already fully signed" : "This signature request is no longer active");
  const now = new Date();
  const claimed = await db.signer.updateMany({
    where: { id: signerId, status: "PENDING" },
    data: {
      status: "SIGNED", consentAt: now, signedAt: now, signatureType: o.type, signatureText: o.text.trim().slice(0, 120),
      signatureImage: o.type === "drawn" ? o.image : null, ip: o.ip?.slice(0, 64) ?? null, userAgent: o.userAgent?.slice(0, 300) ?? null,
    },
  });
  if (claimed.count === 0) throw new Error("You've already signed this document");
  await event(s.requestId, "consented", { signerId, ...o, detail: "Agreed to use electronic records and signatures" });
  await event(s.requestId, "signed", { signerId, ...o, detail: `${o.type === "drawn" ? "Drew" : "Typed"} signature as "${o.text.trim().slice(0, 120)}"` });
  const left = await db.signer.count({ where: { requestId: s.requestId, status: { not: "SIGNED" } } });
  if (left === 0) await completeRequest(s.requestId);
  return db.signatureRequest.findUniqueOrThrow({ where: { id: s.requestId } });
}

export async function declineAsSigner(signerId: string, reason: string, who: Who) {
  const s = await db.signer.findUniqueOrThrow({ where: { id: signerId }, include: { request: { include: { formDoc: true } } } });
  if (s.request.status !== "PENDING" || s.status !== "PENDING") throw new Error("This request is no longer active");
  const why = reason.trim().slice(0, 500) || "No reason given";
  await db.signer.update({ where: { id: signerId }, data: { status: "DECLINED", declinedReason: why, ip: who.ip ?? null, userAgent: who.userAgent ?? null } });
  await db.signatureRequest.update({ where: { id: s.requestId }, data: { status: "DECLINED" } });
  await event(s.requestId, "declined", { signerId, detail: why, ...who });
  await db.task.create({
    data: {
      title: `${s.name} declined to sign: ${s.request.title}`, description: `Reason: ${why}\nOpen Forms → ${s.request.title}.`, priority: "HIGH",
      dueDate: addDays(todayUTC(), 1), tenantId: s.tenantId, leaseId: s.request.formDoc.leaseId, propertyId: s.request.formDoc.propertyId,
    },
  });
}

export async function cancelRequest(requestId: string, by: string | null) {
  const r = await db.signatureRequest.updateMany({ where: { id: requestId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (r.count === 0) throw new Error("Only a request that's still waiting can be cancelled");
  await db.signer.updateMany({ where: { requestId }, data: { tokenHash: null } });
  await event(requestId, "cancelled", { detail: by ? `By ${by}` : null });
}

const METHOD: Record<string, string> = { portal: "Tenant portal (signed in)", link: "Private emailed link", app: "Landlord account (signed in)" };

/**
 * Builds and saves the signed PDF. Safe to call more than once (only one caller builds it); if
 * building fails, the request stays open and this can be retried.
 */
export async function completeRequest(requestId: string) {
  const claimed = await db.signatureRequest.updateMany({ where: { id: requestId, status: "PENDING", signedDocumentId: null, signers: { every: { status: "SIGNED" } } }, data: { status: "COMPLETED", completedAt: new Date() } });
  if (claimed.count === 0) return null;
  try {
    const r = await db.signatureRequest.findUniqueOrThrow({ where: { id: requestId }, include: { signers: { orderBy: { createdAt: "asc" } }, formDoc: true } });
    const obj = await getObject(r.originalKey);
    const original = "body" in obj ? obj.body : Buffer.from(await (await fetch(obj.url)).arrayBuffer());
    if (sha256(original) !== r.originalHash) throw new Error("The stored original doesn't match its fingerprint");
    await event(requestId, "completed", { detail: "All parties signed" });
    const events = await db.signatureEvent.findMany({ where: { requestId }, orderBy: { at: "asc" }, include: { signer: true } });
    const signed = await buildSignedPdf({
      original, requestId, title: r.title, originalHash: r.originalHash, sentBy: r.createdByEmail, sentAt: r.createdAt, completedAt: r.completedAt!,
      signers: r.signers.map((s) => ({ ...s, role: s.role.charAt(0) + s.role.slice(1).toLowerCase(), method: METHOD[s.isOwner ? "app" : s.tokenHash || (s.email && !s.tenantId) ? "link" : "portal"] })),
      events: events.map((e) => ({ at: e.at, type: e.type, who: e.signer?.name ?? null, ip: e.ip, detail: e.type === "created" ? null : e.detail })),
    });
    const key = `docs/${randomUUID()}/${r.title.replace(/[^\w.\- ]+/g, "").trim().slice(0, 90) || "Document"} (signed).pdf`;
    await putObject(key, Buffer.from(signed), "application/pdf");
    const f = r.formDoc;
    const doc = await db.document.create({
      data: {
        name: `${r.title.replace(/[^\w.\- ]+/g, "").trim().slice(0, 90) || "Document"} (signed).pdf`, category: DOC_CATEGORY[f.category], storageKey: key, mimeType: "application/pdf", size: signed.length,
        sharedWithTenant: r.signers.some((s) => s.tenantId), tenantId: f.tenantId ?? r.signers.find((s) => s.tenantId)?.tenantId ?? null, leaseId: f.leaseId, propertyId: f.propertyId, unitId: f.unitId,
      },
    });
    await db.signatureRequest.update({ where: { id: requestId }, data: { signedDocumentId: doc.id, signedHash: sha256(signed) } });
    await db.signer.updateMany({ where: { requestId, tokenExpiresAt: { not: null } }, data: { tokenExpiresAt: addDays(new Date(), LINK_DAYS) } }); // emailed signers can download their copy
    return doc;
  } catch (e) {
    await db.signatureRequest.update({ where: { id: requestId }, data: { status: "PENDING", completedAt: null } });
    await event(requestId, "completion_failed", { detail: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/** Emails everyone a link to the finished copy (when email is set up). */
export async function notifyCompleted(requestId: string, origin: string) {
  if (!emailConfigured()) return;
  const r = await db.signatureRequest.findUniqueOrThrow({ where: { id: requestId }, include: { signers: true } });
  for (const s of r.signers) {
    if (!s.email || s.isOwner) continue;
    const where = s.tenantId && !s.tokenHash ? `${origin}/portal/documents` : "the same link you used to sign";
    await sendEmail({ to: s.email, toName: s.name, messageId: `sig-done-${s.id}`, subject: `Signed: ${r.title}`, text: `Hi ${s.name.split(" ")[0]},\n\nEveryone has signed "${r.title}". You can download your copy from ${where}.\n\nThank you.` });
  }
}

export const pendingForTenant = (tenantId: string) =>
  db.signer.findMany({ where: { tenantId, status: "PENDING", tokenHash: null, request: { status: "PENDING" } }, include: { request: true }, orderBy: { createdAt: "desc" } });
export const pendingForOwner = () =>
  db.signer.findMany({ where: { isOwner: true, status: "PENDING", request: { status: "PENDING" } }, include: { request: true }, orderBy: { createdAt: "desc" } });
