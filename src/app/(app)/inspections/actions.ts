"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optDate, optStr, reqDate, reqStr } from "@/lib/form";
import { INSPECTION_RESULTS, INSPECTION_TYPES } from "@/lib/enums";
import { addDays, todayUTC } from "@/lib/utils";

export async function createInspection(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.inspection.create({
      data: {
        unitId: reqStr(fd, "unitId", "Unit"),
        type: oneOf(fd, "type", INSPECTION_TYPES),
        scheduledDate: reqDate(fd, "scheduledDate", "Scheduled date"),
        inspector: optStr(fd, "inspector"),
      },
    });
    revalidatePath("/inspections");
    return { ok: true, message: "Inspection scheduled" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function recordInspection(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const result = oneOf(fd, "result", INSPECTION_RESULTS);
    const completedDate = result === "PENDING" ? null : (optDate(fd, "completedDate") ?? todayUTC());
    // HQS failures typically allow ~30 days to cure (24 hours for life-threatening items) — adjust per PHA letter.
    let cureByDate = optDate(fd, "cureByDate");
    if (result === "FAIL" && !cureByDate && completedDate) cureByDate = addDays(completedDate, 30);

    const insp = await db.inspection.update({
      where: { id },
      data: {
        result,
        completedDate,
        cureByDate: result === "FAIL" ? cureByDate : null,
        inspector: optStr(fd, "inspector"),
        deficiencies: optStr(fd, "deficiencies"),
      },
    });

    let msg = "Saved";
    if (result === "FAIL" && bool(fd, "scheduleReinspection") && cureByDate) {
      await db.inspection.create({ data: { unitId: insp.unitId, type: "REINSPECTION", scheduledDate: cureByDate, inspector: insp.inspector } });
      msg = "Saved and re-inspection scheduled";
    }
    if (result === "FAIL" && bool(fd, "createWorkOrder")) {
      await db.maintenanceRequest.create({
        data: {
          unitId: insp.unitId,
          title: "Fix inspection deficiencies",
          description: insp.deficiencies ?? "See failed inspection",
          priority: "HIGH",
          scheduledOn: null,
        },
      });
      msg += " · work order created";
    }
    revalidatePath("/inspections");
    revalidatePath("/maintenance");
    return { ok: true, message: msg };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteInspection(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.inspection.delete({ where: { id } });
    revalidatePath("/inspections");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
