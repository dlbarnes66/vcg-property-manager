// Reports: the pure math, and each report's numbers on a small known portfolio. Runs against DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { syncLedger } from "../src/lib/accounting";
import { reportByKey, REPORTS } from "../src/lib/report-defs";
import { csvEscape, presetRange, rangeLabel, readParams, reportToCsv, type ReportParams } from "../src/lib/report-kit";
import { coveredDays, inspectionStatus, recertStatus, vacancyLoss } from "../src/lib/report-math";
import { reportToPdf } from "../src/lib/report-pdf";
import { runTool } from "../src/lib/ai/tools";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};
const Q1 = (): ReportParams => ({ from: d("2034-01-01"), to: d("2034-03-31"), propertyId: ctx.property, propertyName: "__reports test", memo: null });
const asOf = (s: string): ReportParams => ({ ...Q1(), from: d(s), to: d(s) });
const run = async (key: string, p: ReportParams) => reportByKey(key)!.build(p);
const kpi = (r: { kpis: { label: string; value: string }[] }, label: string) => r.kpis.find((k) => k.label === label)?.value;

/* ---------- pure ---------- */

test("covered days: overlaps count once, gaps don't, open-ended runs to the end", () => {
  const from = d("2034-01-01");
  const to = d("2034-01-31");
  assert.equal(coveredDays([], from, to), 0);
  assert.equal(coveredDays([{ start: d("2033-06-01"), end: null }], from, to), 31);
  assert.equal(coveredDays([{ start: d("2034-01-01"), end: d("2034-01-10") }, { start: d("2034-01-05"), end: d("2034-01-12") }], from, to), 12);
  assert.equal(coveredDays([{ start: d("2034-01-01"), end: d("2034-01-10") }, { start: d("2034-01-11"), end: d("2034-01-12") }], from, to), 12, "back-to-back leases");
  assert.equal(coveredDays([{ start: d("2034-01-01"), end: d("2034-01-05") }, { start: d("2034-01-21"), end: d("2034-02-15") }], from, to), 16);
  assert.equal(vacancyLoss(100000, 365), 1200000);
});

test("recert and inspection status", () => {
  const today = d("2034-04-15");
  assert.equal(recertStatus(null, today).label, "Date not set");
  assert.equal(recertStatus(d("2034-04-01"), today).tone, "bad");
  assert.match(recertStatus(d("2034-05-01"), today).label, /Due in 16 days/);
  assert.equal(recertStatus(d("2034-12-01"), today).tone, "good");

  const base = { lastPass: null, scheduled: null, openFailCureBy: null, hasOpenFail: false };
  assert.equal(inspectionStatus(base, today).code, "none");
  assert.equal(inspectionStatus({ ...base, scheduled: d("2034-05-01") }, today).code, "first-scheduled");
  assert.match(inspectionStatus({ ...base, hasOpenFail: true, openFailCureBy: d("2034-04-10") }, today).label, /cure date passed/);
  assert.equal(inspectionStatus({ ...base, lastPass: d("2033-04-01") }, today).code, "overdue");
  assert.equal(inspectionStatus({ ...base, lastPass: d("2033-05-15") }, today).code, "soon-unscheduled");
  assert.equal(inspectionStatus({ ...base, lastPass: d("2033-05-15"), scheduled: d("2034-05-10") }, today).code, "soon-scheduled");
  assert.equal(inspectionStatus({ ...base, lastPass: d("2034-01-15") }, today).code, "current");
});

