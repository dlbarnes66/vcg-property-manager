"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";
import { isAdminEmail, requireAccess } from "@/lib/auth";
import { appOrigin } from "@/lib/portal";
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
    smsConsent: bool(fd, "smsConsent"),
    emailOptOut: bool(fd, "emailOptOut"),
  };
}

export async function createTenant(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const data = tenantData(fd);
    const t = await db.tenant.create({ data: { ...data, smsConsentAt: data.smsConsent ? new Date() : null } });
    revalidatePath("/tenants");
    redirect(`/tenants/${t.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTenant(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const data = { ...tenantData(fd), smsConsentAt: undefined as Date | undefined };
    const before = await db.tenant.findUniqueOrThrow({ where: { id } });
    if (data.smsConsent && !before.smsConsent) data.smsConsentAt = new Date();
    const emailChanged = (before.email ?? "").toLowerCase() !== (data.email ?? "").toLowerCase();
    // A new email means a new person could be on the other end: portal access must be re-sent.
    await db.tenant.update({ where: { id }, data: emailChanged && before.portalEnabled ? { ...data, portalEnabled: false, clerkUserId: null } : data });
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

/* ---------------------------------------------------------------------------------------------
 * Tenant portal access
 * ------------------------------------------------------------------------------------------- */

export async function inviteTenantToPortal(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id } });
    const email = tenant.email?.trim().toLowerCase();
    if (!email) throw new Error("Add the tenant's email address first (Edit → Email).");
    if (isAdminEmail(email)) throw new Error("That email is on your admin list (ALLOWED_EMAILS). Use a different address for the tenant.");
    const clash = await db.tenant.findFirst({ where: { id: { not: id }, portalEnabled: true, email: { equals: email, mode: "insensitive" } } });
    if (clash) throw new Error(`${clash.firstName} ${clash.lastName} already has portal access with this email. Each tenant needs their own email.`);

    const clerk = await clerkClient();
    const existing = await clerk.users.getUserList({ emailAddress: [email] });
    const user = existing.data[0];

    if (user) {
      // They already have a Clerk account (e.g. signed up before): link it directly.
      await clerk.users.updateUserMetadata(user.id, { publicMetadata: { tenantId: id } });
      await db.tenant.update({ where: { id }, data: { portalEnabled: true, portalInvitedAt: new Date(), clerkUserId: user.id } });
      revalidatePath(`/tenants/${id}`);
      return { ok: true, message: `${email} already has an account, so access is turned on. They can sign in now at ${await appOrigin()}/sign-in.` };
    }

    // Revoke any older pending invite so only the newest link works.
    const pending = await clerk.invitations.getInvitationList({ status: "pending", query: email });
    for (const inv of pending.data) if (inv.emailAddress.toLowerCase() === email) await clerk.invitations.revokeInvitation(inv.id);

    await clerk.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { tenantId: id },
      redirectUrl: `${await appOrigin()}/sign-up`,
      notify: true, // Clerk sends the invitation email
      expiresInDays: 14,
    });
    await db.tenant.update({ where: { id }, data: { portalEnabled: true, portalInvitedAt: new Date(), clerkUserId: null } });
    revalidatePath(`/tenants/${id}`);
    return { ok: true, message: `Invitation emailed to ${email}. The link is good for 14 days.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeTenantPortal(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id } });
    // Turn off access in our database first: this alone blocks the portal immediately.
    await db.tenant.update({ where: { id }, data: { portalEnabled: false, clerkUserId: null } });

    const clerk = await clerkClient();
    if (tenant.clerkUserId) {
      await clerk.users.updateUserMetadata(tenant.clerkUserId, { publicMetadata: { tenantId: null } }).catch(() => undefined);
    }
    if (tenant.email) {
      const pending = await clerk.invitations.getInvitationList({ status: "pending", query: tenant.email });
      for (const inv of pending.data) if (inv.emailAddress.toLowerCase() === tenant.email.toLowerCase()) await clerk.invitations.revokeInvitation(inv.id);
    }
    revalidatePath(`/tenants/${id}`);
    return { ok: true, message: "Portal access turned off." };
  } catch (e) {
    return toActionError(e);
  }
}
