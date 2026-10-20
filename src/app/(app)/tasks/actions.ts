"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { oneOf, optDate, optStr, reqStr } from "@/lib/form";
import { RECURRENCES, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/enums";
import { readLinks } from "@/lib/links";
import { completeTask } from "@/lib/tasks";

function revalidateAll(fd?: FormData) {
  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath("/calendar");
  const back = fd ? optStr(fd, "returnPath") : null;
  if (back?.startsWith("/") && !back.startsWith("//")) revalidatePath(back);
}

function taskFields(fd: FormData) {
  const recurrence = oneOf(fd, "recurrence", RECURRENCES, "NONE");
  const dueDate = optDate(fd, "dueDate");
  if (recurrence !== "NONE" && !dueDate) throw new Error("A repeating task needs a due date");
  return {
    title: reqStr(fd, "title", "Task").slice(0, 200),
    description: optStr(fd, "description"),
    priority: oneOf(fd, "priority", TASK_PRIORITIES, "NORMAL"),
    dueDate,
    recurrence,
    assigneeEmail: optStr(fd, "assigneeEmail")?.toLowerCase() ?? null,
  };
}

export async function createTask(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    await db.task.create({ data: { ...taskFields(fd), ...readLinks(fd), createdByEmail: email } });
    revalidateAll(fd);
    return { ok: true, message: "Task added" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTask(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const status = oneOf(fd, "status", TASK_STATUSES, "TODO");
    const before = await db.task.findUniqueOrThrow({ where: { id } });
    await db.task.update({ where: { id }, data: taskFields(fd) });
    if (status === "DONE" && before.status !== "DONE") await completeTask(id);
    else if (status !== before.status) await db.task.update({ where: { id }, data: { status, completedAt: null } });
    revalidateAll(fd);
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

/** One-click done / reopen from a list. */
export async function toggleTaskDone(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const t = await db.task.findUniqueOrThrow({ where: { id } });
    if (t.status === "DONE") await db.task.update({ where: { id }, data: { status: "TODO", completedAt: null } });
    else await completeTask(id);
    revalidateAll();
    if (returnPath.startsWith("/")) revalidatePath(returnPath);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTask(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.task.delete({ where: { id } });
    revalidateAll();
    if (returnPath.startsWith("/")) revalidatePath(returnPath);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
