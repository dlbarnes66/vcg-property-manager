/*
 * The report catalog. Each report turns data from report-data.ts into a ReportData that the
 * screen, CSV export, PDF export, and AI assistant all share.
 */
import {
  collectionsData, complianceData, hapData, inspectionsCompleted, performanceData, spendingData, vacancyData, voucherMixData, workOrderData,
} from "./report-data";
import { pct, rangeLabel, ratio, type Col, type ReportData, type ReportParams, type RangePreset, type Row } from "./report-kit";
import { cashFlow, delinquency, rentRoll } from "./reports";
import { fmtDate, money, periodLabel, titleCase } from "./utils";

export type ReportGroup = "HUD-VASH" | "Investors" | "Rent & collections" | "Maintenance & operations";
export type ReportDef = {
  key: string;
  group: ReportGroup;
  title: string;
  description: string;
  /** "range": from/to; "asOf": a single date (uses `to`) */
  mode: "range" | "asOf";
  defaultRange: RangePreset;
  build: (p: ReportParams) => Promise<ReportData>;
};

const scope = (p: ReportParams) => (p.propertyName ? ` · ${p.propertyName}` : "");
const rangeTitle = (p: ReportParams) => rangeLabel(p.from, p.to) + scope(p);
const asOfTitle = (p: ReportParams) => `As of ${fmtDate(p.to)}` + scope(p);
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const total = (cols: Record<string, number | string | null>): Row => ({ _kind: "total", ...cols });

/* ------------------------------------------------------------------------------------------------ */

const hapByAuthority: ReportDef = {
  key: "hap-by-authority",
  group: "HUD-VASH",
  title: "HAP by housing authority",
  description: "HAP billed vs. received for each housing authority, what's past due, and which units have a failed inspection that can hold payment.",
  mode: "range",
  defaultRange: "ytd",
  async build(p) {
    const { authorities, leases } = await hapData(p);
    const behind = leases.filter((l) => l.pastDue > 0).sort((a, b) => b.pastDue - a.pastDue);
    const t = {
      leases: sum(authorities, (a) => a.leases), hapMonthly: sum(authorities, (a) => a.hapMonthly), billed: sum(authorities, (a) => a.billed),
      received: sum(authorities, (a) => a.received), pastDue: sum(authorities, (a) => a.pastDue),
    };
    const cols: Col[] = [
      { key: "authority", label: "Housing authority", w: 3 }, { key: "leases", label: "Voucher leases", fmt: "int" }, { key: "hapMonthly", label: "HAP / month", fmt: "money" },
      { key: "billed", label: "Billed", fmt: "money" }, { key: "received", label: "Received", fmt: "money" }, { key: "rate", label: "Collected", fmt: "pct" },
      { key: "d30", label: "Past due 0–30", fmt: "money" }, { key: "d60", label: "31–60", fmt: "money" }, { key: "d90", label: "61–90+", fmt: "money" },
      { key: "pastDue", label: "Total past due", fmt: "money" }, { key: "oldest", label: "Oldest unpaid" },
    ];
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Voucher leases", value: String(t.leases), sub: `${money(t.hapMonthly)} HAP / month` },
        { label: "HAP billed", value: money(t.billed) },
        { label: "HAP received", value: money(t.received), sub: `${pct(ratio(t.received, t.billed))} of billed` },
        { label: "HAP past due", value: money(t.pastDue), tone: t.pastDue > 0 ? "bad" : "good", sub: `as of ${fmtDate(p.to)}` },
      ],
      tables: [
        {
          title: "By housing authority",
          columns: cols,
          empty: "No voucher leases yet. Add a housing authority and HAP amount to a lease.",
          rows: [
            ...authorities.map((a) => ({
              authority: a.authority, leases: a.leases, hapMonthly: a.hapMonthly, billed: a.billed, received: a.received, rate: ratio(a.received, a.billed),
              d30: a.aging.current + a.aging.d30, d60: a.aging.d60, d90: a.aging.d90 + a.aging.over90, pastDue: a.pastDue, oldest: a.oldestPastDue,
              _tone: a.pastDue > 0 ? ("bad" as const) : undefined,
            })),
            ...(authorities.length > 1
              ? [total({ authority: "Total", leases: t.leases, hapMonthly: t.hapMonthly, billed: t.billed, received: t.received, rate: ratio(t.received, t.billed), d30: sum(authorities, (a) => a.aging.current + a.aging.d30), d60: sum(authorities, (a) => a.aging.d60), d90: sum(authorities, (a) => a.aging.d90 + a.aging.over90), pastDue: t.pastDue, oldest: null })]
              : []),
          ],
        },
        {
          title: "Leases with HAP past due",
          columns: [
            { key: "unit", label: "Unit", w: 2.5 }, { key: "tenant", label: "Tenant", w: 2 }, { key: "authority", label: "Housing authority", w: 2.5 }, { key: "voucher", label: "Voucher #" },
            { key: "pastDue", label: "Past due", fmt: "money" }, { key: "oldest", label: "Oldest unpaid" }, { key: "flag", label: "Likely reason", w: 2.5 },
          ],
          empty: "No HAP is past due.",
          rows: behind.map((l) => ({
            unit: `${l.property} · ${l.unit}`, tenant: l.tenant, authority: l.authority, voucher: l.voucherNumber, pastDue: l.pastDue, oldest: l.oldestPastDue,
            flag: l.failedInspection ? `Failed inspection${l.failedInspection.cureByDate ? `, cure by ${fmtDate(l.failedInspection.cureByDate)}` : ""}` : l.inForce ? "" : "Lease ended",
            _href: `/leases/${l.leaseId}`, _tone: "bad" as const,
          })),
        },
      ],
      notes: [
        "Billed and received cover the selected dates; past due is as of the end date.",
        "Housing authorities most often hold HAP for a failed inspection, a late recertification, or a missing HAP contract or change-of-rent form.",
      ],
    };
  },
};

