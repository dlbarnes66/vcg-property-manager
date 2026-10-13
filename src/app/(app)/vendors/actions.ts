"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { optStr, reqStr } from "@/lib/form";

const vendorData = (fd: FormData) => ({
  name: reqStr(fd, "name", "Name"),
  trade: optStr(fd, "trade"),
  phone: optStr(fd, "phone"),
  email: optStr(fd, "email"),
  notes: optStr(fd, "notes"),
});

export async function createVendor(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.vendor.create({ data: vendorData(fd) });
    revalidatePath("/vendors");
    return { ok: true, message: "Added" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateVendor(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.vendor.update({ where: { id }, data: vendorData(fd) });
    revalidatePath("/vendors");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteVendor(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.vendor.delete({ where: { id } }); // work orders keep their history; vendor link is cleared
    revalidatePath("/vendors");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
