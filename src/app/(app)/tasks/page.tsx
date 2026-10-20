import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { linkInclude, linkLabel } from "@/lib/links";
import { ActionForm } from "@/components/action-form";
import { TaskFields, TaskRow } from "@/components/task-bits";
import { FilterSelect } from "@/components/filter-select";
import { Card, CardBody, CardHeader, Empty, PageHeader } from "@/components/ui";
import { addDays, cn, todayUTC } from "@/lib/utils";
import { createTask } from "./actions";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string; property?: string }> }) {
  const { view = "open", property } = await searchParams;
  const today = todayUTC();
  const where: Prisma.TaskWhereInput = {
    status: view === "done" ? "DONE" : { not: "DONE" },
    ...(property
      ? { OR: [{ propertyId: property }, { unit: { propertyId: property } }, { lease: { unit: { propertyId: property } } }, { maintenance: { unit: { propertyId: property } } }] }
      : {}),
  };
  const [tasks, properties] = await Promise.all([
    db.task.findMany({
      where,
      include: linkInclude,
      orderBy: view === "done" ? [{ completedAt: "desc" }] : [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "asc" }],
      take: view === "done" ? 100 : 500,
    }),
    db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const groups =
    view === "done"
      ? [{ title: "Recently completed", items: tasks }]
      : [
          { title: "Overdue", items: tasks.filter((t) => t.dueDate && t.dueDate < today), tone: "text-red-700" },
          { title: "Today", items: tasks.filter((t) => t.dueDate && t.dueDate.getTime() === today.getTime()) },
          { title: "Next 7 days", items: tasks.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7)) },
          { title: "Later", items: tasks.filter((t) => t.dueDate && t.dueDate > addDays(today, 7)) },
          { title: "No due date", items: tasks.filter((t) => !t.dueDate) },
        ].filter((g) => g.items.length > 0);

  const qs = (v: string) => `/tasks?view=${v}${property ? `&property=${property}` : ""}`;

  return (
    <>
      <PageHeader title="Tasks" subtitle={view === "done" ? "Completed tasks" : `${tasks.length} open`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[["open", "Open"], ["done", "Done"]].map(([k, label]) => (
          <Link key={k} href={qs(k)} className={cn("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-navy text-white" : "text-muted hover:bg-white")}>
            {label}
          </Link>
        ))}
        <form className="ml-auto w-56">
          <input type="hidden" name="view" value={view} />
          <FilterSelect name="property" defaultValue={property ?? ""} aria-label="Filter by property">
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FilterSelect>
          <noscript><button type="submit">Filter</button></noscript>
        </form>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {groups.length === 0 ? (
            <Card><Empty>{view === "done" ? "Nothing completed yet." : "No open tasks. Nice work."}</Empty></Card>
          ) : (
            groups.map((g) => (
              <Card key={g.title}>
                <div className={cn("border-b border-line px-5 py-3 text-sm font-semibold", "tone" in g && g.tone)}>
                  {g.title} <span className="font-normal text-muted">· {g.items.length}</span>
                </div>
                <ul className="divide-y divide-line">
                  {g.items.map((t) => <TaskRow key={t.id} task={t} returnPath="/tasks" link={linkLabel(t)} />)}
                </ul>
              </Card>
            ))
          )}
        </div>
        <Card className="h-fit">
          <CardHeader title="New task" subtitle="To attach a task to a tenant, lease, or work order, add it from that page." />
          <CardBody>
            <ActionForm action={createTask} submitLabel="Add task" resetOnSuccess>
              <TaskFields links={property ? { propertyId: property } : {}} returnPath="/tasks" />
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
