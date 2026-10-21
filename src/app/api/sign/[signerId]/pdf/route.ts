import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { signerByToken } from "@/lib/esign";
import { getObject } from "@/lib/storage";

/**
 * GET → the document a signer is asked to sign (or, once complete, the signed copy with ?final=1).
 * Allowed for: you (admin), the tenant the signer belongs to, or the holder of the signer's private link (?token=).
 */
export async function GET(req: Request, { params }: { params: Promise<{ signerId: string }> }) {
  const { signerId } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const signer = await db.signer.findUnique({ where: { id: signerId }, include: { request: { include: { signedDocument: true } } } });
  if (!signer) return new NextResponse("Not found", { status: 404 });

  let allowed = false;
  if (token) allowed = (await signerByToken(token))?.id === signer.id;
  else {
    const v = await getViewer();
    allowed = v.kind === "admin" || (v.kind === "tenant" && signer.tenantId === v.tenant.id);
  }
  if (!allowed) return new NextResponse("Not found", { status: 404 });
  if (signer.request.status === "CANCELLED") return new NextResponse("This request was cancelled", { status: 410 });

  const wantFinal = url.searchParams.has("final");
  const key = wantFinal ? signer.request.signedDocument?.storageKey : signer.request.originalKey;
  if (!key) return new NextResponse("Not ready yet", { status: 404 });
  const obj = await getObject(key);
  if ("url" in obj) return NextResponse.redirect(obj.url);
  const name = `${signer.request.title.replace(/[^\w.\- ]+/g, "").trim() || "Document"}${wantFinal ? " (signed)" : ""}.pdf`;
  return new NextResponse(new Uint8Array(obj.body), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
