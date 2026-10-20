import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { fileSlug, reportToCsv } from "@/lib/report-kit";
import { reportToPdf } from "@/lib/report-pdf";
import { resolveReport } from "@/lib/report-run";
import { dateToInput } from "@/lib/utils";

export const runtime = "nodejs";

/** GET /api/reports/<key>?from=&to=&propertyId=&format=csv|pdf */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new NextResponse("Forbidden", { status: viewer.userId ? 403 : 401 });

  const { report } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const resolved = await resolveReport(report, sp);
  if (!resolved) return new NextResponse("Unknown report", { status: 404 });
  const { def, params: p } = resolved;
  const data = await def.build(p);

  const name = `${fileSlug(def.title)}${p.propertyName ? `-${fileSlug(p.propertyName)}` : ""}-${def.mode === "asOf" ? dateToInput(p.to) : `${dateToInput(p.from)}-to-${dateToInput(p.to)}`}`;
  const headers = { "Cache-Control": "private, no-store" };
  if (sp.format === "pdf") {
    const pdf = await reportToPdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `${sp.inline ? "inline" : "attachment"}; filename="${name}.pdf"` },
    });
  }
  // BOM so Excel opens the file as UTF-8 (names with accents, the – in ranges)
  return new NextResponse("﻿" + reportToCsv(data), {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
  });
}
