"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optStr } from "@/lib/form";
import { DOC_CATEGORIES } from "@/lib/enums";
import { deleteObject, putObject } from "@/lib/storage";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif|gif)|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel))$/;
const LINK_KEYS = ["propertyId", "unitId", "tenantId", "leaseId", "maintenanceId", "inspectionId", "listingId", "applicationId"] as const;

function safeReturnPath(fd: FormData) {
  const p = optStr(fd, "returnPath") ?? "/documents";
  return p.startsWith("/") && !p.startsWith("//") ? p : "/documents";
}

export async function uploadDocuments(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Choose at least one file");
    const category = oneOf(fd, "category", DOC_CATEGORIES, "OTHER");
    const link = Object.fromEntries(LINK_KEYS.map((k) => [k, optStr(fd, k)]));

    for (const f of files) {
      if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 20 MB`);
      const type = f.type || "application/octet-stream";
      if (!ALLOWED.test(type)) throw new Error(`${f.name}: file type ${type} isn't allowed (PDF, images, Word, Excel, CSV, text)`);
    }

    for (const f of files) {
      const safeName = f.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
      const storageKey = `docs/${randomUUID()}/${safeName}`;
      await putObject(storageKey, Buffer.from(await f.arrayBuffer()), f.type);
      await db.document.create({
        data: { name: f.name, category, storageKey, mimeType: f.type, size: f.size, sharedWithTenant: bool(fd, "sharedWithTenant"), ...link },
      });
    }
    revalidatePath(safeReturnPath(fd));
    return { ok: true, message: `Uploaded ${files.length} file${files.length > 1 ? "s" : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteDocument(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const doc = await db.document.delete({ where: { id } });
    await deleteObject(doc.storageKey);
    revalidatePath(returnPath.startsWith("/") ? returnPath : "/documents");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleDocumentShare(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    await db.document.update({ where: { id }, data: { sharedWithTenant: !doc.sharedWithTenant } });
    revalidatePath(returnPath.startsWith("/") ? returnPath : "/documents");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
