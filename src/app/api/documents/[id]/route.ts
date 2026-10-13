import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage";

// Streams (local) or redirects to a 5-minute signed URL (R2). Requires a signed-in session.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return new NextResponse("Unauthorized", { status: 401 });
  // Mirror requireAccess() email allow-list without redirecting
  const allow = (process.env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (allow.length) {
    const { currentUser } = await import("@clerk/nextjs/server");
    const user = await currentUser();
    if (!user?.emailAddresses.some((e) => allow.includes(e.emailAddress.toLowerCase())))
      return new NextResponse("Forbidden", { status: 403 });
  }

  const { id } = await params;
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return new NextResponse("Not found", { status: 404 });

  const obj = await getObject(doc.storageKey);
  if ("url" in obj) return NextResponse.redirect(obj.url);

  const download = new URL(req.url).searchParams.has("download");
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.name)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
