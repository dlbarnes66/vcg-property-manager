import "server-only";
import { randomUUID } from "crypto";
import { db } from "../db";
import { deleteObject, putObject } from "../storage";
import { stateName } from "../states";
import { DOC_CATEGORY } from "./catalog";
import { formToPdf } from "./pdf";

const fileName = (title: string) => `${title.replace(/[^\w.\- ]+/g, "").trim().slice(0, 100) || "Form"}.pdf`;

/**
 * Saves the form as a PDF in Documents (linked to the same tenant/lease/property/vendor) and marks it
 * final. Re-finalizing replaces the PDF. `share` controls whether the tenant sees it in their portal.
 */
export async function finalizeForm(id: string, opts: { share: boolean }) {
  const f = await db.formDoc.findUniqueOrThrow({ where: { id }, include: { document: true } });
  if (!f.body.trim()) throw new Error("The form is empty");
  if (opts.share && !f.tenantId) throw new Error("Link this form to a tenant or lease before sharing it to a portal");
  const pdf = await formToPdf(f.title, f.body, `${f.title} · ${stateName(f.state)}`);
  const storageKey = `docs/${randomUUID()}/${fileName(f.title)}`;
  await putObject(storageKey, pdf, "application/pdf");

  const data = {
    name: fileName(f.title), category: DOC_CATEGORY[f.category], storageKey, mimeType: "application/pdf", size: pdf.length,
    sharedWithTenant: opts.share, tenantId: f.tenantId, leaseId: f.leaseId, propertyId: f.propertyId, unitId: f.unitId,
  };
  const old = f.document;
  const document = old ? await db.document.update({ where: { id: old.id }, data }) : await db.document.create({ data });
  if (old) await deleteObject(old.storageKey).catch(() => {}); // the old file; the record now points at the new one
  return db.formDoc.update({ where: { id }, data: { status: "FINAL", finalizedAt: new Date(), documentId: document.id } });
}

/** Turns portal sharing on or off for a finished form's PDF. */
export async function setFormShared(id: string, share: boolean) {
  const f = await db.formDoc.findUniqueOrThrow({ where: { id } });
  if (!f.documentId) throw new Error("Finish the form first");
  if (share && !f.tenantId) throw new Error("This form isn't linked to a tenant");
  await db.document.update({ where: { id: f.documentId }, data: { sharedWithTenant: share } });
}
