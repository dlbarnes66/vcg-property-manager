"use server";

import { randomUUID } from "crypto";
import type { FormCategory } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer, requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { db } from "@/lib/db";
import { bool, optStr, reqStr } from "@/lib/form";
import { CATEGORY_ORDER, DOC_CATEGORY, formType } from "@/lib/forms/catalog";
import { finalizeForm, setFormShared } from "@/lib/forms/finalize";
import { firstHeading } from "@/lib/forms/markdown";
import { setLandlord } from "@/lib/settings";
import { isStateCode } from "@/lib/states";
import { deleteObject, putObject } from "@/lib/storage";

const email = async () => {
  const v = await getViewer();
  return v.kind === "admin" ? v.email : null;
};
const category = (fd: FormData): FormCategory => {
  const c = optStr(fd, "category");
  return CATEGORY_ORDER.includes(c as FormCategory) ? (c as FormCategory) : "OTHER";
};
const state = (fd: FormData) => {
  const s = optStr(fd, "state");
  if (!isStateCode(s)) throw new Error("Pick a state");
  return s;
};

export async function saveForm(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const body = String(fd.get("body") ?? "");
    if (body.length > 200_000) throw new Error("That's too long to save (200,000 characters max)");
    const title = (optStr(fd, "title") ?? firstHeading(body) ?? "Untitled form").slice(0, 200);
    const f = await db.formDoc.update({ where: { id }, data: { title, body } });
    revalidatePath(`/forms/${id}`);
    return { ok: true, message: f.status === "FINAL" ? "Saved. Click “Update PDF” to replace the saved PDF." : "Draft saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function finishForm(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    // save any unsaved edits that came with the click
    if (fd.has("body")) await db.formDoc.update({ where: { id }, data: { body: String(fd.get("body")), title: (optStr(fd, "title") ?? "Untitled form").slice(0, 200) } });
    await finalizeForm(id, { share: bool(fd, "share") });
    revalidatePath(`/forms/${id}`);
    revalidatePath("/forms");
    return { ok: true, message: `PDF saved to Documents${bool(fd, "share") ? " and shared to the tenant's portal" : ""}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleShare(id: string, share: boolean, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await setFormShared(id, share);
    revalidatePath(`/forms/${id}`);
    return { ok: true, message: share ? "Shared to the tenant's portal" : "No longer shared" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteForm(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    // The saved PDF (if any) stays in Documents; only the editable draft is removed.
    await db.formDoc.delete({ where: { id } });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/forms");
  redirect("/forms");
}

export async function saveAsTemplate(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const f = await db.formDoc.findUniqueOrThrow({ where: { id } });
    const t = await db.formTemplate.create({
      data: {
        title: reqStr(fd, "title", "Template name").slice(0, 200), state: optStr(fd, "state") && isStateCode(optStr(fd, "state")) ? optStr(fd, "state")! : f.state,
        category: f.category, formType: f.formType, body: f.body, description: optStr(fd, "description")?.slice(0, 500), createdByEmail: await email(),
      },
    });
    revalidatePath("/forms");
    return { ok: true, message: `Saved to your ${t.state} library` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Start a form from a library template without the AI (fill in the blanks yourself). */
export async function startFromTemplate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    await requireAccess();
    const t = await db.formTemplate.findUniqueOrThrow({ where: { id: reqStr(fd, "templateId", "Template") } });
    if (!t.body) throw new Error("That library item is an uploaded file. Open it from the library instead.");
    const leaseId = optStr(fd, "leaseId");
    const lease = leaseId ? await db.lease.findUnique({ where: { id: leaseId }, include: { unit: true } }) : null;
    const f = await db.formDoc.create({
      data: {
        title: t.title, formType: t.formType ?? "custom", state: t.state === "US" ? (optStr(fd, "state") ?? "US") : t.state, category: t.category, body: t.body, templateId: t.id,
        leaseId: lease?.id ?? null, tenantId: lease?.tenantId ?? optStr(fd, "tenantId"), unitId: lease?.unitId ?? null, propertyId: lease?.unit.propertyId ?? optStr(fd, "propertyId"),
        vendorId: optStr(fd, "vendorId"), createdByEmail: await email(),
      },
    });
    id = f.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/forms/${id}`);
}

/** Blank form to write by hand. */
export async function startBlank(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    await requireAccess();
    const ft = formType(optStr(fd, "formType") ?? "");
    const leaseId = optStr(fd, "leaseId");
    const lease = leaseId ? await db.lease.findUnique({ where: { id: leaseId }, include: { unit: true } }) : null;
    const f = await db.formDoc.create({
      data: {
        title: ft?.title ?? "Untitled form", formType: ft?.key ?? "custom", state: state(fd), category: ft?.category ?? "OTHER", body: `# ${ft?.title ?? "Untitled form"}\n\n`,
        leaseId: lease?.id ?? null, tenantId: lease?.tenantId ?? optStr(fd, "tenantId"), unitId: lease?.unitId ?? null, propertyId: lease?.unit.propertyId ?? optStr(fd, "propertyId"),
        vendorId: optStr(fd, "vendorId"), createdByEmail: await email(),
      },
    });
    id = f.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/forms/${id}`);
}

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain|text\/markdown)$/;

/** Upload an existing form (e.g. attorney-approved PDF or Word file) into a state's library. */
export async function uploadTemplate(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file");
    if (file.size > MAX_BYTES) throw new Error("Files can be up to 20 MB");
    const type = file.type || "application/octet-stream";
    if (!ALLOWED.test(type)) throw new Error("Upload a PDF, Word (.doc/.docx), or text file");
    const st = state(fd);
    const cat = category(fd);
    const title = (optStr(fd, "title") ?? file.name.replace(/\.[^.]+$/, "")).slice(0, 200);
    const isText = type.startsWith("text/");
    const buf = Buffer.from(await file.arrayBuffer());
    if (isText) {
      // Text becomes an editable template the AI can start from.
      await db.formTemplate.create({ data: { title, state: st, category: cat, body: buf.toString("utf8").slice(0, 200_000), description: optStr(fd, "description")?.slice(0, 500), createdByEmail: await email() } });
    } else {
      const storageKey = `docs/${randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, "_").slice(-120)}`;
      await putObject(storageKey, buf, type);
      const doc = await db.document.create({ data: { name: file.name, category: DOC_CATEGORY[cat], storageKey, mimeType: type, size: file.size } });
      await db.formTemplate.create({ data: { title, state: st, category: cat, documentId: doc.id, description: optStr(fd, "description")?.slice(0, 500), createdByEmail: await email() } });
    }
    revalidatePath("/forms");
    return { ok: true, message: `Added to the ${st} library` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTemplate(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const t = await db.formTemplate.delete({ where: { id }, include: { document: true } });
    if (t.document) {
      await db.document.delete({ where: { id: t.document.id } });
      await deleteObject(t.document.storageKey).catch(() => {});
    }
    revalidatePath("/forms");
    return { ok: true, message: "Removed from the library" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveLandlordDetails(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await setLandlord({ ownerName: optStr(fd, "ownerName") ?? "", managerName: optStr(fd, "managerName") ?? "", address: optStr(fd, "address") ?? "", phone: optStr(fd, "phone") ?? "", email: optStr(fd, "email") ?? "" });
    revalidatePath("/forms");
    return { ok: true, message: "Saved. New forms will use these details." };
  } catch (e) {
    return toActionError(e);
  }
}
