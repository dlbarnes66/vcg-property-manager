import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { cashFlow, delinquency, rentRoll, toCsv } from "@/lib/reports";
import { dateToInput, todayUTC } from "@/lib/utils";

const $ = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));

export async function GET(_: Request, { params }: { params: Promise<{ report: string }> }) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new NextResponse("Forbidden", { status: viewer.userId ? 403 : 401 });

  const { report } = await params;
  let csv: string;
  if (report === "rent-roll") {
    const rows = await rentRoll();
    csv = toCsv(
      ["Property", "Unit", "Beds", "Baths", "Status", "Tenant", "Lease start", "Lease end", "Market rent", "Contract rent", "Tenant portion", "HAP", "Housing authority", "Balance"],
      rows.map((r) => [r.property, r.unit, r.beds, r.baths, r.status, r.tenant, dateToInput(r.leaseStart), dateToInput(r.leaseEnd), $(r.marketRent), $(r.contractRent), $(r.tenantPortion), $(r.hapAmount), r.housingAuthority, $(r.balance)]),
    );
  } else if (report === "delinquency") {
    const rows = await delinquency();
    csv = toCsv(
      ["Property", "Unit", "Tenant", "Owed by", "Payer", "Phone", "Past due", "0-30", "31-60", "61-90", "90+", "Oldest unpaid", "Lease status"],
      rows.map((r) => [r.property, r.unit, r.tenant, r.party, r.payer, r.phone, $(r.pastDue), $(r.aging.current + r.aging.d30), $(r.aging.d60), $(r.aging.d90), $(r.aging.over90), dateToInput(r.oldestPastDue), r.leaseStatus]),
    );
  } else if (report === "cash-flow") {
    const rows = await cashFlow(12);
    csv = toCsv(["Month", "Tenant collections", "HAP collections", "Maintenance", "Net"], rows.map((r) => [r.period, $(r.tenant), $(r.hap), $(r.maintenance), $(r.net)]));
  } else {
    return new NextResponse("Unknown report", { status: 404 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${report}-${dateToInput(todayUTC())}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