const compliance: ReportDef = {
  key: "vash-compliance",
  group: "HUD-VASH",
  title: "Recertification & inspection compliance",
  description: "Every voucher household: next income recertification, last passed HQS/NSPIRE inspection, and anything overdue or failed.",
  mode: "asOf",
  defaultRange: "this-month",
  async build(p) {
    const d = await complianceData(p);
    return {
      title: this.title,
      period: asOfTitle(p),
      kpis: [
        { label: "Voucher households", value: String(d.rows.length) },
        { label: "Recerts overdue", value: String(d.recertOverdue), tone: d.recertOverdue ? "bad" : "good", sub: d.recertMissing ? `${d.recertMissing} with no date set` : undefined },
        { label: "Recerts due in 90 days", value: String(d.recertSoon) },
        { label: "Inspection problems", value: String(d.inspectionIssues), tone: d.inspectionIssues ? "bad" : "good", sub: d.inspectionSoon ? `+${d.inspectionSoon} due soon and not scheduled` : "failed, overdue, or none on file" },
      ],
      tables: [
        {
          columns: [
            { key: "unit", label: "Unit", w: 2.5 }, { key: "tenant", label: "Tenant", w: 2 }, { key: "authority", label: "Housing authority", w: 2.2 }, { key: "caseManager", label: "Case manager", w: 2 },
            { key: "nextRecert", label: "Next recert" }, { key: "recert", label: "Recert status", w: 1.6 },
            { key: "lastPass", label: "Last passed inspection" }, { key: "nextDue", label: "Inspection due" }, { key: "inspection", label: "Inspection status", w: 2.6 },
          ],
          empty: "No voucher households in force on this date.",
          rows: d.rows.map((x) => ({
            unit: `${x.property} · ${x.unit}`, tenant: x.tenant, authority: x.authority, caseManager: x.caseManager,
            nextRecert: x.nextRecert, recert: x.recert.label, lastPass: x.lastPass, nextDue: x.nextInspectionDue,
            inspection: x.cureBy && x.inspection.tone === "bad" && x.inspection.label.startsWith("Failed") ? `${x.inspection.label} (${fmtDate(x.cureBy)})` : x.inspection.label,
            _href: `/leases/${x.leaseId}`, _tone: x.tone,
          })),
        },
      ],
      notes: [
        "Recertification dates come from each lease's \"Next recert\" field. \"Due soon\" means within 90 days.",
        "Annual inspection is due one year after the last passed HQS, NSPIRE, or re-inspection. A failed inspection stays open until a later inspection is recorded for the unit.",
      ],
    };
  },
};

