import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/auth";
import { tenantDocumentWhere } from "@/lib/portal-data";
import { getObject } from "@/lib/storage";

// Streams (local) or redirects to a 5-minute signed URL (R2).
// Admins can open any document; tenants only documents shared with them.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.kind === "none") return new NextResponse(viewer.userId ? "Forbidden" : "Unauthorized", { status: viewer.userId ? 403 : 401 });

  const { id } = await params;
  const doc =
    viewer.kind === "admin"
      ? await db.document.findUnique({ where: { id } })
      : await db.document.findFirst({ where: { id, AND: [await tenantDocumentWhere(viewer.tenant.id)] } });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const obj = await getObject(doc.storageKey);
  if ("url" in obj) return NextResponse.redirect(obj.url);

  const download = new URL(req.url).searchParams.has("download");
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
