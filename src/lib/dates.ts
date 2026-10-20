// Recurrence and time-zone helpers. Timed events are entered and shown in APP_TIMEZONE
// (default America/New_York) and stored in UTC. All-day dates are stored as UTC midnight.

export type RecurrenceKind = "NONE" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export const appTimeZone = () => process.env.APP_TIMEZONE || "America/New_York";

function addMonthsClamped(d: Date, months: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

const isLastDayOfMonth = (d: Date) => new Date(d.getTime() + 86_400_000).getUTCDate() === 1;

/**
 * Next due date for a recurring task. A task due on the last day of a month stays on the last day
 * (Jan 31 → Feb 28 → Mar 31), so month-end tasks don't drift; other days clamp only when needed.
 */
export function nextOccurrence(due: Date, recurrence: RecurrenceKind, anchorDay = isLastDayOfMonth(due) ? 31 : due.getUTCDate()): Date | null {
  switch (recurrence) {
    case "WEEKLY":
      return new Date(due.getTime() + 7 * 86_400_000);
    case "MONTHLY":
    case "QUARTERLY":
    case "YEARLY": {
      const months = recurrence === "MONTHLY" ? 1 : recurrence === "QUARTERLY" ? 3 : 12;
      const next = addMonthsClamped(new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1)), months);
      const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      return new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), Math.min(anchorDay, last)));
    }
    default:
      return null;
  }
}

/** Offset (ms) of `tz` from UTC at instant `at`. */
function tzOffset(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** "2026-10-20T14:30" wall-clock in tz → UTC Date. Handles DST changes. */
export function zonedToUtc(local: string, tz = appTimeZone()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) throw new Error(`"${local}" is not a valid date and time`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - tzOffset(new Date(guess), tz);
  utc = guess - tzOffset(new Date(utc), tz); // second pass settles DST edges
  return new Date(utc);
}

/** UTC Date → "2026-10-20T14:30" wall-clock in tz (for <input type="datetime-local">). */
export function utcToZonedInput(d: Date, tz = appTimeZone()) {
  return new Date(d.getTime() + tzOffset(d, tz)).toISOString().slice(0, 16);
}

/** The calendar day (as UTC midnight) an instant falls on in tz. */
export function zonedDay(d: Date, tz = appTimeZone()) {
  const shifted = new Date(d.getTime() + tzOffset(d, tz));
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export function fmtTime(d: Date, tz = appTimeZone()) {
  return d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/** Date (and optionally time) of an instant as seen in APP_TIMEZONE, e.g. "Oct 19, 2026" / "Oct 19, 2026 10:37 PM". */
export function fmtLocal(d: Date, withTime = false, tz = appTimeZone()) {
  const date = d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
  return withTime ? `${date} ${fmtTime(d, tz)}` : date;
}