const voucherMix: ReportDef = {
  key: "voucher-mix",
  group: "HUD-VASH",
  title: "Rent split & voucher mix",
  description: "How much of each property's rent comes from housing authorities vs. tenants, and how many veteran households you house.",
  mode: "asOf",
  defaultRange: "this-month",
  async build(p) {
    const rows = await voucherMixData(p);
    const t = { units: sum(rows, (r) => r.units), occupied: sum(rows, (r) => r.occupied), voucher: sum(rows, (r) => r.voucher), veterans: sum(rows, (r) => r.veterans), contractRent: sum(rows, (r) => r.contractRent), tenantPortion: sum(rows, (r) => r.tenantPortion), hap: sum(rows, (r) => r.hap), vtp: sum(rows, (r) => r.voucherTenantPortion) };
    return {
      title: this.title,
      period: asOfTitle(p),
      kpis: [
        { label: "Veteran households", value: String(t.veterans), sub: `of ${t.occupied} occupied units` },
        { label: "Voucher leases", value: String(t.voucher), sub: pct(ratio(t.voucher, t.occupied)) + " of occupied" },
        { label: "HAP share of rent", value: pct(ratio(t.hap, t.contractRent)), sub: `${money(t.hap)} of ${money(t.contractRent)} / month` },
        { label: "Avg tenant portion", value: money(t.voucher ? Math.round(t.vtp / t.voucher) : null), sub: "voucher leases" },
      ],
      tables: [
        {
          columns: [
            { key: "property", label: "Property", w: 3 }, { key: "units", label: "Units", fmt: "int" }, { key: "occupied", label: "Occupied", fmt: "int" }, { key: "voucher", label: "Voucher leases", fmt: "int" },
            { key: "veterans", label: "Veteran households", fmt: "int" }, { key: "contractRent", label: "Contract rent / mo", fmt: "money" }, { key: "tenantPortion", label: "Tenant portion", fmt: "money" },
            { key: "hap", label: "HAP", fmt: "money" }, { key: "share", label: "HAP share", fmt: "pct" }, { key: "bar", label: "", fmt: "bar" },
          ],
          empty: "No properties yet.",
          rows: [
            ...rows.map((r) => ({ property: r.property, units: r.units, occupied: r.occupied, voucher: r.voucher, veterans: r.veterans, contractRent: r.contractRent, tenantPortion: r.tenantPortion, hap: r.hap, share: ratio(r.hap, r.contractRent), bar: ratio(r.hap, r.contractRent) ?? 0, _href: `/properties/${r.propertyId}` })),
            ...(rows.length > 1 ? [total({ property: "Total", units: t.units, occupied: t.occupied, voucher: t.voucher, veterans: t.veterans, contractRent: t.contractRent, tenantPortion: t.tenantPortion, hap: t.hap, share: ratio(t.hap, t.contractRent), bar: null })] : []),
          ],
        },
      ],
      notes: ["Based on leases in force on the date shown. Veteran households are tenants marked as veterans."],
    };
  },
};

/* ------------------------------------------------------------------------------------------------ */

const PERF_COLS: Col[] = [
  { key: "property", label: "Property", w: 2.6 }, { key: "units", label: "Units", fmt: "int", w: 0.7 }, { key: "occupancy", label: "Occupied", fmt: "pct", w: 0.9 },
  { key: "gpr", label: "Potential rent", fmt: "money" }, { key: "rentBilled", label: "Rent billed", fmt: "money" }, { key: "collected", label: "Collected", fmt: "money" },
  { key: "income", label: "Income", fmt: "money" }, { key: "opex", label: "Op. expenses", fmt: "money" }, { key: "noi", label: "NOI", fmt: "money" },
  { key: "debtService", label: "Debt service", fmt: "money" }, { key: "cashFlow", label: "Cash flow", fmt: "money" }, { key: "capRate", label: "Cap rate", fmt: "pct", w: 0.9 },
];

const performance: ReportDef = {
  key: "property-performance",
  group: "Investors",
  title: "Property performance (NOI)",
  description: "Per-property income, operating expenses, NOI, debt service, cash flow, and annualized cap rate — straight from the books.",
  mode: "range",
  defaultRange: "ytd",
  async build(p) {
    const d = await performanceData(p);
    const row = (x: (typeof d.rows)[number] | typeof d.total, isTotal = false): Row => ({
      property: x.property, units: x.units || null, occupancy: x.units ? x.occupied / x.units : null, gpr: x.gpr, rentBilled: x.rentBilled, collected: x.collected,
      income: x.income, opex: x.opex, noi: x.noi, debtService: x.debtService, cashFlow: x.cashFlow, capRate: x.capRate,
      _href: !isTotal && x.propertyId ? `/properties/${x.propertyId}` : undefined, _kind: isTotal ? "total" : undefined, _tone: x.cashFlow < 0 ? "bad" : undefined,
    });
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Income", value: money(d.total.income) },
        { label: "Operating expenses", value: money(d.total.opex), sub: d.total.income ? `${pct(ratio(d.total.opex, d.total.income))} expense ratio` : undefined },
        { label: "Net operating income", value: money(d.total.noi), tone: d.total.noi < 0 ? "bad" : "default", sub: d.total.capRate != null ? `${pct(d.total.capRate, 1)} cap rate (annualized)` : undefined },
        { label: "Cash flow after debt service", value: money(d.total.cashFlow), tone: d.total.cashFlow < 0 ? "bad" : "good", sub: `${money(d.total.debtService)} debt service` },
      ],
      tables: [{ columns: PERF_COLS, rows: [...d.rows.map((x) => row(x)), ...(d.rows.length > 1 ? [row(d.total, true)] : [])], empty: "No properties yet." }],
      notes: [
        "Accrual basis, from Accounting: income when rent is charged, expenses when bills are entered.",
        "Operating expenses exclude mortgage interest (5700). Debt service = mortgage interest + principal paid (entries that reduce 2500 Mortgage Payable).",
        "Potential rent = market rent (or lease rent if no market rent is set) for every unit over the period. Occupied = units with a lease in force on the end date.",
        "Cap rate = NOI annualized ÷ purchase price.",
      ],
    };
  },
};

