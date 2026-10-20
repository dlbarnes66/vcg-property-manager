import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------- Money (stored as integer cents) ----------
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return usd.format(cents / 100);
}

/** "$1,234.50" | "1234.5" -> 123450. Returns null for blank. Throws on garbage. */
export function toCents(input: FormDataEntryValue | null | undefined): number | null {
  if (input == null) return null;
  const s = String(input).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`"${input}" is not a valid amount`);
  return Math.round(n * 100);
}

export function centsToInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

// ---------- Dates (stored as UTC midnight, displayed in UTC so they never shift a day) ----------
export function toDate(input: FormDataEntryValue | null | undefined): Date | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`"${input}" is not a valid date`);
  return d;
}

export function dateToInput(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function fmtDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

export function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

/** "2026-10" for a date */
export function periodOf(d: Date) {
  return d.toISOString().slice(0, 7);
}

export function periodBounds(period: string) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Invalid period "${period}"`);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0)); // last day of month
  return { start, end, daysInMonth: end.getUTCDate() };
}

export function periodLabel(period: string) {
  const { start } = periodBounds(period);
  return start.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}

// ---------- Labels ----------
export function titleCase(enumValue: string) {
  return enumValue
    .toLowerCase()
    .split("_")
    .map((w) => (["hqs", "hap", "ach", "id"].includes(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function str(v: FormDataEntryValue | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function partyLabel(p: "TENANT" | "HOUSING_AUTHORITY") {
  return p === "TENANT" ? "Tenant" : "Housing authority";
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
