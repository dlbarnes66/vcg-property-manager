import Link from "next/link";
import { AlertTriangle, CalendarClock, ClipboardCheck, FileClock, Wrench } from "lucide-react";
import { db } from "@/lib/db";
import { delinquency, rentRoll } from "@/lib/reports";
import { openFailures, tenantName } from "@/lib/queries";
import { leaseCoversPeriod } from "@/lib/ledger";
import { calendarItems, kindLabel } from "@/lib/calendar";
import { fmtTime } from "@/lib/dates";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader, Stat } from "@/components/ui";
import { addDays, daysBetween, fmtDate, money, periodBounds, periodLabel, periodOf, titleCase, todayUTC } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const today = todayUTC();
  const period = periodOf(today);
  const { start, end } = periodBounds(period);
  const soon = addDays(today, 60);

  const [todayItems, dueTasks, unreadReplies] = await Promise.all([
    calendarItems(today, today),
    db.task.count({ where: { status: { not: "DONE" }, dueDate: { lte: today } } }),
    db.message.count({ where: { direction: "INBOUND", readAt: null } }),
  ]);
  const [roll, late, monthCharges, monthPayments, activeLeases, openWOs, inspections, propertyCount] = await Promise.all([
    rentRoll(today),
    delinquency(today),
    db.charge.findMany({ where: { period, type: "RENT" }, select: { amount: true, party: true, leaseId: true } }),
    db.payment.findMany({ where: { paidOn: { gte: start, lte: end } }, select: { amount: true, party: true } }),
    db.lease.findMany({ where: { status: "ACTIVE" }, include: { tenant: true, unit: { include: { property: true } } } }),
    db.maintenanceRequest.findMany({
      where: { status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } },
      include: { unit: { include: { property: true } } },
      orderBy: { reportedOn: "asc" },
    }),
    db.inspection.findMany({
      where: { OR: [{ result: "PENDING", scheduledDate: { lte: addDays(today, 30) } }, { result: { not: "PENDING" } }] },
      include: { unit: { include: { property: true } } },
      orderBy: { scheduledDate: "asc" },
    }),
    db.property.count(),
  ]);

  if (propertyCount === 0) {
    return (
      <>
        <PageHeader title="Welcome" subtitle="Let's get your portfolio set up." />
        <Card>
          <div className="flex flex-col gap-4 p-8">
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Add a <b>housing authority</b> (the PHA that pays HAP on your HUD-VASH units).</li>
              <li>Add a <b>property</b> and its units.</li>
              <li>Add <b>tenants</b>, then create a <b>lease</b> with the tenant / HAP rent split.</li>
              <li>Each month, open <b>Rent &amp; Payments</b> and post rent, then record payments as they arrive.</li>
            </ol>
            <div className="flex gap-2">
              <LinkButton href="/housing-authorities" variant="secondary">Add housing authority</LinkButton>
              <LinkButton href="/properties/new">Add property</LinkButton>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const occupied = roll.filter((r) => r.status === "Occupied").length;
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const billed = sum(monthCharges);
  const collectedRentMonth = sum(monthPayments);
  const pastDueTenant = late.filter((r) => r.party === "Tenant").reduce((s, r) => s + r.pastDue, 0);
  const pastDueHap = late.filter((r) => r.party !== "Tenant").reduce((s, r) => s + r.pastDue, 0);

  // Rent not yet posted this month?
  const postedLeaseIds = new Set(monthCharges.map((c) => c.leaseId));
  const unposted = activeLeases.filter((l) => leaseCoversPeriod(l, period) && !postedLeaseIds.has(l.id)).length;

  const recerts = activeLeases.filter((l) => l.nextRecertDate && l.nextRecertDate <= soon).sort((a, b) => a.nextRecertDate!.getTime() - b.nextRecertDate!.getTime());
  const expiring = activeLeases.filter((l) => l.endDate && l.endDate <= soon).sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime());
  const emergencies = openWOs.filter((w) => w.priority === "EMERGENCY" || w.priority === "HIGH");
  const fails = openFailures(inspections);
  const dueInspections = inspections.filter((i) => i.result === "PENDING");

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${periodLabel(period)} · ${roll.length} units across ${propertyCount} ${propertyCount === 1 ? "property" : "properties"}`} />

      {unposted > 0 && (
        <Link href="/payments" className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <AlertTriangle size={16} />
          {periodLabel(period)} rent hasn&apos;t been posted for {unposted} active lease{unposted === 1 ? "" : "s"}. Post it from Rent &amp; Payments →
        </Link>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Occupancy" value={roll.length ? `${Math.round((occupied / roll.length) * 100)}%` : "—"} sub={`${occupied} of ${roll.length} units · ${roll.length - occupied} vacant`} />
        <Stat label={`Collected in ${periodLabel(period).split(" ")[0]}`} value={money(collectedRentMonth)}
          sub={billed ? `of ${money(billed)} rent billed (${Math.round((collectedRentMonth / billed) * 100)}%)` : "Rent not posted yet"} />
        <Stat label="Tenants past due" value={money(pastDueTenant)} tone={pastDueTenant > 0 ? "bad" : "good"} sub={`${late.filter((r) => r.party === "Tenant").length} households`} />
        <Stat label="HAP past due" value={money(pastDueHap)} tone={pastDueHap > 0 ? "bad" : "good"} sub="Owed by housing authorities" />
      </div>

      <Card className="mb-6">
        <CardHeader
          title={`Today · ${fmtDate(today)}`}
          action={
            <span className="flex gap-3 text-xs">
              <Link href="/tasks" className={dueTasks ? "font-medium text-amber-700" : "text-muted hover:text-ink"}>{dueTasks} task{dueTasks === 1 ? "" : "s"} due</Link>
              <Link href="/communications?tab=inbox" className={unreadReplies ? "font-medium text-red-700" : "text-muted hover:text-ink"}>{unreadReplies} new repl{unreadReplies === 1 ? "y" : "ies"}</Link>
              <Link href="/calendar" className="text-muted hover:text-ink">Calendar →</Link>
            </span>
          }
        />
        {todayItems.length === 0 ? (
          <div className="px-5 py-4 text-sm text-muted">Nothing on the calendar today.</div>
        ) : (
          <ul className="divide-y divide-line">
            {todayItems.slice(0, 8).map((it) => (
              <li key={it.key}>
                <Link href={it.href} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-paper/50">
                  <span className="w-16 shrink-0 text-xs text-muted">{it.allDay || !it.start ? kindLabel[it.kind] : fmtTime(it.start)}</span>
                  <span className="truncate">{it.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Past due" action={<Link href="/reports?r=delinquency" className="text-xs text-muted hover:text-ink">Aging report →</Link>} />
          {late.length === 0 ? (
            <Empty>Everyone is current.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {late.slice(0, 6).map((r) => (
                <li key={`${r.leaseId}-${r.party}`}>
                  <Link href={`/leases/${r.leaseId}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-paper/50">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.property} · {r.unit}</div>
                      <div className="text-xs text-muted">
                        {r.party === "Tenant" ? r.tenant : r.payer} · oldest {fmtDate(r.oldestPastDue)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.party !== "Tenant" && <Badge tone="blue">HAP</Badge>}
                      <span className="tabular font-semibold text-red-700">{money(r.pastDue)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Needs attention" />
          <ul className="divide-y divide-line text-sm">
            {fails.map((i) => (
              <Item key={i.id} href="/inspections" icon={<ClipboardCheck size={16} className="text-red-700" />}
                title={`Failed ${titleCase(i.type)} · ${i.unit.property.name} ${i.unit.label}`}
                meta={i.cureByDate ? `Cure by ${fmtDate(i.cureByDate)}${i.cureByDate < today ? " (overdue — HAP at risk)" : ""}` : undefined} tone="bad" />
            ))}
            {emergencies.map((w) => (
              <Item key={w.id} href={`/maintenance/${w.id}`} icon={<Wrench size={16} className={w.priority === "EMERGENCY" ? "text-red-700" : "text-amber-700"} />}
                title={`${w.title} · ${w.unit.property.name} ${w.unit.label}`} meta={`${titleCase(w.priority)} · open ${Math.max(0, daysBetween(w.reportedOn, today))} days`} />
            ))}
            {dueInspections.map((i) => (
              <Item key={i.id} href="/inspections" icon={<ClipboardCheck size={16} className="text-blue-700" />}
                title={`${titleCase(i.type)} inspection · ${i.unit.property.name} ${i.unit.label}`} meta={fmtDate(i.scheduledDate)} />
            ))}
            {recerts.map((l) => (
              <Item key={`r-${l.id}`} href={`/leases/${l.id}`} icon={<FileClock size={16} className="text-navy" />}
                title={`Recertification · ${tenantName(l.tenant)}`} meta={`${l.unit.property.name} ${l.unit.label} · ${fmtDate(l.nextRecertDate)}`} />
            ))}
            {expiring.map((l) => (
              <Item key={`e-${l.id}`} href={`/leases/${l.id}`} icon={<CalendarClock size={16} className="text-muted" />}
                title={`Lease ending · ${tenantName(l.tenant)}`} meta={`${l.unit.property.name} ${l.unit.label} · ${fmtDate(l.endDate)}`} />
            ))}
            {fails.length + emergencies.length + dueInspections.length + recerts.length + expiring.length === 0 && (
              <li><Empty>Nothing urgent in the next 60 days.</Empty></li>
            )}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={`Open work orders (${openWOs.length})`} action={<Link href="/maintenance" className="text-xs text-muted hover:text-ink">All maintenance →</Link>} />
          {openWOs.length === 0 ? (
            <Empty>No open work orders.</Empty>
          ) : (
            <ul className="grid grid-cols-1 divide-y divide-line md:grid-cols-2 md:divide-y-0">
              {openWOs.slice(0, 8).map((w) => (
                <li key={w.id}>
                  <Link href={`/maintenance/${w.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-paper/50">
                    <span className="truncate">{w.title} <span className="text-muted">· {w.unit.property.name} {w.unit.label}</span></span>
                    <Badge tone={w.status === "OPEN" ? "red" : w.status === "SCHEDULED" ? "blue" : "amber"}>{titleCase(w.status)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Item({ href, icon, title, meta, tone }: { href: string; icon: React.ReactNode; title: string; meta?: string; tone?: "bad" }) {
  return (
    <li>
      <Link href={href} className="flex items-start gap-3 px-5 py-2.5 hover:bg-paper/50">
        <span className="mt-0.5">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          {meta && <span className={tone === "bad" ? "text-xs text-red-700" : "text-xs text-muted"}>{meta}</span>}
        </span>
      </Link>
    </li>
  );
}
