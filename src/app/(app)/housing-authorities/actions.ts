"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { optStr, reqStr } from "@/lib/form";

function haData(fd: FormData) {
  const portalUrl = optStr(fd, "portalUrl");
  if (portalUrl && !/^https?:\/\//i.test(portalUrl)) throw new Error("Portal URL must start with http:// or https://");
  return {
    name: reqStr(fd, "name", "Name"),
    contactName: optStr(fd, "contactName"),
    email: optStr(fd, "email"),
    phone: optStr(fd, "phone"),
    portalUrl,
    notes: optStr(fd, "notes"),
  };
}

export async function createHousingAuthority(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.housingAuthority.create({ data: haData(fd) });
    revalidatePath("/housing-authorities");
    return { ok: true, message: "Added" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateHousingAuthority(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.housingAuthority.update({ where: { id }, data: haData(fd) });
    revalidatePath("/housing-authorities");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteHousingAuthority(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    if (await db.lease.count({ where: { housingAuthorityId: id } })) throw new Error("Leases reference this housing authority.");
    await db.housingAuthority.delete({ where: { id } });
    revalidatePath("/housing-authorities");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
