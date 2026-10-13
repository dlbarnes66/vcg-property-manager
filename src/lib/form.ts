import { toCents, toDate, str } from "./utils";

/** Small, explicit FormData readers that throw human-readable errors (shown by ActionForm). */
export function reqStr(fd: FormData, key: string, label: string) {
  const v = str(fd.get(key));
  if (!v) throw new Error(`${label} is required`);
  return v;
}
export const optStr = (fd: FormData, key: string) => str(fd.get(key));

export function reqMoney(fd: FormData, key: string, label: string) {
  const v = toCents(fd.get(key));
  if (v == null) throw new Error(`${label} is required`);
  if (v < 0) throw new Error(`${label} can't be negative`);
  return v;
}
export function optMoney(fd: FormData, key: string, label = key) {
  const v = toCents(fd.get(key));
  if (v != null && v < 0) throw new Error(`${label} can't be negative`);
  return v;
}

export function reqDate(fd: FormData, key: string, label: string) {
  const v = toDate(fd.get(key));
  if (!v) throw new Error(`${label} is required`);
  return v;
}
export const optDate = (fd: FormData, key: string) => toDate(fd.get(key));

export function optInt(fd: FormData, key: string, label = key) {
  const s = str(fd.get(key));
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number`);
  return n;
}
export function optFloat(fd: FormData, key: string, label = key) {
  const s = str(fd.get(key));
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
  return n;
}

export function oneOf<T extends string>(fd: FormData, key: string, values: readonly T[], fallback?: T): T {
  const v = str(fd.get(key));
  if (v && (values as readonly string[]).includes(v)) return v as T;
  if (fallback !== undefined && !v) return fallback;
  throw new Error(`Invalid ${key}`);
}

export const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";
