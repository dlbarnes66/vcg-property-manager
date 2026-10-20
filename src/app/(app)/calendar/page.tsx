import Link from "next/link";
import type { CalendarEvent } from "@prisma/client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { calendarItems, kindLabel, type CalItem, type CalKind } from "@/lib/calendar";
import { appTimeZone, fmtTime, utcToZonedInput } from "@/lib/dates";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { Card, CardBody, CardHeader, Field, FormGrid, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/enums";
import { addDays, cn, dateToInput, fmtDate, periodBounds, periodLabel, periodOf, todayUTC } from "@/lib/utils";
import { createEvent, deleteEvent, updateEvent } from "./actions";

export const metadata = { title: "Calendar" };

const tone: Record<CalKind, string> = {
  event: "bg-navy text-white",
  task: "bg-paper text-ink border border-line",
  inspection: "bg-blue-50 text-blue-800",
  cure: "bg-red-50 text-red-800",
  workorder: "bg-amber-50 text-amber-900",
  "lease-start": "bg-emerald-50 text-emerald-800",
  "lease-end": "bg-gray-100 text-gray-700",
  recert: "bg-violet-50 text-violet-800",
  rent: "bg-gold/15 text-ink",
};

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; event?: string }> }) {
  const sp = await searchParams;
  const today = todayUTC();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : periodOf(today);
  const { start: first, end: last } = periodBounds(month);
  const gridStart = addDays(first, -first.getUTCDay()); // Sunday on/before the 1st
  const gridEnd = addDays(last, 6 - last.getUTCDay());
  const tz = appTimeZone();

  const [items, editing, properties, tenants] = await Promise.all([
    calendarItems(gridStart, gridEnd, tz),
    sp.event ? db.calendarEvent.findUnique({ where: { id: sp.event } }) : null,
    db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.tenant.findMany({ orderBy: [{ lastName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
  ]);

  const byDay = new Map<number, CalItem[]>();
  for (const it of items) byDay.set(it.day.getTime(), [...(byDay.get(it.day.getTime()) ?? []), it]);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const prev = periodOf(addDays(first, -1));
  const next = periodOf(addDays(last, 1));
  const agenda = items.filter((i) => i.day >= first && i.day <= last && i.day >= addDays(today, -7));

  const feedToken = process.env.CALENDAR_FEED_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={
          <span className="flex items-center gap-3">
            <Link href={`/calendar?month=${prev}`} aria-label="Previous month" className="hover:text-ink"><ChevronLeft size={16} /></Link>
            <span className="font-medium text-ink">{periodLabel(month)}</span>
            <Link href={`/calendar?month=${next}`} aria-label="Next month" className="hover:text-ink"><ChevronRight size={16} /></Link>
            {month !== periodOf(today) && <Link href="/calendar" className="text-xs underline">Today</Link>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="xl:col-span-3">
          {/* Month grid (tablet and up) */}
          <Card className="hidden overflow-hidden md:block">
            <div className="grid grid-cols-7 border-b border-line bg-paper/60 text-center text-xs font-medium text-muted">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = byDay.get(d.getTime()) ?? [];
                const inMonth = d.getUTCMonth() === first.getUTCMonth();
                const isToday = d.getTime() === today.getTime();
                return (
                  <div key={d.getTime()} className={cn("min-h-28 border-r border-b border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-paper/50")}>
                    <div className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs", isToday ? "bg-navy font-semibold text-white" : inMonth ? "text-ink" : "text-muted/60")}>
                      {d.getUTCDate()}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {list.slice(0, 4).map((it) => <Chip key={it.key} it={it} tz={tz} />)}
                      {list.length > 4 && <span className="px-1 text-[11px] text-muted">+{list.length - 4} more</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Agenda (phones) */}
          <Card className="md:hidden">
            <CardHeader title={`${periodLabel(month)} agenda`} />
            {agenda.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted">Nothing scheduled.</div>
            ) : (
              <ul className="divide-y divide-line">
                {agenda.map((it) => (
                  <li key={it.key} className="flex gap-3 px-4 py-2.5 text-sm">
                    <div className="w-14 shrink-0 text-xs text-muted">{fmtDate(it.day).replace(/, \d{4}$/, "")}</div>
                    <Link href={it.href} className="min-w-0">
                      <div className="truncate font-medium">{it.title}</div>
                      <div className="text-xs text-muted">{it.allDay || !it.start ? kindLabel[it.kind] : `${fmtTime(it.start, tz)} · ${kindLabel[it.kind]}`}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {(Object.keys(kindLabel) as CalKind[]).map((k) => (
              <span key={k} className={cn("rounded px-1.5 py-0.5", tone[k])}>{kindLabel[k]}</span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {editing ? (
            <Card>
              <CardHeader title="Edit event" action={<Link href={`/calendar?month=${month}`} className="text-xs text-muted hover:text-ink">Close</Link>} />
              <CardBody>
                <ActionForm action={updateEvent.bind(null, editing.id)} submitLabel="Save event">
                  <EventFields event={editing} properties={properties} tenants={tenants} tz={tz} />
                </ActionForm>
                <div className="mt-3 border-t border-line pt-3">
                  <ActionForm action={deleteEvent.bind(null, editing.id)} submitLabel="Delete event" submitVariant="danger" confirm="Delete this event?" />
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Add event" subtitle="Showings, meetings, appointments, reminders" />
              <CardBody>
                <ActionForm action={createEvent} submitLabel="Add to calendar" resetOnSuccess>
                  <EventFields properties={properties} tenants={tenants} tz={tz} defaultDate={month === periodOf(today) ? today : first} />
                </ActionForm>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Subscribe" subtitle="See all of this in Google, Apple, or Outlook Calendar" />
            <CardBody className="text-sm">
              {feedToken && feedToken.length >= 24 ? (
                <div className="flex flex-col gap-2">
                  <Input readOnly value={`${appUrl}/api/calendar/feed?token=${feedToken}`} className="font-mono text-xs" aria-label="Calendar feed link" />
                  <p className="text-xs text-muted">
                    Google Calendar: Other calendars → + → From URL. Apple Calendar: File → New Calendar Subscription. Treat this link like a password; change
                    CALENDAR_FEED_TOKEN to revoke it. Calendar apps refresh it every few hours.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  Set <code>CALENDAR_FEED_TOKEN</code> in <code>.env</code> to a long random value (at least 24 characters, e.g. from <code>openssl rand -hex 24</code>) to get a private subscription link. It only works once the app is online (not on localhost).
                </p>
              )}
            </CardBody>
          </Card>
          <LinkButton href="/tasks" variant="secondary">Open tasks</LinkButton>
        </div>
      </div>
    </>
  );
}

function Chip({ it, tz }: { it: CalItem; tz: string }) {
  return (
    <Link href={it.href} title={[it.title, it.detail].filter(Boolean).join("\n")} className={cn("truncate rounded px-1.5 py-0.5 text-[11px] leading-tight hover:opacity-80", tone[it.kind])}>
      {!it.allDay && it.start ? <span className="font-medium">{fmtTime(it.start, tz).replace(":00", "").replace(" ", "").toLowerCase()} </span> : null}
      {it.title}
    </Link>
  );
}

function EventFields({
  event, properties, tenants, tz, defaultDate,
}: {
  event?: CalendarEvent;
  properties: { id: string; name: string }[];
  tenants: { id: string; firstName: string; lastName: string }[];
  tz: string;
  defaultDate?: Date;
}) {
  const startLocal = event && !event.allDay ? utcToZonedInput(event.start, tz) : null;
  const endLocal = event?.end && !event.allDay ? utcToZonedInput(event.end, tz) : null;
  const date = event ? (event.allDay ? dateToInput(event.start) : startLocal!.slice(0, 10)) : dateToInput(defaultDate);
  return (
    <>
      <Field label="Title *">
        <Input name="title" defaultValue={event?.title} placeholder="Showing — Unit 104" required maxLength={200} />
      </Field>
      <FormGrid>
        <Field label="Type">
          <EnumSelect name="type" values={EVENT_TYPES} defaultValue={event?.type ?? "APPOINTMENT"} />
        </Field>
        <Field label="Date *">
          <Input name="date" type="date" defaultValue={date} required />
        </Field>
        <Field label="Start" hint={tz.replace("_", " ")}>
          <Input name="startTime" type="time" defaultValue={startLocal?.slice(11) ?? "10:00"} />
        </Field>
        <Field label="End">
          <Input name="endTime" type="time" defaultValue={endLocal?.slice(11) ?? ""} />
        </Field>
      </FormGrid>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allDay" defaultChecked={event?.allDay ?? false} className="size-4 accent-navy" /> All day
      </label>
      <Field label="Location">
        <Input name="location" defaultValue={event?.location ?? ""} />
      </Field>
      <FormGrid>
        <Field label="Property">
          <Select name="propertyId" defaultValue={event?.propertyId ?? ""}>
            <option value="">—</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Tenant">
          <Select name="tenantId" defaultValue={event?.tenantId ?? ""}>
            <option value="">—</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.lastName}, {t.firstName}</option>)}
          </Select>
        </Field>
      </FormGrid>
      <Field label="Notes">
        <Textarea name="description" rows={2} defaultValue={event?.description ?? ""} />
      </Field>
    </>
  );
}