const investorSummary: ReportDef = {
  key: "investor-summary",
  group: "Investors",
  title: "Investor summary",
  description: "A one-document quarterly update for Fund I investors: portfolio KPIs, NOI by property, collections, HUD-VASH compliance, and maintenance.",
  mode: "range",
  defaultRange: "last-quarter",
  async build(p) {
    const [perf, col, comp, mix, wo, insp, hap] = await Promise.all([
      performanceData(p), collectionsData(p), complianceData(p), voucherMixData(p), workOrderData(p), inspectionsCompleted(p), hapData(p),
    ]);
    const t = perf.total;
    const veterans = sum(mix, (m) => m.veterans);
    const rent = sum(mix, (m) => m.contractRent);
    const hapMo = sum(mix, (m) => m.hap);
    const billed = col.tenantBilled + col.hapBilled;
    const collected = col.tenantCollected + col.hapCollected;
    const tenantPastDue = sum(await delinquency(p.to, p.propertyId), (r) => (r.party === "Tenant" ? r.pastDue : 0));
    const hapPastDue = sum(hap.leases, (l) => l.pastDue);
    const subset = PERF_COLS.filter((c) => ["property", "units", "occupancy", "income", "opex", "noi", "debtService", "cashFlow"].includes(c.key));
    return {
      title: this.title,
      period: rangeTitle(p),
      memo: p.memo,
      kpis: [
        { label: "Portfolio", value: `${t.units} units`, sub: `${perf.rows.filter((r) => r.propertyId).length} properties` },
        { label: "Occupancy", value: pct(ratio(t.occupied, t.units)), sub: `${t.occupied} occupied on ${fmtDate(p.to)}` },
        { label: "Veteran households", value: String(veterans), sub: `HAP is ${pct(ratio(hapMo, rent))} of rent` },
        { label: "Net operating income", value: money(t.noi), tone: t.noi < 0 ? "bad" : "default", sub: `${money(t.income)} income` },
        { label: "Cash flow", value: money(t.cashFlow), tone: t.cashFlow < 0 ? "bad" : "good", sub: "after debt service" },
        { label: "Collections", value: pct(ratio(collected, billed)), sub: `${money(collected)} of ${money(billed)} billed` },
      ],
      tables: [
        { title: "Performance by property", columns: subset, rows: [...perf.rows.map((x) => ({ property: x.property, units: x.units || null, occupancy: x.units ? x.occupied / x.units : null, income: x.income, opex: x.opex, noi: x.noi, debtService: x.debtService, cashFlow: x.cashFlow })), ...(perf.rows.length > 1 ? [{ _kind: "total" as const, property: "Total", units: t.units, occupancy: ratio(t.occupied, t.units), income: t.income, opex: t.opex, noi: t.noi, debtService: t.debtService, cashFlow: t.cashFlow }] : [])], empty: "No properties yet." },
        {
          title: "Rent collections",
          columns: [{ key: "who", label: "Paid by", w: 2 }, { key: "billed", label: "Billed", fmt: "money" }, { key: "collected", label: "Collected", fmt: "money" }, { key: "rate", label: "Collection rate", fmt: "pct" }, { key: "pastDue", label: `Past due ${fmtDate(p.to)}`, fmt: "money" }],
          rows: [
            { who: "Tenants", billed: col.tenantBilled, collected: col.tenantCollected, rate: ratio(col.tenantCollected, col.tenantBilled), pastDue: tenantPastDue },
            { who: "Housing authorities (HAP)", billed: col.hapBilled, collected: col.hapCollected, rate: ratio(col.hapCollected, col.hapBilled), pastDue: hapPastDue },
            { _kind: "total", who: "Total", billed, collected, rate: ratio(collected, billed), pastDue: tenantPastDue + hapPastDue },
          ],
        },
        {
          title: "HUD-VASH compliance",
          columns: [{ key: "item", label: "Item", w: 3 }, { key: "value", label: "Count", fmt: "int" }],
          rows: [
            { item: "Voucher households", value: comp.rows.length },
            { item: "Inspections completed this period", value: insp.total },
            { item: "Inspections passed this period", value: insp.passed },
            { item: "Recertifications overdue", value: comp.recertOverdue, _tone: comp.recertOverdue ? "bad" : undefined },
            { item: "Recertifications due in the next 90 days", value: comp.recertSoon },
            { item: "Units with an inspection problem (failed, overdue, or none on file)", value: comp.inspectionIssues, _tone: comp.inspectionIssues ? "bad" : undefined },
          ],
        },
        {
          title: "Maintenance",
          columns: [{ key: "item", label: "Item", w: 3 }, { key: "value", label: "Value", w: 1.5 }],
          rows: [
            { item: "Work orders opened", value: String(wo.opened) },
            { item: "Work orders completed", value: String(wo.completed) },
            { item: "Average days to complete", value: wo.avgClose == null ? "—" : wo.avgClose.toFixed(1) },
            { item: `Open at ${fmtDate(p.to)}`, value: String(wo.open) },
            { item: "Cost of completed work orders", value: money(wo.cost) },
          ],
        },
      ],
      notes: [
        "Unaudited. Prepared from VCG Property Manager records on an accrual basis; operating expenses exclude mortgage interest.",
        "Collections compare rent and fees billed in the period with payments received in the period.",
      ],
    };
  },
};

