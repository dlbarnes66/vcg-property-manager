import { headers } from "next/headers";
import { db } from "@/lib/db";
import type { Links } from "@/lib/links";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, Empty } from "@/components/ui";
import { TaskFields, TaskRow } from "@/components/task-bits";
import { createTask } from "@/app/(app)/tasks/actions";

/** Open tasks for one record, plus a quick-add form. */
export async function TasksPanel({ link }: { link: Links }) {
  const returnPath = (await headers()).get("x-pathname") ?? "/tasks";
  const [open, doneCount] = await Promise.all([
    db.task.findMany({ where: { ...link, status: { not: "DONE" } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    db.task.count({ where: { ...link, status: "DONE" } }),
  ]);
  return (
    <Card>
      <CardHeader title="Tasks" subtitle={`${open.length} open${doneCount ? ` · ${doneCount} done` : ""}`} />
      {open.length === 0 ? <Empty>No open tasks.</Empty> : <ul className="divide-y divide-line">{open.map((t) => <TaskRow key={t.id} task={t} returnPath={returnPath} />)}</ul>}
      <div className="border-t border-line p-4">
        <ActionForm action={createTask} submitLabel="Add task" resetOnSuccess>
          <TaskFields links={link} returnPath={returnPath} compact />
        </ActionForm>
      </div>
    </Card>
  );
}
