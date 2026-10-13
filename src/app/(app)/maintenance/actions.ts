"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { oneOf, optDate, optMoney, optStr, reqStr } from "@/lib/form";
import { MAINT_PRIORITIES, MAINT_STATUSES } from "@/lib/enums";
import { todayUTC } from "@/lib/utils";

export async function createWorkOrder(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const wo = await db.maintenanceRequest.create({
      data: {
        unitId: reqStr(fd, "unitId", "Unit"),
        title: reqStr(fd, "title", "Title"),
        description: optStr(fd, "description"),
        priority: oneOf(fd, "priority", MAINT_PRIORITIES, "NORMAL"),
        vendorId: optStr(fd, "vendorId"),
        reportedOn: optDate(fd, "reportedOn") ?? todayUTC(),
        scheduledOn: optDate(fd, "scheduledOn"),
        status: optDate(fd, "scheduledOn") ? "SCHEDULED" : "OPEN",
      },
    });
    revalidatePath("/maintenance");
    redirect(`/maintenance/${wo.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateWorkOrder(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const status = oneOf(fd, "status", MAINT_STATUSES);
    let completedOn = optDate(fd, "completedOn");
    if (status === "COMPLETED" && !completedOn) completedOn = todayUTC();
    if (status !== "COMPLETED") completedOn = null;
    await db.maintenanceRequest.update({
      where: { id },
      data: {
        title: reqStr(fd, "title", "Title"),
        description: optStr(fd, "description"),
        status,
        priority: oneOf(fd, "priority", MAINT_PRIORITIES),
        vendorId: optStr(fd, "vendorId"),
        scheduledOn: optDate(fd, "scheduledOn"),
        completedOn,
        cost: optMoney(fd, "cost", "Cost"),
      },
    });
    revalidatePath(`/maintenance/${id}`);
    revalidatePath("/maintenance");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteWorkOrder(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.maintenanceRequest.delete({ where: { id } });
    revalidatePath("/maintenance");
    redirect("/maintenance");
  } catch (e) {
    return toActionError(e);
  }
}