const cashFlowReport: ReportDef = {
  key: "cash-flow",
  group: "Investors",
  title: "Cash flow by month",
  description: "Simple cash view: tenant and HAP payments received vs. work order costs, month by month.",
  mode: "range",
  defaultRange: "last-12",
  async build(p) {
    const rows = await cashFlow(p.from, p.to, p.propertyId);
    const t = { tenant: sum(rows, (r) => r.tenant), hap: sum(rows, (r) => r.hap), maintenance: sum(rows, (r) => r.maintenance), net: sum(rows, (r) => r.net) };
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Tenant payments", value: money(t.tenant) },
        { label: "HAP payments", value: money(t.hap) },
        { label: "Work order costs", value: money(t.maintenance) },
        { label: "Net", value: money(t.net), tone: t.net < 0 ? "bad" : "good" },
      ],
      tables: [
        {
          columns: [
            { key: "month", label: "Month", w: 1.6 }, { key: "bar", label: "Collected", fmt: "bar", w: 2 }, { key: "tenant", label: "Tenant", fmt: "money" }, { key: "hap", label: "HAP", fmt: "money" },
            { key: "maintenance", label: "Work orders", fmt: "money" }, { key: "net", label: "Net", fmt: "money" },
          ],
          rows: [
            ...rows.map((r) => ({ month: periodLabel(r.period), bar: r.tenant + r.hap, tenant: r.tenant, hap: r.hap, maintenance: r.maintenance, net: r.net, _tone: r.net < 0 ? ("bad" as const) : undefined })),
            { _kind: "total", month: "Total", bar: null, ...t },
          ],
        },
      ],
      notes: ["Cash basis: payments by date received, work orders by completion date. For full income and expenses use Property performance or Accounting."],
    };
  },
};

/* ------------------------------------------------------------------------------------------------ */

const rentRollReport: ReportDef = {
  key: "rent-roll",
  group: "Rent & collections",
  title: "Rent roll",
  description: "Every unit with its tenant, lease dates, market vs. contract rent, tenant portion, HAP, and balance.",
  mode: "asOf",
  defaultRange: "this-month",
  async build(p) {
    const rows = await rentRoll(p.to, p.propertyId);
    const occ = rows.filter((r) => r.status === "Occupied");
    const t = (k: "contractRent" | "tenantPortion" | "hapAmount" | "balance") => sum(rows, (r) => r[k]);
    const market = sum(rows, (r) => r.marketRent ?? 0);
    return {
      title: this.title,
      period: asOfTitle(p),
      kpis: [
        { label: "Occupancy", value: pct(ratio(occ.length, rows.length)), sub: `${occ.length} of ${rows.length} units` },
        { label: "Scheduled rent / mo", value: money(t("contractRent")), sub: market ? `${money(market)} market` : undefined },
        { label: "Tenant portion / mo", value: money(t("tenantPortion")) },
        { label: "HAP / mo", value: money(t("hapAmount")) },
      ],
      tables: [
        {
          columns: [
            { key: "unit", label: "Unit", w: 2.4 }, { key: "bdba", label: "Bd/Ba", w: 0.7 }, { key: "tenant", label: "Tenant", w: 1.8 }, { key: "start", label: "Lease start" }, { key: "end", label: "Lease end" },
            { key: "market", label: "Market", fmt: "money" }, { key: "contract", label: "Contract", fmt: "money" }, { key: "tenantPortion", label: "Tenant", fmt: "money" }, { key: "hap", label: "HAP", fmt: "money" },
            { key: "authority", label: "Housing authority", w: 1.8 }, { key: "balance", label: "Balance", fmt: "money" },
          ],
          empty: "No units yet.",
          rows: [
            ...rows.map((r) => ({
              unit: `${r.property} · ${r.unit}`, bdba: `${r.beds}/${r.baths}`, tenant: r.tenant ?? "Vacant", start: r.leaseStart, end: r.leaseId ? (r.leaseEnd ?? "Month-to-month") : null,
              market: r.marketRent, contract: r.leaseId ? r.contractRent : null, tenantPortion: r.leaseId ? r.tenantPortion : null, hap: r.leaseId ? r.hapAmount : null,
              authority: r.housingAuthority, balance: r.leaseId ? r.balance : null,
              _href: r.leaseId ? `/leases/${r.leaseId}` : undefined, _tone: !r.leaseId ? ("warn" as const) : r.balance > 0 ? ("bad" as const) : undefined,
            })),
            { _kind: "total", unit: "Total", market, contract: t("contractRent"), tenantPortion: t("tenantPortion"), hap: t("hapAmount"), balance: t("balance") },
          ],
        },
      ],
    };
  },
};

