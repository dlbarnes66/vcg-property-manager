"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { db } from "@/lib/db";
import { declineAsSigner, notifyCompleted, signAsSigner, signerByToken } from "@/lib/esign";
import { appOrigin } from "@/lib/portal";
import { requestMeta } from "@/lib/request-meta";

/**
 * Who is signing? A private-link signer proves it with the token; tenants and you are already
 * signed in. Anything else is refused.
 */
async function resolveSigner(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  if (token) {
    const s = await signerByToken(token);
    if (!s) throw new Error("This signing link has expired or is no longer valid. Ask for a new one.");
    return s.id;
  }
  const signerId = String(fd.get("signerId") ?? "");
  const s = signerId ? await db.signer.findUnique({ where: { id: signerId } }) : null;
  const v = await getViewer();
  if (s && v.kind === "admin" && s.isOwner) return s.id;
  if (s && v.kind === "tenant" && s.tenantId === v.tenant.id && !s.tokenHash) return s.id;
  throw new Error("You can't sign this document from this account.");
}

const revalidateAll = () => {
  revalidatePath("/portal", "layout");
  revalidatePath("/forms", "layout");
};

export async function submitSignature(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const signerId = await resolveSigner(fd);
    const meta = await requestMeta();
    const req = await signAsSigner(signerId, {
      consent: fd.get("consent") === "on", type: String(fd.get("type") ?? "typed"), text: String(fd.get("text") ?? ""), image: (fd.get("image") as string) || null, ...meta,
    });
    if (req.status === "COMPLETED") await notifyCompleted(req.id, await appOrigin()).catch(() => {});
    revalidateAll();
    return { ok: true, message: req.status === "COMPLETED" ? "Signed. Everyone has signed, and the final copy is ready to download." : "Signed. We'll let you know when everyone has signed." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function declineToSign(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const signerId = await resolveSigner(fd);
    await declineAsSigner(signerId, String(fd.get("reason") ?? ""), await requestMeta());
    revalidateAll();
    return { ok: true, message: "You declined to sign. The landlord has been notified." };
  } catch (e) {
    return toActionError(e);
  }
}
