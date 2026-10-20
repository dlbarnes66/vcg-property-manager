import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { maintTone, priorityTone } from "@/components/unit-select";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { cn, daysBetween, fmtDate, money, titleCase, todayUTC } from "@/lib/utils";

export const metadata = { title: "Maintenance" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "open" } = await searchParams;
  const open = view !== "closed" && view !== "all";
  const orders = await db.maintenanceRequest.findMany({
    where: view === "all" ? undefined : { status: open ? { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } : { in: ["COMPLETED", "CANCELLED"] } },
    orderBy: [{ reportedOn: open ? "asc" : "desc" }],
    include: { unit: { include: { property: true } }, vendor: true, submittedBy: true },
  });
  // Emergencies first when looking at open work
  const priorityRank = { EMERGENCY: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  if (open) orders.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  const today = todayUTC();

  return (
    <>
      <PageHeader
        title="Maintenance"
        actions={
          <LinkButton href="/maintenance/new">
            <Plus size={16} /> New work order
          </LinkButton>
        }
      />
      <div className="mb-4 flex gap-1">
        {[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, label]) => (
          <Link key={k} href={`/maintenance?view=${k}`} className={cn("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-navy text-white" : "text-muted hover:bg-white")}>
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {orders.length === 0 ? (
          <Empty>{open ? "No open work orders. 🎉" : "Nothing here."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Work order</Th>
                <Th>Unit</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Vendor</Th>
                <Th>{open ? "Age" : "Completed"}</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-paper/50">
                  <Td>
                    <Link href={`/maintenance/${o.id}`} className="font-medium hover:underline">
                      {o.title}
                    </Link>
                    {o.submittedBy && (
                      <span className="ml-2">
                        <Badge tone="navy">From tenant</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="text-muted">
                    {o.unit.property.name} · {o.unit.label}
                  </Td>
                  <Td>
                    <Badge tone={priorityTone(o.priority)}>{titleCase(o.priority)}</Badge>
                  </Td>
                  <Td>
                    <Badge tone={maintTone(o.status)}>{titleCase(o.status)}</Badge>
                  </Td>
                  <Td className="text-muted">{o.vendor?.name ?? "—"}</Td>
                  <Td className="tabular text-muted">{open ? `${Math.max(0, daysBetween(o.reportedOn, today))}d` : fmtDate(o.completedOn)}</Td>
                  <Td className="tabular text-right">{money(o.cost)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
