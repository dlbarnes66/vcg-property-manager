import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { syncLedger } from "@/lib/accounting";
import { finReportRows, readFinParams } from "@/lib/fin-reports";
import { toCsv } from "@/lib/reports";
import { dateToInput } from "@/lib/utils";

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new NextResponse("Forbidden", { status: viewer.userId ? 403 : 401 });
  const { report } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const p = readFinParams({ ...sp, r: report });
  await syncLedger();
  const { title, rows } = await finReportRows(p);
  const csv = toCsv(["Line", "Amount"], rows.map((r) => [r.label, r.amount == null ? "" : (r.amount / 100).toFixed(2)]));
  const name = `${title.toLowerCase().replace(/[^a-z]+/g, "-")}-${dateToInput(p.to)}.csv`;
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