const delinquencyReport: ReportDef = {
  key: "delinquency",
  group: "Rent & collections",
  title: "Delinquency aging",
  description: "Who owes what, split by tenant vs. housing authority, in 30/60/90-day buckets.",
  mode: "asOf",
  defaultRange: "this-month",
  async build(p) {
    const rows = await delinquency(p.to, p.propertyId);
    const tenant = sum(rows, (r) => (r.party === "Tenant" ? r.pastDue : 0));
    const hap = sum(rows, (r) => (r.party === "Housing authority" ? r.pastDue : 0));
    const over60 = sum(rows, (r) => r.aging.d90 + r.aging.over90);
    return {
      title: this.title,
      period: asOfTitle(p),
      kpis: [
        { label: "Total past due", value: money(tenant + hap), tone: tenant + hap > 0 ? "bad" : "good" },
        { label: "Owed by tenants", value: money(tenant) },
        { label: "Owed by housing authorities", value: money(hap) },
        { label: "Over 60 days", value: money(over60), tone: over60 > 0 ? "bad" : "default" },
      ],
      tables: [
        {
          columns: [
            { key: "unit", label: "Unit", w: 2.4 }, { key: "tenant", label: "Tenant", w: 1.8 }, { key: "owedBy", label: "Owed by", w: 2 }, { key: "phone", label: "Phone", w: 1.3 },
            { key: "a30", label: "0–30", fmt: "money" }, { key: "a60", label: "31–60", fmt: "money" }, { key: "a90", label: "61–90", fmt: "money" }, { key: "over", label: "90+", fmt: "money" },
            { key: "pastDue", label: "Total", fmt: "money" }, { key: "oldest", label: "Oldest unpaid" },
          ],
          empty: "Nobody is past due. 🎉",
          rows: [
            ...rows.map((r) => ({
              unit: `${r.property} · ${r.unit}`, tenant: r.tenant + (r.leaseStatus === "ENDED" ? " (former)" : ""), owedBy: r.party === "Tenant" ? "Tenant" : r.payer, phone: r.phone,
              a30: r.aging.current + r.aging.d30, a60: r.aging.d60, a90: r.aging.d90, over: r.aging.over90, pastDue: r.pastDue, oldest: r.oldestPastDue, _href: `/leases/${r.leaseId}`,
            })),
            ...(rows.length > 1 ? [{ _kind: "total" as const, unit: "Total", a30: sum(rows, (r) => r.aging.current + r.aging.d30), a60: sum(rows, (r) => r.aging.d60), a90: sum(rows, (r) => r.aging.d90), over: sum(rows, (r) => r.aging.over90), pastDue: tenant + hap }] : []),
          ],
        },
      ],
      notes: ["Payments are applied to the oldest charges first, separately for the tenant and the housing authority."],
    };
  },
};

const collections: ReportDef = {
  key: "collections",
  group: "Rent & collections",
  title: "Collections trend",
  description: "Billed vs. collected each month, for tenants and housing authorities, with the collection rate.",
  mode: "range",
  defaultRange: "last-12",
  async build(p) {
    const d = await collectionsData(p);
    const billed = d.tenantBilled + d.hapBilled;
    const collected = d.tenantCollected + d.hapCollected;
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Billed", value: money(billed) },
        { label: "Collected", value: money(collected) },
        { label: "Collection rate", value: pct(ratio(collected, billed)), tone: (ratio(collected, billed) ?? 1) < 0.95 ? "bad" : "good" },
        { label: "Tenant vs HAP rate", value: `${pct(ratio(d.tenantCollected, d.tenantBilled))} / ${pct(ratio(d.hapCollected, d.hapBilled))}` },
      ],
      tables: [
        {
          columns: [
            { key: "month", label: "Month", w: 1.6 }, { key: "bar", label: "Collected", fmt: "bar", w: 1.8 }, { key: "tb", label: "Tenant billed", fmt: "money" }, { key: "tc", label: "Tenant collected", fmt: "money" },
            { key: "hb", label: "HAP billed", fmt: "money" }, { key: "hc", label: "HAP collected", fmt: "money" }, { key: "rate", label: "Rate", fmt: "pct", w: 0.8 },
          ],
          rows: [
            ...d.months.map((m) => {
              const b = m.tenantBilled + m.hapBilled;
              const c = m.tenantCollected + m.hapCollected;
              const r = ratio(c, b);
              return { month: periodLabel(m.period), bar: c, tb: m.tenantBilled, tc: m.tenantCollected, hb: m.hapBilled, hc: m.hapCollected, rate: r, _tone: r != null && r < 0.9 ? ("bad" as const) : undefined };
            }),
            { _kind: "total", month: "Total", bar: null, tb: d.tenantBilled, tc: d.tenantCollected, hb: d.hapBilled, hc: d.hapCollected, rate: ratio(collected, billed) },
          ],
        },
      ],
      notes: ["Billed = rent, fees, and other charges due in the month (security deposits excluded). Collected = payments received in the month, so a late payment counts in the month it arrived."],
    };
  },
};

