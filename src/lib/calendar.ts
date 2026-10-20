import { db } from "./db";
import { appTimeZone, zonedDay } from "./dates";
import { dueDateFor, leaseCoversPeriod } from "./ledger";
import { tenantName } from "./queries";
import { addDays, periodOf, titleCase } from "./utils";

export type CalKind = "event" | "task" | "inspection" | "cure" | "workorder" | "lease-start" | "lease-end" | "recert" | "rent";

export type CalItem = {
  key: string; // stable across calls (used as the iCal UID)
  kind: CalKind;
  day: Date; // UTC midnight of the calendar day it's shown on
  start?: Date; // timed items only (UTC instant)
  end?: Date;
  allDay: boolean;
  title: string;
  detail?: string;
  location?: string;
  href: string;
  eventId?: string; // editable calendar events
};

export const kindLabel: Record<CalKind, string> = {
  event: "Event",
  task: "Task",
  inspection: "Inspection",
  cure: "Inspection cure deadline",
  workorder: "Scheduled repair",
  "lease-start": "Lease starts",
  "lease-end": "Lease ends",
  recert: "Recertification",
  rent: "Rent due",
};

const place = (u: { label: string; property: { name: string } }) => `${u.property.name} · ${u.label}`;

/**
 * Everything dated between `from` and `to` (inclusive, UTC-midnight days): your own events plus
 * dates the app already tracks. Nothing here is copied; it's computed from the records each time.
 */
export async function calendarItems(from: Date, to: Date, tz = appTimeZone()): Promise<CalItem[]> {
  const toEnd = addDays(to, 1); // exclusive upper bound
  const unitInc = { include: { property: { select: { name: true } } } } as const;

  const [events, tasks, inspections, workOrders, leases] = await Promise.all([
    db.calendarEvent.findMany({
      where: { start: { gte: addDays(from, -1), lt: addDays(toEnd, 1) } },
      include: { property: { select: { name: true } }, unit: unitInc, tenant: true },
    }),
    db.task.findMany({ where: { status: { not: "DONE" }, dueDate: { gte: from, lt: toEnd } } }),
    db.inspection.findMany({
      where: { OR: [{ result: "PENDING", scheduledDate: { gte: from, lt: toEnd } }, { result: "FAIL", cureByDate: { gte: from, lt: toEnd } }] },
      include: { unit: unitInc },
    }),
    db.maintenanceRequest.findMany({
      where: { status: { in: ["SCHEDULED", "IN_PROGRESS", "OPEN"] }, scheduledOn: { gte: from, lt: toEnd } },
      include: { unit: unitInc, vendor: true },
    }),
    db.lease.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { startDate: { gte: from, lt: toEnd } },
          { endDate: { gte: from, lt: toEnd } },
          { nextRecertDate: { gte: from, lt: toEnd } },
          { startDate: { lt: toEnd }, OR: [{ endDate: null }, { endDate: { gte: from } }] }, // for rent due days
        ],
      },
      include: { tenant: true, unit: unitInc },
    }),
  ]);

  const items: CalItem[] = [];
  const inRange = (d: Date) => d >= from && d < toEnd;

  for (const e of events) {
    const day = e.allDay ? e.start : zonedDay(e.start, tz);
    if (!inRange(day)) continue;
    const where = e.unit ? place(e.unit) : e.property?.name;
    items.push({
      key: `event-${e.id}`, kind: "event", day, allDay: e.allDay, start: e.allDay ? undefined : e.start, end: e.end ?? undefined,
      title: e.title, detail: [titleCase(e.type), e.tenant ? tenantName(e.tenant) : null, where, e.description].filter(Boolean).join(" · "),
      location: e.location ?? undefined, href: `/calendar?month=${periodOf(day)}&event=${e.id}`, eventId: e.id,
    });
  }
  for (const t of tasks)
    items.push({ key: `task-${t.id}`, kind: "task", day: t.dueDate!, allDay: true, title: t.title, detail: t.description ?? undefined, href: "/tasks" });
  for (const i of inspections) {
    if (i.result === "PENDING")
      items.push({ key: `insp-${i.id}`, kind: "inspection", day: i.scheduledDate, allDay: true, title: `${titleCase(i.type)} inspection · ${place(i.unit)}`, href: "/inspections" });
    else
      items.push({ key: `cure-${i.id}`, kind: "cure", day: i.cureByDate!, allDay: true, title: `Cure deadline · ${place(i.unit)}`, detail: i.deficiencies ?? undefined, href: "/inspections" });
  }
  for (const w of workOrders)
    items.push({
      key: `wo-${w.id}`, kind: "workorder", day: w.scheduledOn!, allDay: true, title: `${w.title} · ${place(w.unit)}`,
      detail: w.vendor ? `Vendor: ${w.vendor.name}` : undefined, href: `/maintenance/${w.id}`,
    });

  const rentDays = new Map<number, number>(); // day → number of leases due
  for (const l of leases) {
    const who = `${tenantName(l.tenant)} · ${place(l.unit)}`;
    if (inRange(l.startDate)) items.push({ key: `ls-${l.id}`, kind: "lease-start", day: l.startDate, allDay: true, title: `Lease starts · ${who}`, href: `/leases/${l.id}` });
    if (l.endDate && inRange(l.endDate)) items.push({ key: `le-${l.id}`, kind: "lease-end", day: l.endDate, allDay: true, title: `Lease ends · ${who}`, href: `/leases/${l.id}` });
    if (l.nextRecertDate && inRange(l.nextRecertDate))
      items.push({ key: `rc-${l.id}`, kind: "recert", day: l.nextRecertDate, allDay: true, title: `Recertification due · ${who}`, href: `/leases/${l.id}` });
    // rent due in each month the range touches
    for (let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); m < toEnd; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const period = periodOf(m);
      if (!leaseCoversPeriod(l, period)) continue;
      const due = dueDateFor(period, l.dueDay);
      if (inRange(due)) rentDays.set(due.getTime(), (rentDays.get(due.getTime()) ?? 0) + 1);
    }
  }
  for (const [t, n] of rentDays) {
    const day = new Date(t);
    items.push({ key: `rent-${periodOf(day)}-${day.getUTCDate()}`, kind: "rent", day, allDay: true, title: `Rent due · ${n} lease${n === 1 ? "" : "s"}`, href: `/payments?period=${periodOf(day)}` });
  }

  const order: CalKind[] = ["event", "cure", "inspection", "workorder", "recert", "lease-start", "lease-end", "task", "rent"];
  return items.sort(
    (a, b) =>
      a.day.getTime() - b.day.getTime() ||
      Number(a.allDay) - Number(b.allDay) ||
      (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) ||
      order.indexOf(a.kind) - order.indexOf(b.kind),
  );
}
