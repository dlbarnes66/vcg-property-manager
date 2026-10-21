"use server";

import type { SignerRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getViewer, requireAccess } from "@/lib/auth";
import { toActionError } from "@/lib/actions-util";
import { db } from "@/lib/db";
import { cancelRequest, completeRequest, createSignatureRequest, notifyCompleted, notifySigners, reissueLink, type SignerInput } from "@/lib/esign";
import { appOrigin } from "@/lib/portal";

export type SendResult = { ok?: boolean; error?: string; message?: string; links?: { name: string; url: string; reason: string }[] } | null;
const ROLES: SignerRole[] = ["COSIGNER", "VENDOR", "OTHER", "TENANT"];

export async function sendForSignature(formId: string, _: SendResult, fd: FormData): Promise<SendResult> {
  try {
    await requireAccess();
    const v = await getViewer();
    const form = await db.formDoc.findUniqueOrThrow({ where: { id: formId }, include: { tenant: true, vendor: true } });
    const signers: SignerInput[] = [];
    if (fd.get("tenant") === "on" && form.tenant)
      signers.push({ role: "TENANT", name: `${form.tenant.firstName} ${form.tenant.lastName}`, email: String(fd.get("tenantEmail") ?? "") || form.tenant.email, tenantId: form.tenant.id });
    for (let i = 0; i < 3; i++) {
      const name = String(fd.get(`name${i}`) ?? "").trim();
      if (!name) continue;
      const role = ROLES.includes(fd.get(`role${i}`) as SignerRole) ? (fd.get(`role${i}`) as SignerRole) : "OTHER";
      signers.push({ role, name, email: String(fd.get(`email${i}`) ?? "") });
    }
    if (fd.get("owner") === "on") signers.push({ role: "LANDLORD", name: String(fd.get("ownerName") ?? "").trim() || "Landlord", isOwner: true });
    const { request, links } = await createSignatureRequest(formId, { signers, message: String(fd.get("message") ?? ""), createdByEmail: v.kind === "admin" ? v.email : null });
    const notSent = await notifySigners(request.id, links, await appOrigin());
    revalidatePath(`/forms/${formId}`);
    revalidatePath("/forms", "layout");
    const toCopy = notSent.filter((n) => n.url) as { name: string; url: string; reason: string }[];
    const portalNotEmailed = notSent.filter((n) => !n.url).map((n) => n.name);
    return {
      ok: true,
      message: [
        "Sent for signature.",
        portalNotEmailed.length ? `${portalNotEmailed.join(", ")} will see it in their portal (no email was sent).` : "",
        toCopy.length ? "Email isn't available for these signers. Copy their private link and send it yourself (text or email):" : "",
      ].filter(Boolean).join(" "),
      links: toCopy,
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function newSigningLink(signerId: string, _: SendResult): Promise<SendResult> {
  try {
    await requireAccess();
    const l = await reissueLink(signerId);
    const s = await db.signer.findUniqueOrThrow({ where: { id: signerId } });
    const notSent = await notifySigners(s.requestId, [l], await appOrigin());
    revalidatePath("/forms", "layout");
    return notSent.length
      ? { ok: true, message: "New link created (the old one no longer works). Send it yourself:", links: notSent.filter((n) => n.url) as { name: string; url: string; reason: string }[] }
      : { ok: true, message: `New link emailed to ${l.email}. The old link no longer works.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelSignatureRequest(requestId: string, _: SendResult): Promise<SendResult> {
  try {
    await requireAccess();
    const v = await getViewer();
    await cancelRequest(requestId, v.kind === "admin" ? v.email : null);
    revalidatePath("/forms", "layout");
    revalidatePath("/portal", "layout");
    return { ok: true, message: "Cancelled. Signers' links no longer work." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function retryCompletion(requestId: string, _: SendResult): Promise<SendResult> {
  try {
    await requireAccess();
    const doc = await completeRequest(requestId);
    if (doc) await notifyCompleted(requestId, await appOrigin()).catch(() => {});
    revalidatePath("/forms", "layout");
    return { ok: true, message: doc ? "Signed PDF created" : "Nothing to do" };
  } catch (e) {
    return toActionError(e);
  }
}