const vacancy: ReportDef = {
  key: "vacancy",
  group: "Rent & collections",
  title: "Vacancy loss",
  description: "Days each unit sat empty and the rent lost, plus physical occupancy over the period.",
  mode: "range",
  defaultRange: "ytd",
  async build(p) {
    const d = await vacancyData(p);
    const vacant = d.rows.filter((r) => r.vacant > 0).sort((a, b) => b.loss - a.loss);
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Physical occupancy", value: pct(ratio(d.occupiedDays, d.unitDays), 1), sub: "occupied unit-days" },
        { label: "Vacancy loss", value: money(d.loss), tone: d.loss > 0 ? "bad" : "good" },
        { label: "Vacant days", value: (d.unitDays - d.occupiedDays).toLocaleString("en-US") },
        { label: "Vacant now", value: String(d.vacantNow), sub: `as of ${fmtDate(p.to)}` },
      ],
      tables: [
        {
          columns: [
            { key: "unit", label: "Unit", w: 2.6 }, { key: "rent", label: "Market rent", fmt: "money" }, { key: "total", label: "Days owned", fmt: "int" }, { key: "vacant", label: "Days vacant", fmt: "int" },
            { key: "occ", label: "Occupied", fmt: "pct" }, { key: "bar", label: "", fmt: "bar", w: 1.5 }, { key: "loss", label: "Lost rent", fmt: "money" }, { key: "now", label: "Now" },
          ],
          empty: "No vacant days in this period. 🎉",
          rows: [
            ...vacant.map((r) => ({ unit: `${r.property} · ${r.unit}`, rent: r.rentMissing ? null : r.rent, total: r.total, vacant: r.vacant, occ: ratio(r.occupied, r.total), bar: r.loss, loss: r.loss, now: r.vacantNow ? "Vacant" : "Leased", _tone: r.vacantNow ? ("warn" as const) : undefined })),
            ...(vacant.length > 1 ? [{ _kind: "total" as const, unit: "Total", total: sum(vacant, (r) => r.total), vacant: sum(vacant, (r) => r.vacant), bar: null, loss: d.loss }] : []),
          ],
        },
      ],
      notes: [
        `${d.rows.length - vacant.length} of ${d.rows.length} units were occupied every day of the period.`,
        "Lost rent = market rent (or last lease rent) × 12 ÷ 365 per vacant day. Days are counted from the property's purchase date (or when the unit was added).",
        "Leases entered without their real start dates will look like vacancy. If you began entering leases recently, pick dates after that.",
        ...(vacant.some((r) => r.rentMissing) ? ["Some vacant units have no market rent set, so their lost rent shows as $0."] : []),
      ],
    };
  },
};

/* ------------------------------------------------------------------------------------------------ */

const workOrders: ReportDef = {
  key: "work-orders",
  group: "Maintenance & operations",
  title: "Work orders",
  description: "Work order volume, time to complete, what's still open by property, and the oldest open requests.",
  mode: "range",
  defaultRange: "ytd",
  async build(p) {
    const d = await workOrderData(p);
    const days = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Opened", value: String(d.opened) },
        { label: "Completed", value: String(d.completed), sub: money(d.cost) + " cost" },
        { label: "Avg days to complete", value: d.avgClose == null ? "—" : d.avgClose.toFixed(1), sub: d.medianClose == null ? undefined : `median ${d.medianClose}` },
        { label: "Open at end", value: String(d.open), tone: d.urgentOpen ? "bad" : "default", sub: d.urgentOpen ? `${d.urgentOpen} high or emergency` : undefined },
      ],
      tables: [
        {
          title: "By property",
          columns: [
            { key: "property", label: "Property", w: 2.6 }, { key: "opened", label: "Opened", fmt: "int" }, { key: "completed", label: "Completed", fmt: "int" }, { key: "avg", label: "Avg days to complete", fmt: "int" },
            { key: "open", label: "Open at end", fmt: "int" }, { key: "urgent", label: "High / emergency open", fmt: "int" }, { key: "cost", label: "Cost (completed)", fmt: "money" },
          ],
          empty: "No work orders in this period.",
          rows: d.byProperty.map((x) => ({ property: x.property, opened: x.opened, completed: x.completed, avg: days(x.avgClose), open: x.open, urgent: x.urgentOpen, cost: x.cost, _tone: x.urgentOpen ? ("bad" as const) : undefined })),
        },
        {
          title: "By month",
          columns: [{ key: "month", label: "Month", w: 1.6 }, { key: "bar", label: "", fmt: "bar", w: 2 }, { key: "opened", label: "Opened", fmt: "int" }, { key: "completed", label: "Completed", fmt: "int" }],
          rows: d.months.map((m) => ({ month: periodLabel(m.period), bar: m.opened, opened: m.opened, completed: m.completed })),
        },
        {
          title: "Open work orders, oldest first",
          columns: [
            { key: "unit", label: "Unit", w: 2.4 }, { key: "title", label: "Request", w: 3 }, { key: "priority", label: "Priority" }, { key: "status", label: "Status" },
            { key: "reported", label: "Reported" }, { key: "age", label: "Age", fmt: "days" }, { key: "vendor", label: "Vendor", w: 1.8 },
          ],
          empty: "Nothing open. 🎉",
          rows: d.aging.slice(0, 50).map((w) => ({
            unit: `${w.property} · ${w.unit}`, title: w.title, priority: titleCase(w.priority), status: titleCase(w.status), reported: w.reportedOn, age: w.age, vendor: w.vendor,
            _href: `/maintenance/${w.id}`, _tone: w.priority === "EMERGENCY" || w.priority === "HIGH" || w.age > 30 ? ("bad" as const) : undefined,
          })),
          note: d.aging.length > 50 ? `Showing the 50 oldest of ${d.aging.length} open work orders.` : undefined,
        },
      ],
      notes: ["Days to complete = reported date to completed date. \"Open at end\" counts requests reported by the end date and not completed or cancelled by then."],
    };
  },
};

