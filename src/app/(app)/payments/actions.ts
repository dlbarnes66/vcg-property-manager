"use server";

import { revalidatePath } from "next/cache";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { reqStr } from "@/lib/form";
import { applyLateFees, generateRentCharges } from "@/lib/ledger";
import { periodLabel } from "@/lib/utils";

export async function runRentCharges(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const period = reqStr(fd, "period", "Month");
    const { created, eligibleLeases } = await generateRentCharges(period);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: created
        ? `Posted ${created} rent charge${created === 1 ? "" : "s"} for ${periodLabel(period)} across ${eligibleLeases} lease${eligibleLeases === 1 ? "" : "s"}.`
        : `${periodLabel(period)} rent was already posted for all ${eligibleLeases} active leases.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function runLateFees(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const period = reqStr(fd, "period", "Month");
    const { created } = await applyLateFees(period);
    revalidatePath("/", "layout");
    return { ok: true, message: created ? `Applied ${created} late fee${created === 1 ? "" : "s"}.` : "No late fees due right now." };
  } catch (e) {
    return toActionError(e);
  }
}
