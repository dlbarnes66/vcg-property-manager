"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, optStr, reqStr } from "@/lib/form";

function tenantData(fd: FormData) {
  const email = optStr(fd, "email");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Email doesn't look valid");
  return {
    firstName: reqStr(fd, "firstName", "First name"),
    lastName: reqStr(fd, "lastName", "Last name"),
    email,
    phone: optStr(fd, "phone"),
    isVeteran: bool(fd, "isVeteran"),
    caseManagerName: optStr(fd, "caseManagerName"),
    caseManagerPhone: optStr(fd, "caseManagerPhone"),
    caseManagerEmail: optStr(fd, "caseManagerEmail"),
    emergencyContactName: optStr(fd, "emergencyContactName"),
    emergencyContactPhone: optStr(fd, "emergencyContactPhone"),
    notes: optStr(fd, "notes"),
  };
}

export async function createTenant(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const t = await db.tenant.create({ data: tenantData(fd) });
    revalidatePath("/tenants");
    redirect(`/tenants/${t.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTenant(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.tenant.update({ where: { id }, data: tenantData(fd) });
    revalidatePath(`/tenants/${id}`);
    redirect(`/tenants/${id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTenant(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    if (await db.lease.count({ where: { tenantId: id } })) throw new Error("This tenant has leases on file and can't be deleted.");
    await db.tenant.delete({ where: { id } });
    revalidatePath("/tenants");
    redirect("/tenants");
  } catch (e) {
    return toActionError(e);
  }
}
