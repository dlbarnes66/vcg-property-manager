import { balanceSheet, profitAndLoss, trialBalance } from "./accounting";
import { toDate, todayUTC } from "./utils";

export type FinParams = { report: "pl" | "bs" | "tb"; from: Date; to: Date; propertyId: string | null };

export function readFinParams(sp: { r?: string; from?: string; to?: string; propertyId?: string }): FinParams {
  const today = todayUTC();
  const safe = (s?: string) => {
    try {
      return s ? toDate(s) : null;
    } catch {
      return null;
    }
  };
  return {
    report: sp.r === "bs" || sp.r === "tb" ? sp.r : "pl",
    from: safe(sp.from) ?? new Date(Date.UTC(today.getUTCFullYear(), 0, 1)),
    to: safe(sp.to) ?? today,
    propertyId: sp.propertyId || null,
  };
}

/** Rows for display and CSV: [label, amount-in-cents | null, style]. */
export async function finReportRows(p: FinParams): Promise<{ title: string; rows: { label: string; amount: number | null; kind?: "head" | "total" | "grand" }[]; footnote?: string }> {
  if (p.report === "pl") {
    const r = await profitAndLoss(p.from, p.to, p.propertyId);
    return {
      title: "Profit & loss",
      rows: [
        { label: "Income", amount: null, kind: "head" },
        ...r.income.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.balance })),
        { label: "Total income", amount: r.totalIncome, kind: "total" },
        { label: "Expenses", amount: null, kind: "head" },
        ...r.expenses.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.balance })),
        { label: "Total expenses", amount: r.totalExpenses, kind: "total" },
        { label: "Net income", amount: r.netIncome, kind: "grand" },
      ],
    };
  }
  if (p.report === "bs") {
    const r = await balanceSheet(p.to, p.propertyId);
    return {
      title: "Balance sheet",
      rows: [
        { label: "Assets", amount: null, kind: "head" },
        ...r.assets.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.balance })),
        { label: "Total assets", amount: r.totalAssets, kind: "total" },
        { label: "Liabilities", amount: null, kind: "head" },
        ...r.liabilities.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.balance })),
        { label: "Total liabilities", amount: r.totalLiabilities, kind: "total" },
        { label: "Equity", amount: null, kind: "head" },
        ...r.equity.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.balance })),
        { label: "Current earnings (net income to date)", amount: r.earnings },
        { label: "Total equity", amount: r.totalEquity, kind: "total" },
        { label: "Total liabilities & equity", amount: r.totalLiabilities + r.totalEquity, kind: "grand" },
      ],
      footnote: r.balanced ? undefined : "Assets don't equal liabilities + equity. With a property filter this can happen if an entry tags only some of its lines with that property.",
    };
  }
  const r = await trialBalance(p.to, p.propertyId);
  return {
    title: "Trial balance",
    rows: [
      ...r.rows.map((a) => ({ label: `${a.code} ${a.name}`, amount: a.dr - a.cr })),
      { label: `Total debits ${(r.totalDr / 100).toFixed(2)} · total credits ${(r.totalCr / 100).toFixed(2)}`, amount: r.totalDr - r.totalCr, kind: "grand" },
    ],
    footnote: r.balanced ? "Debits equal credits." : "Debits and credits don't match.",
  };
}
