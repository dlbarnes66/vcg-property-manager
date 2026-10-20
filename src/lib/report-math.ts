/* Pure calculations behind the reports (no database), so they can be tested directly. */
import { daysBetween } from "./utils";

export const DAY = 86_400_000;
/** Inclusive day count of [from, to]. */
export const daysIn = (from: Date, to: Date) => Math.max(0, daysBetween(from, to) + 1);

/**
 * Days in [from, to] covered by at least one interval (inclusive days; null end = still going).
 * Overlapping leases on the same unit are only counted once.
 */
export function coveredDays(intervals: { start: Date; end: Date | null }[], from: Date, to: Date) {
  const clipped = intervals
    .map((i) => ({ s: Math.max(i.start.getTime(), from.getTime()), e: Math.min((i.end ?? to).getTime(), to.getTime()) }))
    .filter((i) => i.s <= i.e)
    .sort((a, b) => a.s - b.s);
  let days = 0;
  let cur: { s: number; e: number } | null = null;
  for (const i of clipped) {
    if (!cur) cur = { ...i };
    else if (i.s > cur.e + DAY) {
      days += (cur.e - cur.s) / DAY + 1;
      cur = { ...i };
    } else cur.e = Math.max(cur.e, i.e);
  }
  if (cur) days += (cur.e - cur.s) / DAY + 1;
  return Math.round(days);
}

/** Monthly rent → lost rent for a number of vacant days (rent × 12 ÷ 365 per day), in cents. */
export const vacancyLoss = (monthlyRent: number, vacantDays: number) => Math.round((monthlyRent * 12 * vacantDays) / 365);

/** Same calendar day one year later (Feb 29 → Mar 1). */
export const plusOneYear = (d: Date) => new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));

export type Tone = "bad" | "warn" | "good";
export type Status = { label: string; tone: Tone; rank: number; code?: string };

/** Annual income recertification status. */
export function recertStatus(next: Date | null, asOf: Date, soonDays = 90): Status {
  if (!next) return { label: "Date not set", tone: "warn", rank: 1 };
  const d = daysBetween(asOf, next);
  if (d < 0) return { label: `Overdue ${-d} days`, tone: "bad", rank: 0 };
  if (d <= soonDays) return { label: d === 0 ? "Due today" : `Due in ${d} days`, tone: "warn", rank: 1 };
  return { label: "On track", tone: "good", rank: 2 };
}

/** Annual HQS/NSPIRE inspection status for a voucher unit. */
export function inspectionStatus(
  o: { lastPass: Date | null; scheduled: Date | null; openFailCureBy: Date | null | undefined; hasOpenFail: boolean },
  asOf: Date,
  soonDays = 60,
): Status & { nextDue: Date | null } {
  const nextDue = o.lastPass ? plusOneYear(o.lastPass) : null;
  const sched = o.scheduled ? ` (scheduled ${o.scheduled.toISOString().slice(0, 10)})` : "";
  if (o.hasOpenFail) {
    const late = o.openFailCureBy && o.openFailCureBy < asOf;
    return { label: late ? `Failed — cure date passed${sched}` : `Failed — fix by cure date${sched}`, tone: "bad", rank: 0, nextDue, code: "failed" };
  }
  if (!nextDue)
    return o.scheduled
      ? { label: `First inspection${sched}`, tone: "warn", rank: 1, nextDue, code: "first-scheduled" }
      : { label: "No passed inspection on file", tone: "bad", rank: 0, nextDue, code: "none" };
  if (nextDue < asOf) return { label: `Overdue${sched}`, tone: "bad", rank: 0, nextDue, code: "overdue" };
  if (daysBetween(asOf, nextDue) <= soonDays)
    return o.scheduled
      ? { label: `Due soon${sched}`, tone: "good", rank: 2, nextDue, code: "soon-scheduled" }
      : { label: "Due soon — not scheduled", tone: "warn", rank: 1, nextDue, code: "soon-unscheduled" };
  return { label: "Current", tone: "good", rank: 2, nextDue, code: "current" };
}

export const worstTone = (...t: Tone[]): Tone => (t.includes("bad") ? "bad" : t.includes("warn") ? "warn" : "good");

/** Annualized NOI ÷ purchase price. */
export function capRate(noi: number, days: number, purchasePrice: number | null | undefined) {
  if (!purchasePrice || days <= 0) return null;
  return (noi * (365 / days)) / purchasePrice;
}

export function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Lease occupancy interval: start → move-out, else end date, else (if ended without dates) the day it was ended. */
export function leaseInterval(l: { status: string; startDate: Date; endDate: Date | null; moveOutDate: Date | null; updatedAt: Date }) {
  const floor = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const end = l.moveOutDate ?? l.endDate ?? (l.status === "ENDED" ? floor(l.updatedAt) : null);
  return { start: l.startDate, end };
}