const spending: ReportDef = {
  key: "spending",
  group: "Maintenance & operations",
  title: "Spending by property & vendor",
  description: "Where the money went: expenses by category and property from the books, and by vendor including work order costs not yet entered as bills.",
  mode: "range",
  defaultRange: "ytd",
  async build(p) {
    const d = await spendingData(p);
    const top = d.byVendor[0];
    return {
      title: this.title,
      period: rangeTitle(p),
      kpis: [
        { label: "Total expenses", value: money(d.total), sub: d.interest ? `incl. ${money(d.interest)} mortgage interest` : "from the books" },
        { label: "Repairs & maintenance", value: money(d.repairs), sub: d.total ? `${pct(ratio(d.repairs, d.total))} of expenses` : undefined },
        { label: "Top vendor", value: top ? money(top.billed + top.unbilled) : "—", sub: top?.vendor },
        { label: "Work order costs not billed", value: money(d.unbilled), tone: d.unbilled ? "bad" : "default", sub: d.unbilled ? "enter as bills to include in the books" : undefined },
      ],
      tables: [
        {
          title: "By category",
          columns: [{ key: "account", label: "Expense account", w: 3 }, { key: "bar", label: "", fmt: "bar", w: 2 }, { key: "amount", label: "Amount", fmt: "money" }, { key: "share", label: "Share", fmt: "pct" }],
          empty: "No expenses recorded in this period.",
          rows: [...d.byAccount.map((x) => ({ account: x.account, bar: x.amount, amount: x.amount, share: ratio(x.amount, d.total) })), ...(d.byAccount.length > 1 ? [{ _kind: "total" as const, account: "Total", bar: null, amount: d.total, share: 1 }] : [])],
        },
        {
          title: "By property",
          columns: [{ key: "property", label: "Property", w: 3 }, { key: "bar", label: "", fmt: "bar", w: 2 }, { key: "amount", label: "Amount", fmt: "money" }, { key: "share", label: "Share", fmt: "pct" }],
          empty: "No expenses recorded in this period.",
          rows: d.byProperty.map((x) => ({ property: x.property, bar: x.amount, amount: x.amount, share: ratio(x.amount, d.total) })),
        },
        {
          title: "By vendor",
          columns: [
            { key: "vendor", label: "Vendor", w: 3 }, { key: "bills", label: "Bills", fmt: "int" }, { key: "billed", label: "Billed", fmt: "money" },
            { key: "unbilled", label: "Work orders not billed", fmt: "money" }, { key: "total", label: "Total", fmt: "money" },
          ],
          empty: "No bills or work order costs in this period.",
          rows: d.byVendor.map((x) => ({ vendor: x.vendor, bills: x.bills, billed: x.billed, unbilled: x.unbilled, total: x.billed + x.unbilled, _tone: x.unbilled ? ("warn" as const) : undefined })),
        },
      ],
      notes: [
        "Category and property totals come from Accounting (bills and journal entries, by date).",
        "Vendor totals use bills by bill date, plus completed work orders with a cost but no bill (those aren't in the books until entered as a bill).",
      ],
    };
  },
};

export const REPORTS: ReportDef[] = [
  hapByAuthority, compliance, voucherMix,
  investorSummary, performance, cashFlowReport,
  rentRollReport, delinquencyReport, collections, vacancy,
  workOrders, spending,
];
export const GROUPS: ReportGroup[] = ["HUD-VASH", "Investors", "Rent & collections", "Maintenance & operations"];
export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key) ?? null;
