import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Tenant } from "@prisma/client";
import { db } from "./db";

/**
 * Two kinds of people sign in through the same Clerk app:
 *  - ADMIN: verified email is listed in ALLOWED_EMAILS. Sees everything.
 *  - TENANT: invited from a tenant's page. The invite stamps Clerk publicMetadata.tenantId
 *    (only the server can write publicMetadata), and the account's verified email must match
 *    the tenant's email on file. A tenant only ever sees their own records.
 * Anyone else is turned away. If ALLOWED_EMAILS is empty, nobody is an admin.
 */
export type Viewer =
  | { kind: "admin"; userId: string; email: string }
  | { kind: "tenant"; userId: string; tenant: Tenant }
  | { kind: "none"; userId: string | null };

export function adminEmails() {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email: string) => adminEmails().includes(email.trim().toLowerCase());

/** Resolved once per request. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const { userId } = await auth();
  if (!userId) return { kind: "none", userId: null };

  const user = await currentUser();
  const verified = (user?.emailAddresses ?? [])
    .filter((e) => e.verification?.status === "verified")
    .map((e) => e.emailAddress.toLowerCase());

  const admins = adminEmails();
  const adminEmail = verified.find((e) => admins.includes(e));
  if (adminEmail) return { kind: "admin", userId, email: adminEmail };

  const metaTenantId = typeof user?.publicMetadata?.tenantId === "string" ? user.publicMetadata.tenantId : null;
  const tenant = metaTenantId
    ? await db.tenant.findUnique({ where: { id: metaTenantId } })
    : await db.tenant.findUnique({ where: { clerkUserId: userId } });

  if (!tenant || !tenant.portalEnabled) return { kind: "none", userId };
  if (!tenant.email || !verified.includes(tenant.email.toLowerCase())) return { kind: "none", userId };
  if (tenant.clerkUserId && tenant.clerkUserId !== userId) return { kind: "none", userId };

  if (!tenant.clerkUserId) {
    // First portal sign-in: bind this Clerk account to the tenant (only if still unbound).
    const res = await db.tenant.updateMany({ where: { id: tenant.id, clerkUserId: null }, data: { clerkUserId: userId } });
    if (res.count === 0) {
      const fresh = await db.tenant.findUnique({ where: { id: tenant.id } });
      if (fresh?.clerkUserId !== userId) return { kind: "none", userId };
    }
    tenant.clerkUserId = userId;
  }
  return { kind: "tenant", userId, tenant };
});

/** Admin pages and admin server actions. Tenants are sent to their portal. Returns the Clerk user id. */
export async function requireAccess(): Promise<string> {
  const v = await getViewer();
  if (v.kind === "admin") return v.userId;
  if (v.kind === "tenant") redirect("/portal");
  if (!v.userId) redirect("/sign-in");
  redirect("/not-authorized");
}

/** Tenant portal pages and portal server actions. */
export async function requireTenant(): Promise<{ userId: string; tenant: Tenant }> {
  const v = await getViewer();
  if (v.kind === "tenant") return { userId: v.userId, tenant: v.tenant };
  if (v.kind === "admin") redirect("/");
  if (!v.userId) redirect("/sign-in");
  redirect("/not-authorized");
}

/** Like requireAccess, but also returns the admin's email (for "created by" / "sent by"). */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const v = await getViewer();
  if (v.kind === "admin") return { userId: v.userId, email: v.email };
  if (v.kind === "tenant") redirect("/portal");
  if (!v.userId) redirect("/sign-in");
  redirect("/not-authorized");
}
