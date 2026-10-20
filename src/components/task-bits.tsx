import type { Task } from "@prisma/client";
import { Repeat } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { adminEmails } from "@/lib/auth";
import { RECURRENCES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/enums";
import type { Links } from "@/lib/links";
import { cn, dateToInput, daysBetween, fmtDate, titleCase, todayUTC } from "@/lib/utils";
import { deleteTask, toggleTaskDone, updateTask } from "@/app/(app)/tasks/actions";

const recurrenceLabels = { NONE: "Doesn't repeat", WEEKLY: "Weekly", MONTHLY: "Monthly", QUARTERLY: "Quarterly", YEARLY: "Yearly" };
export const priorityTone = (p: string) => ({ LOW: "gray", NORMAL: "gray", HIGH: "amber", URGENT: "red" })[p] as "gray" | "amber" | "red";

/** Form fields shared by "add task" and "edit task". Links go in as hidden inputs. */
export function TaskFields({ task, links, returnPath, compact }: { task?: Task; links?: Links; returnPath: string; compact?: boolean }) {
  const admins = adminEmails();
  return (
    <>
      {Object.entries(links ?? {}).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
      {task &&
        (["propertyId", "unitId", "tenantId", "leaseId", "maintenanceId", "vendorId", "housingAuthorityId"] as const).map(
          (k) => task[k] && <input key={k} type="hidden" name={k} value={task[k]!} />,
        )}
      <input type="hidden" name="returnPath" value={returnPath} />
      <Field label="Task *">
        <Input name="title" defaultValue={task?.title} placeholder="Call PHA about October HAP" required maxLength={200} />
      </Field>
      {!compact && (
        <Field label="Details">
          <Textarea name="description" rows={3} defaultValue={task?.description ?? ""} />
        </Field>
      )}
      <FormGrid>
        <Field label="Due">
          <Input name="dueDate" type="date" defaultValue={dateToInput(task?.dueDate)} />
        </Field>
        <Field label="Priority">
          <EnumSelect name="priority" values={TASK_PRIORITIES} defaultValue={task?.priority ?? "NORMAL"} />
        </Field>
        {!compact && (
          <>
            <Field label="Repeats">
              <EnumSelect name="recurrence" values={RECURRENCES} labels={recurrenceLabels} defaultValue={task?.recurrence ?? "NONE"} />
            </Field>
            {admins.length > 1 ? (
              <Field label="Assigned to">
                <Select name="assigneeEmail" defaultValue={task?.assigneeEmail ?? ""}>
                  <option value="">Unassigned</option>
                  {admins.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="assigneeEmail" value={task?.assigneeEmail ?? ""} />
            )}
            {task && (
              <Field label="Status">
                <EnumSelect name="status" values={TASK_STATUSES} defaultValue={task.status} />
              </Field>
            )}
          </>
        )}
      </FormGrid>
    </>
  );
}

/** One task line: done toggle, title, due, link, edit. */
export function TaskRow({ task, returnPath, link }: { task: Task; returnPath: string; link?: { href: string; label: string } | null }) {
  const today = todayUTC();
  const done = task.status === "DONE";
  const overdue = !done && task.dueDate && task.dueDate < today;
  const dueSoon = !done && task.dueDate && !overdue && daysBetween(today, task.dueDate) <= 2;
  return (
    <li className="flex items-start gap-3 px-5 py-3 text-sm">
      <ActionForm action={toggleTaskDone.bind(null, task.id, returnPath)} submitLabel={done ? "Reopen" : "Done"} submitVariant={done ? "ghost" : "secondary"} inline />
      <div className="min-w-0 flex-1">
        <div className={cn("font-medium", done && "text-muted line-through")}>
          {task.title}
          {(task.priority === "HIGH" || task.priority === "URGENT") && !done && (
            <span className="ml-2"><Badge tone={priorityTone(task.priority)}>{titleCase(task.priority)}</Badge></span>
          )}
          {task.status === "IN_PROGRESS" && <span className="ml-2"><Badge tone="blue">In progress</Badge></span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {task.dueDate && (
            <span className={cn(overdue && "font-medium text-red-700", dueSoon && "text-amber-700")}>
              {done ? `Done ${fmtDate(task.completedAt)}` : overdue ? `Overdue · ${fmtDate(task.dueDate)}` : `Due ${fmtDate(task.dueDate)}`}
            </span>
          )}
          {task.recurrence !== "NONE" && (
            <span className="inline-flex items-center gap-1"><Repeat size={11} /> {recurrenceLabels[task.recurrence]}</span>
          )}
          {link && <a href={link.href} className="hover:text-ink hover:underline">{link.label}</a>}
          {task.assigneeEmail && <span>→ {task.assigneeEmail.split("@")[0]}</span>}
        </div>
        {task.description && !done && <p className="mt-1 line-clamp-2 text-xs whitespace-pre-wrap text-muted">{task.description}</p>}
      </div>
      <EditPopover title="Edit task">
        <ActionForm action={updateTask.bind(null, task.id)} submitLabel="Save task">
          <TaskFields task={task} returnPath={returnPath} />
        </ActionForm>
        <div className="mt-3 border-t border-line pt-3">
          <ActionForm action={deleteTask.bind(null, task.id, returnPath)} submitLabel="Delete task" submitVariant="danger" confirm="Delete this task?" />
        </div>
      </EditPopover>
    </li>
  );
}
