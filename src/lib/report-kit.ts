/*
 * One shape for every report, so the same data drives the screen, the CSV, and the PDF.
 * Pure helpers only (no database) — safe to import anywhere, easy to test.
 */
import { addDays, dateToInput, fmtDate, money, toDate, todayUTC } from "./utils";

export type Fmt = "text" | "money" | "int" | "pct" | "date" | "days" | "bar";
export type Col = { key: string; label: string; fmt?: Fmt; /** relative width hint for PDF */ w?: number };
export type Cell = string | number | Date | null | undefined;
export type Row = { [key: string]: Cell | undefined } & { _href?: string; _tone?: "bad" | "warn" | "good"; _kind?: "total" };
export type ReportTable = { title?: string; subtitle?: string; columns: Col[]; rows: Row[]; empty?: string; note?: string };
export type Kpi = { label: string; value: string; sub?: string; tone?: "good" | "bad" | "default" };
export type ReportData = { title: string; period: string; kpis: Kpi[]; tables: ReportTable[]; notes?: string[]; memo?: string | null };

export type ReportParams = { from: Date; to: Date; propertyId: string | null; propertyName: string | null; memo: string | null };

export type RangePreset = "this-month" | "last-month" | "this-quarter" | "last-quarter" | "ytd" | "last-12" | "last-year";
export const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "this-quarter", label: "This quarter" },
  { key: "last-quarter", label: "Last quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last-12", label: "Last 12 months" },
  { key: "last-year", label: "Last year" },
];

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const monthEnd = (y: number, m: number) => utc(y, m + 1, 0);

export function presetRange(p: RangePreset, today = todayUTC()): { from: Date; to: Date } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  switch (p) {
    case "this-month": return { from: utc(y, m), to: today };
    case "last-month": return { from: utc(y, m - 1), to: monthEnd(y, m - 1) };
    case "this-quarter": return { from: utc(y, q), to: today };
    case "last-quarter": return { from: utc(y, q - 3), to: monthEnd(y, q - 1) };
    case "ytd": return { from: utc(y, 0), to: today };
    case "last-12": return { from: utc(y, m - 11), to: today };
    case "last-year": return { from: utc(y - 1, 0), to: utc(y - 1, 11, 31) };
  }
}

/** "Q3 2026", "October 2026", "2026", or "Jan 1, 2026 – Oct 20, 2026". */
export function rangeLabel(from: Date, to: Date) {
  const sameMonthStart = from.getUTCDate() === 1;
  const isMonthEnd = (d: Date) => addDays(d, 1).getUTCDate() === 1;
  if (sameMonthStart && isMonthEnd(to)) {
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1;
    if (months === 1) return from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    if (months === 3 && from.getUTCMonth() % 3 === 0) return `Q${from.getUTCMonth() / 3 + 1} ${from.getUTCFullYear()}`;
    if (months === 12 && from.getUTCMonth() === 0) return String(from.getUTCFullYear());
  }
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

export type SearchParams = { from?: string; to?: string; asOf?: string; propertyId?: string; preset?: string; memo?: string };

/** Reads URL params; anything missing or invalid falls back to the report's default range. */
export function readParams(sp: SearchParams, fallback: RangePreset, propertyName: (id: string) => string | null = () => null): ReportParams {
  const parse = (s?: string) => {
    if (!s) return null;
    try {
      return toDate(s);
    } catch {
      return null;
    }
  };
  const preset = PRESETS.find((p) => p.key === sp.preset)?.key;
  const def = presetRange(preset ?? fallback);
  let from = (!preset && parse(sp.from)) || def.from;
  let to = (!preset && parse(sp.to ?? sp.asOf)) || def.to;
  if (from > to) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > 5 * 366 * 86400000) from = addDays(to, -5 * 366); // keep queries bounded
  const propertyId = sp.propertyId?.trim() || null;
  return { from, to, propertyId, propertyName: propertyId ? propertyName(propertyId) : null, memo: sp.memo?.trim().slice(0, 2000) || null };
}

export function paramsQuery(p: ReportParams, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ from: dateToInput(p.from), to: dateToInput(p.to), ...(p.propertyId ? { propertyId: p.propertyId } : {}), ...extra });
  return q.toString();
}

/* ---------- formatting ---------- */

export const pct = (n: number | null | undefined, digits = 0) => (n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`);
export const ratio = (a: number, b: number) => (b ? a / b : null);

export function fmtCell(fmt: Fmt | undefined, v: Cell): string {
  if (v == null || v === "") return "—";
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === "string") return v;
  switch (fmt) {
    case "money": return money(v);
    case "pct": return pct(v, 1);
    case "int": return v.toLocaleString("en-US");
    case "days": return `${Math.round(v)} ${Math.round(v) === 1 ? "day" : "days"}`;
    default: return String(v);
  }
}

export const isNumeric = (f?: Fmt) => f === "money" || f === "int" || f === "pct" || f === "days";

/** Largest value in a column, for scaling "bar" cells. */
export const colMax = (rows: Row[], key: string) => Math.max(1, ...rows.filter((r) => r._kind !== "total").map((r) => (typeof r[key] === "number" ? Math.abs(r[key] as number) : 0)));

/* ---------- CSV ---------- */

function csvValue(fmt: Fmt | undefined, v: Cell): string | number {
  if (v == null) return "";
  if (v instanceof Date) return dateToInput(v);
  if (typeof v === "string") return v;
  if (fmt === "money") return (v / 100).toFixed(2);
  if (fmt === "pct") return (v * 100).toFixed(1);
  return v;
}

export function csvEscape(v: string | number | null | undefined) {
  const s = v == null ? "" : String(v);
  // Guard against spreadsheet formula injection from user-entered names
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV for the whole report. Multi-table reports get a title line and blank line between sections. */
export function reportToCsv(r: ReportData) {
  const lines: string[] = [];
  const multi = r.tables.length > 1;
  r.tables.forEach((t, i) => {
    const cols = t.columns.filter((c) => c.fmt !== "bar");
    if (multi) {
      if (i > 0) lines.push("");
      lines.push(csvEscape(t.title ?? r.title));
    }
    lines.push(cols.map((c) => csvEscape(c.label + (c.fmt === "pct" ? " (%)" : ""))).join(","));
    for (const row of t.rows) lines.push(cols.map((c) => csvEscape(csvValue(c.fmt, row[c.key]))).join(","));
  });
  return lines.join("\n");
}

export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
