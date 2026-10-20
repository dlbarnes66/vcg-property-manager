"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, optStr, reqMoney, reqStr } from "@/lib/form";
import { appOrigin } from "@/lib/portal";
import { payableNow, portalLease } from "@/lib/portal-data";
import { allowCards, stripe, stripeEnabled } from "@/lib/stripe";
import { putObject } from "@/lib/storage";
import { money } from "@/lib/utils";

// Every portal action derives the tenant and lease from the signed-in account.
// Nothing about which lease or unit is ever taken from the form.

export async function startRentPayment(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { tenant } = await requireTenant();
    if (!stripeEnabled()) throw new Error("Online payments aren't available yet. Please pay your property manager directly.");
    const lease = await portalLease(tenant.id);
    if (!lease) throw new Error("We couldn't find your lease. Please contact your property manager.");

    const amount = reqMoney(fd, "amount", "Amount");
    if (amount < 100) throw new Error("The minimum online payment is $1.00.");
    const { payable } = payableNow(lease);
    if (payable <= 0) throw new Error("You don't have a balance due right now.");
    if (amount > payable) throw new Error(`You can pay up to ${money(payable)} right now.`);

    const s = stripe();
    // Close any checkout this lease left open so two can't both be paid.
    for (const op of lease.onlinePayments.filter((p) => p.status === "PENDING")) {
      await s.checkout.sessions.expire(op.checkoutSessionId).catch(() => undefined);
      await db.onlinePayment.update({ where: { id: op.id }, data: { status: "EXPIRED" } });
    }

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const c = await s.customers.create({
        name: `${tenant.firstName} ${tenant.lastName}`,
        email: tenant.email ?? undefined,
        metadata: { tenantId: tenant.id },
      });
      customerId = c.id;
      await db.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
    }

    const origin = await appOrigin();
    const label = `Rent — ${lease.unit.property.name}, ${lease.unit.label}`;
    const session = await s.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: allowCards() ? ["us_bank_account", "card"] : ["us_bank_account"],
      payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] } } },
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name: label } } }],
      metadata: { leaseId: lease.id, tenantId: tenant.id },
      payment_intent_data: { description: label, metadata: { leaseId: lease.id, tenantId: tenant.id } },
      success_url: `${origin}/portal/pay/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/portal`,
    });
    if (!session.url) throw new Error("Stripe didn't return a checkout link. Please try again.");

    await db.onlinePayment.create({ data: { leaseId: lease.id, tenantId: tenant.id, amount, checkoutSessionId: session.id } });
    redirect(session.url);
  } catch (e) {
    return toActionError(e);
  }
}

const PHOTO_TYPES = /^image\/(png|jpe?g|webp|heic|heif)$/;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export async function submitMaintenanceRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { tenant } = await requireTenant();
    const lease = await db.lease.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { startDate: "desc" } });
    if (!lease) throw new Error("You need an active lease to submit a request. Please contact your property manager.");

    const open = await db.maintenanceRequest.count({
      where: { submittedByTenantId: tenant.id, status: { in: ["OPEN", "SCHEDULED", "IN_PROGRESS"] } },
    });
    if (open >= 10) throw new Error("You have 10 open requests. Please wait for some to be completed, or call your property manager.");

    const area = optStr(fd, "area");
    const title = reqStr(fd, "title", "What needs fixing").slice(0, 120);
    const emergency = bool(fd, "emergency");

    const photos = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length > MAX_PHOTOS) throw new Error(`Please attach up to ${MAX_PHOTOS} photos.`);
    for (const p of photos) {
      if (!PHOTO_TYPES.test(p.type)) throw new Error(`${p.name} isn't a photo (JPG, PNG, WebP, or HEIC).`);
      if (p.size > MAX_PHOTO_BYTES) throw new Error(`${p.name} is larger than 10 MB.`);
    }

    const wo = await db.maintenanceRequest.create({
      data: {
        unitId: lease.unitId,
        title: area ? `${area}: ${title}` : title,
        description: optStr(fd, "description")?.slice(0, 4000),
        priority: emergency ? "EMERGENCY" : "NORMAL",
        status: "OPEN",
        permissionToEnter: bool(fd, "permissionToEnter"),
        submittedByTenantId: tenant.id,
      },
    });

    for (const p of photos) {
      const safeName = p.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
      const storageKey = `docs/${randomUUID()}/${safeName}`;
      await putObject(storageKey, Buffer.from(await p.arrayBuffer()), p.type);
      await db.document.create({
        data: {
          name: p.name, category: "PHOTO", storageKey, mimeType: p.type, size: p.size,
          maintenanceId: wo.id, unitId: lease.unitId, sharedWithTenant: true, uploadedByTenant: true,
        },
      });
    }

    revalidatePath("/portal/maintenance");
    return {
      ok: true,
      message: emergency
        ? "Emergency request sent. If anyone is in danger, or you smell gas, call 911 first."
        : "Request sent. We'll update the status here as we schedule it.",
    };
  } catch (e) {
    return toActionError(e);
  }
}
