import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { formToPdf } from "@/lib/forms/pdf";
import { stateName } from "@/lib/states";

export const runtime = "nodejs";

/** GET → a preview PDF of the form as it is now (finished forms are also saved in Documents). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new NextResponse("Forbidden", { status: viewer.userId ? 403 : 401 });
  const f = await db.formDoc.findUnique({ where: { id: (await params).id } });
  if (!f) return new NextResponse("Not found", { status: 404 });
  const pdf = await formToPdf(f.title, f.body, `${f.title} · ${stateName(f.state)}`);
  const name = `${f.title.replace(/[^\w.\- ]+/g, "").trim().slice(0, 100) || "Form"}.pdf`;
  const inline = new URL(req.url).searchParams.has("inline");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
