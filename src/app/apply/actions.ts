"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { ApplicationError, submitApplication } from "@/lib/leasing";
import { sendEmail, emailConfigured } from "@/lib/messaging-providers";
import { putObject } from "@/lib/storage";
import { str, toCents, toDate } from "@/lib/utils";
import { appOrigin } from "@/lib/portal";

const FILE_TYPES = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/;

// Public (no sign-in). Everything is validated in submitApplication.
export async function applyForListing(slug: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const s = (k: string) => str(fd.get(k));
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 5) throw new ApplicationError("Please attach up to 5 files");
    for (const f of files) {
      if (!FILE_TYPES.test(f.type)) throw new ApplicationError(`${f.name}: please upload PDFs or photos`);
      if (f.size > 10 * 1024 * 1024) throw new ApplicationError(`${f.name} is larger than 10 MB`);
    }
    let income: number | null = null;
    let moveIn: Date | null = null;
    try {
      income = toCents(fd.get("monthlyIncome"));
      moveIn = toDate(fd.get("desiredMoveIn"));
    } catch {
      throw new ApplicationError("Please check the income and move-in date fields");
    }
    const veteran = s("isVeteran");

    const result = await submitApplication(slug, {
      firstName: s("firstName") ?? "", lastName: s("lastName") ?? "", email: s("email") ?? "", phone: s("phone") ?? "",
      isVeteran: veteran === "yes" ? true : veteran === "no" ? false : null,
      householdSize: Number(s("householdSize") ?? "1"), desiredMoveIn: moveIn,
      currentAddress: s("currentAddress"), currentLandlord: s("currentLandlord"), currentLandlordPhone: s("currentLandlordPhone"),
      monthlyIncome: income, incomeSource: s("incomeSource"), employer: s("employer"),
      hasVoucher: s("hasVoucher") === "yes", voucherType: s("voucherType"), housingAuthorityName: s("housingAuthorityName"),
      caseManagerName: s("caseManagerName"), caseManagerPhone: s("caseManagerPhone"), caseManagerEmail: s("caseManagerEmail"),
      pets: s("pets"), additionalInfo: s("additionalInfo"), consent: fd.get("consent") === "on", website: s("website"),
    });

    if (result) {
      const { application: app, listing } = result;
      for (const f of files) {
        const key = `applications/${app.id}/${randomUUID()}-${f.name.replace(/[^\w.\- ]+/g, "_").slice(-100)}`;
        await putObject(key, Buffer.from(await f.arrayBuffer()), f.type);
        await db.document.create({ data: { name: f.name, category: "OTHER", storageKey: key, mimeType: f.type, size: f.size, applicationId: app.id } });
      }
      const notify = process.env.MANAGER_EMAIL;
      if (notify && emailConfigured()) {
        await sendEmail({
          to: notify,
          subject: `New rental application: ${app.firstName} ${app.lastName} for ${listing.unit.property.name} ${listing.unit.label}`,
          text: `${app.firstName} ${app.lastName} applied for ${listing.unit.property.name}, ${listing.unit.label}.\n\nReview it: ${await appOrigin()}/leasing/applications/${app.id}`,
          messageId: app.id,
        }).catch(() => undefined);
      }
    }
    redirect(`/apply/${slug}/thanks`);
  } catch (e) {
    if (e instanceof ApplicationError) return { error: e.message };
    const r = toActionError(e); // re-throws the redirect
    return r?.error ? { error: "Something went wrong submitting your application. Please try again." } : r;
  }
}
