import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage";

// Public: serves a listing's photo only while that listing is published. Nothing else is reachable here.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await db.document.findFirst({ where: { id, mimeType: { startsWith: "image/" }, listing: { status: "PUBLISHED" } } });
  if (!doc) return new NextResponse("Not found", { status: 404 });
  const obj = await getObject(doc.storageKey);
  if ("url" in obj) return NextResponse.redirect(obj.url);
  return new NextResponse(new Uint8Array(obj.body), {
    headers: { "Content-Type": doc.mimeType, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" },
  });
}
