"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optDate, optMoney, optStr, reqMoney, reqStr } from "@/lib/form";
import { convertApplicationToTenant, newListingSlug } from "@/lib/leasing";
import { deleteObject } from "@/lib/storage";

const refresh = () => {
  revalidatePath("/leasing", "layout");
  revalidatePath("/rentals");
};

function listingFields(fd: FormData) {
  return {
    headline: reqStr(fd, "headline", "Headline").slice(0, 120),
    description: optStr(fd, "description")?.slice(0, 5000) ?? null,
    rent: reqMoney(fd, "rent", "Rent"),
    deposit: optMoney(fd, "deposit", "Deposit") ?? 0,
    availableDate: optDate(fd, "availableDate"),
    acceptsVouchers: bool(fd, "acceptsVouchers"),
    petPolicy: optStr(fd, "petPolicy"),
    utilitiesIncluded: optStr(fd, "utilitiesIncluded"),
  };
}

export async function createListing(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const unitId = reqStr(fd, "unitId", "Unit");
    const open = await db.listing.findFirst({ where: { unitId, status: { not: "CLOSED" } } });
    if (open) throw new Error("This unit already has an open listing");
    const l = await db.listing.create({ data: { ...listingFields(fd), unitId, slug: newListingSlug() } });
    refresh();
    redirect(`/leasing/listings/${l.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateListing(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.listing.update({ where: { id }, data: listingFields(fd) });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setListingStatus(id: string, status: "DRAFT" | "PUBLISHED" | "CLOSED", _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.listing.update({ where: { id }, data: { status, ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}) } });
    refresh();
    return { ok: true, message: status === "PUBLISHED" ? "Published. It's live on your rentals page." : status === "CLOSED" ? "Closed" : "Unpublished" };
  } catch (e) {
    return toActionError(e);
  }
}

const SCREEN = ["idVerified", "incomeVerified", "voucherVerified", "referenceChecked", "backgroundReviewed"] as const;

export async function saveScreening(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const app = await db.application.findUniqueOrThrow({ where: { id } });
    await db.application.update({
      where: { id },
      data: { ...Object.fromEntries(SCREEN.map((k) => [k, bool(fd, k)])), screeningNotes: optStr(fd, "screeningNotes"), ...(app.status === "NEW" ? { status: "SCREENING" } : {}) },
    });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function decideApplication(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const decision = oneOf(fd, "decision", ["APPROVED", "DENIED", "WITHDRAWN", "SCREENING"] as const);
    const reason = optStr(fd, "decisionReason");
    if (decision === "DENIED" && !reason) throw new Error("Record the reason for the denial (keep it tied to your written screening criteria).");
    const app = await db.application.findUniqueOrThrow({ where: { id } });
    if (app.status === "CONVERTED") throw new Error("This applicant is already a tenant");
    await db.application.update({
      where: { id },
      data: { status: decision, decisionReason: reason, ...(decision === "SCREENING" ? { decidedAt: null, decidedByEmail: null } : { decidedAt: new Date(), decidedByEmail: email }) },
    });
    refresh();
    return { ok: true, message: decision === "APPROVED" ? "Approved. Next: create the tenant and lease." : "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function convertToTenant(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const { tenantId, listing } = await convertApplicationToTenant(id);
    refresh();
    revalidatePath("/tenants");
    const q = new URLSearchParams({ unitId: listing.unitId, tenantId, contractRent: (listing.rent / 100).toFixed(2), deposit: (listing.deposit / 100).toFixed(2) });
    redirect(`/leases/new?${q}`);
  } catch (e) {
    return toActionError(e);
  }
}

/** Removes an application and its uploaded files (e.g. after your retention period). */
export async function deleteApplication(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const app = await db.application.findUniqueOrThrow({ where: { id }, include: { documents: true } });
    if (app.status === "CONVERTED") throw new Error("This applicant became a tenant; their files now live on the tenant record.");
    for (const d of app.documents) await deleteObject(d.storageKey).catch(() => undefined);
    await db.document.deleteMany({ where: { applicationId: id } });
    await db.application.delete({ where: { id } });
    refresh();
    redirect("/leasing?tab=applications");
  } catch (e) {
    return toActionError(e);
  }
}