test("date presets, labels, and params", () => {
  const today = d("2026-10-20");
  assert.deepEqual(presetRange("last-quarter", today), { from: d("2026-07-01"), to: d("2026-09-30") });
  assert.deepEqual(presetRange("last-month", today), { from: d("2026-09-01"), to: d("2026-09-30") });
  assert.deepEqual(presetRange("last-year", today), { from: d("2025-01-01"), to: d("2025-12-31") });
  assert.deepEqual(presetRange("last-quarter", d("2026-02-10")), { from: d("2025-10-01"), to: d("2025-12-31") }, "Q1 → last year's Q4");
  assert.equal(rangeLabel(d("2026-07-01"), d("2026-09-30")), "Q3 2026");
  assert.equal(rangeLabel(d("2026-09-01"), d("2026-09-30")), "September 2026");
  assert.equal(rangeLabel(d("2025-01-01"), d("2025-12-31")), "2025");
  const p = readParams({ from: "2026-05-01", to: "2026-02-01", memo: "  hi  " }, "ytd");
  assert.deepEqual([p.from, p.to, p.memo], [d("2026-02-01"), d("2026-05-01"), "hi"], "swapped dates are put in order");
  const bad = readParams({ from: "garbage" }, "last-quarter");
  assert.equal(bad.from.getUTCDate(), 1, "invalid input falls back to the default");
  assert.equal(csvEscape("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvEscape("-12.50"), "-12.50");
  assert.equal(csvEscape('a "b", c'), '"a ""b"", c"');
});

/* ---------- a small known portfolio in 2034 ---------- */

before(async () => {
  await syncLedger();
  const acct = async (code: string) => (await db.account.findUniqueOrThrow({ where: { code } })).id;
  const p = await db.property.create({ data: { name: "__reports test", street: "1", city: "x", state: "AL", zip: "1", purchaseDate: d("2034-01-01"), purchasePrice: 20000000 } });
  const [ua, ub] = await Promise.all([
    db.unit.create({ data: { propertyId: p.id, label: "A", marketRent: 100000 } }),
    db.unit.create({ data: { propertyId: p.id, label: "B", marketRent: 100000 } }),
  ]);
  const pha = await db.housingAuthority.create({ data: { name: "__Test PHA" } });
  const [ta, tb] = await Promise.all([
    db.tenant.create({ data: { firstName: "__Rep", lastName: "Voucher", caseManagerName: "CM One" } }),
    db.tenant.create({ data: { firstName: "__Rep", lastName: "Market", isVeteran: false } }),
  ]);
  const la = await db.lease.create({
    data: { unitId: ua.id, tenantId: ta.id, startDate: d("2034-01-01"), contractRent: 100000, tenantPortion: 30000, hapAmount: 70000, housingAuthorityId: pha.id, voucherNumber: "V-1", nextRecertDate: d("2034-03-01") },
  });
  const lb = await db.lease.create({ data: { unitId: ub.id, tenantId: tb.id, startDate: d("2034-03-01"), contractRent: 100000, tenantPortion: 100000 } });
  for (const m of ["01", "02", "03"]) {
    await db.charge.create({ data: { leaseId: la.id, type: "RENT", party: "TENANT", amount: 30000, dueDate: d(`2034-${m}-01`), period: `2034-${m}` } });
    await db.charge.create({ data: { leaseId: la.id, type: "RENT", party: "HOUSING_AUTHORITY", amount: 70000, dueDate: d(`2034-${m}-01`), period: `2034-${m}` } });
    await db.payment.create({ data: { leaseId: la.id, party: "TENANT", amount: 30000, paidOn: d(`2034-${m}-03`) } });
    if (m !== "03") await db.payment.create({ data: { leaseId: la.id, party: "HOUSING_AUTHORITY", amount: 70000, paidOn: d(`2034-${m}-02`) } });
  }
  await db.charge.create({ data: { leaseId: lb.id, type: "RENT", party: "TENANT", amount: 100000, dueDate: d("2034-03-01"), period: "2034-03" } });
  await db.payment.create({ data: { leaseId: lb.id, party: "TENANT", amount: 100000, paidOn: d("2034-03-02") } });
  await db.inspection.create({ data: { unitId: ua.id, type: "HQS_ANNUAL", scheduledDate: d("2034-03-10"), completedDate: d("2034-03-10"), result: "FAIL", cureByDate: d("2034-04-10") } });

  const v = await db.vendor.create({ data: { name: "__Rep Vendor" } });
  await db.bill.create({ data: { vendorId: v.id, propertyId: p.id, expenseAccountId: await acct("5000"), billDate: d("2034-02-15"), amount: 15000, description: "Fix" } });
  await db.maintenanceRequest.create({ data: { unitId: ua.id, vendorId: v.id, title: "Door", status: "COMPLETED", reportedOn: d("2034-02-01"), completedOn: d("2034-02-11"), cost: 9000 } });
  await db.maintenanceRequest.create({ data: { unitId: ub.id, title: "Leak", priority: "EMERGENCY", status: "OPEN", reportedOn: d("2034-03-20") } });
  await db.journalEntry.create({
    data: {
      date: d("2034-02-05"), memo: "__mortgage", source: "MANUAL",
      lines: { create: [{ accountId: await acct("5700"), debit: 50000, propertyId: p.id }, { accountId: await acct("2500"), debit: 20000, propertyId: p.id }, { accountId: await acct("1000"), credit: 70000, propertyId: p.id }] },
    },
  });
  Object.assign(ctx, { property: p.id, pha: pha.id, ta: ta.id, tb: tb.id, la: la.id, lb: lb.id, vendor: v.id });
});

after(async () => {
  await db.bill.deleteMany({ where: { vendorId: ctx.vendor } });
  await db.journalEntry.deleteMany({ where: { lines: { some: { propertyId: ctx.property } } } });
  await db.lease.deleteMany({ where: { id: { in: [ctx.la, ctx.lb] } } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.deleteMany({ where: { id: { in: [ctx.ta, ctx.tb] } } });
  await db.housingAuthority.delete({ where: { id: ctx.pha } });
  await db.vendor.delete({ where: { id: ctx.vendor } });
  await db.$disconnect();
});

test("HAP by housing authority: billed, received, past due, and the failed inspection behind it", async () => {
  const r = await run("hap-by-authority", Q1());
  const row = r.tables[0].rows[0];
  assert.equal(row.authority, "__Test PHA");
  assert.deepEqual([row.billed, row.received, row.pastDue, row.leases], [210000, 140000, 70000, 1]);
  const behind = r.tables[1].rows;
  assert.equal(behind.length, 1);
  assert.match(String(behind[0].flag), /Failed inspection, cure by Apr 10, 2034/);
});

test("compliance: overdue recert and a failed inspection past its cure date; market-rate lease excluded", async () => {
  const r = await run("vash-compliance", asOf("2034-04-15"));
  const rows = r.tables[0].rows;
  assert.equal(rows.length, 1);
  assert.match(String(rows[0].recert), /Overdue 45 days/);
  assert.match(String(rows[0].inspection), /cure date passed/);
  assert.equal(rows[0]._tone, "bad");
  assert.equal(kpi(r, "Recerts overdue"), "1");
});

test("property performance: NOI excludes mortgage interest; debt service includes principal", async () => {
  const r = await run("property-performance", Q1());
  const row = r.tables[0].rows[0];
  assert.deepEqual(
    { income: row.income, opex: row.opex, noi: row.noi, debt: row.debtService, cash: row.cashFlow, billed: row.rentBilled, collected: row.collected },
    { income: 400000, opex: 15000, noi: 385000, debt: 70000, cash: 315000, billed: 400000, collected: 330000 },
  );
  assert.equal(row.occupancy, 1, "both units leased on Mar 31");
  // 90 days of NOI annualized over a $200,000 price
  assert.ok(Math.abs((row.capRate as number) - (385000 * (365 / 90)) / 20000000) < 1e-9);
});

test("collections by month and vacancy loss", async () => {
  const c = await run("collections", Q1());
  const mar = c.tables[0].rows.find((x) => x.month === "March 2034")!;
  assert.deepEqual([mar.tb, mar.tc, mar.hb, mar.hc], [130000, 130000, 70000, 0]);
  assert.equal(kpi(c, "Collection rate"), "83%");

  const v = await run("vacancy", Q1());
  const b = v.tables[0].rows.find((x) => String(x.unit).endsWith("· B"))!;
  assert.equal(b.vacant, 59, "Jan 1 – Feb 28");
  assert.equal(b.loss, vacancyLoss(100000, 59));
  assert.equal(v.tables[0].rows.filter((x) => !x._kind).length, 1, "unit A was never vacant");
});

test("work orders and spending", async () => {
  const w = await run("work-orders", Q1());
  assert.equal(kpi(w, "Avg days to complete"), "10.0");
  assert.equal(kpi(w, "Open at end"), "1");
  assert.equal(w.tables[2].rows[0].title, "Leak");

  const s = await run("spending", Q1());
  assert.equal(kpi(s, "Total expenses"), "$650.00", "repairs bill + mortgage interest");
  const vendor = s.tables[2].rows.find((x) => x.vendor === "__Rep Vendor")!;
  assert.deepEqual([vendor.billed, vendor.unbilled, vendor.total], [15000, 9000, 24000]);
});

test("every report builds, exports CSV and a real PDF", async () => {
  for (const def of REPORTS) {
    const p = def.mode === "asOf" ? asOf("2034-03-31") : Q1();
    const r = await def.build({ ...p, memo: def.key === "investor-summary" ? "Strong quarter 🎉 — all units leased." : null });
    assert.ok(r.title && r.period.includes("__reports test"), def.key);
    const csv = reportToCsv(r);
    assert.ok(csv.split("\n").length >= 2, `${def.key} csv`);
    assert.ok(!csv.includes("[object"), `${def.key} csv cells`);
    const pdf = await reportToPdf(r);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", def.key);
    assert.ok(pdf.length > 1500, def.key);
  }
});

test("the AI assistant can run a report", async () => {
  const out = (await runTool("run_report", { report: "hap-by-authority", from: "2034-01-01", to: "2034-03-31", propertyId: ctx.property }, { proposedBy: "t@example.com" })) as { headline: string[]; link: string; tables: { rows: Record<string, string>[] }[] };
  assert.ok(out.headline.some((h) => h.startsWith("HAP past due: $700.00")));
  assert.match(out.link, /^\/reports\/hap-by-authority\?from=2034-01-01&to=2034-03-31&propertyId=/);
  assert.equal(out.tables[0].rows[0]["Housing authority"], "__Test PHA");
  assert.deepEqual(await runTool("run_report", { report: "nope" }, { proposedBy: "t" }), { error: "Unknown report" });
});
