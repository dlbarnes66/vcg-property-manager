import { randomBytes } from "crypto";
import { db } from "./db";
import { isEmail, toE164 } from "./messaging-core";
import { addDays, todayUTC } from "./utils";

export const newListingSlug = () => randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "x");

export type ApplicationInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  isVeteran: boolean | null;
  householdSize: number;
  desiredMoveIn: Date | null;
  currentAddress: string | null;
  currentLandlord: string | null;
  currentLandlordPhone: string | null;
  monthlyIncome: number | null;
  incomeSource: string | null;
  employer: string | null;
  hasVoucher: boolean;
  voucherType: string | null;
  housingAuthorityName: string | null;
  caseManagerName: string | null;
  caseManagerPhone: string | null;
  caseManagerEmail: string | null;
  pets: string | null;
  additionalInfo: string | null;
  consent: boolean;
  website?: string | null; // honeypot: real people never fill this in
};

export class ApplicationError extends Error {}

/**
 * Validates and saves a public application. Applies basic abuse limits and creates a review task.
 * Returns null (silently) for bot submissions so they don't learn they were caught.
 */
export async function submitApplication(slug: string, input: ApplicationInput) {
  const listing = await db.listing.findUnique({ where: { slug }, include: { unit: { include: { property: true } } } });
  if (!listing || listing.status !== "PUBLISHED") throw new ApplicationError("This rental is no longer accepting applications.");
  if (input.website) return null;

  const req = (v: string, label: string) => {
    if (!v.trim()) throw new ApplicationError(`${label} is required`);
    return v.trim().slice(0, 200);
  };
  const firstName = req(input.firstName, "First name");
  const lastName = req(input.lastName, "Last name");
  const email = req(input.email, "Email").toLowerCase();
  if (!isEmail(email)) throw new ApplicationError("Please enter a valid email address");
  const phone = req(input.phone, "Phone");
  if (!toE164(phone)) throw new ApplicationError("Please enter a valid phone number");
  if (!input.consent) throw new ApplicationError("Please confirm the information is accurate and may be verified");
  if (!Number.isInteger(input.householdSize) || input.householdSize < 1 || input.householdSize > 20) throw new ApplicationError("Household size should be between 1 and 20");
  if (input.caseManagerEmail && !isEmail(input.caseManagerEmail)) throw new ApplicationError("Case manager email doesn't look valid");

  const recent = await db.application.count({ where: { listingId: listing.id, email, createdAt: { gt: addDays(new Date(), -1) } } });
  if (recent >= 3) throw new ApplicationError("We've already received your application for this home. We'll be in touch.");

  const clip = (s: string | null, n = 2000) => (s ? s.trim().slice(0, n) || null : null);
  const app = await db.application.create({
    data: {
      listingId: listing.id, firstName, lastName, email, phone,
      isVeteran: input.isVeteran, householdSize: input.householdSize, desiredMoveIn: input.desiredMoveIn,
      currentAddress: clip(input.currentAddress, 300), currentLandlord: clip(input.currentLandlord, 200), currentLandlordPhone: clip(input.currentLandlordPhone, 40),
      monthlyIncome: input.monthlyIncome, incomeSource: clip(input.incomeSource, 200), employer: clip(input.employer, 200),
      hasVoucher: input.hasVoucher, voucherType: input.hasVoucher ? clip(input.voucherType, 60) : null, housingAuthorityName: input.hasVoucher ? clip(input.housingAuthorityName, 200) : null,
      caseManagerName: clip(input.caseManagerName, 200), caseManagerPhone: clip(input.caseManagerPhone, 40), caseManagerEmail: clip(input.caseManagerEmail, 200),
      pets: clip(input.pets, 500), additionalInfo: clip(input.additionalInfo, 4000), consentAt: new Date(),
    },
  });

  await db.task.create({
    data: {
      title: `Review rental application: ${firstName} ${lastName}`,
      description: `${listing.unit.property.name} · ${listing.unit.label}. Open Leasing → Applications.`,
      priority: "HIGH", dueDate: addDays(todayUTC(), 2), unitId: listing.unitId, propertyId: listing.unit.propertyId,
    },
  });
  return { application: app, listing };
}

/**
 * Turns an approved application into a tenant record (case manager included) and closes the
 * listing. The lease itself is created next, from the lease form, so you confirm the rent split.
 */
export async function convertApplicationToTenant(applicationId: string) {
  return db.$transaction(async (tx) => {
    const app = await tx.application.findUniqueOrThrow({ where: { id: applicationId }, include: { listing: true } });
    if (app.status === "CONVERTED" && app.tenantId) return { tenantId: app.tenantId, listing: app.listing, created: false };
    if (app.status !== "APPROVED") throw new Error("Approve the application first");
    const tenant = await tx.tenant.create({
      data: {
        firstName: app.firstName, lastName: app.lastName, email: app.email, phone: app.phone, isVeteran: app.isVeteran ?? false,
        caseManagerName: app.caseManagerName, caseManagerPhone: app.caseManagerPhone, caseManagerEmail: app.caseManagerEmail,
        notes: [app.hasVoucher ? `Voucher: ${app.voucherType ?? "yes"}${app.housingAuthorityName ? ` (${app.housingAuthorityName})` : ""}` : null, app.pets ? `Pets: ${app.pets}` : null]
          .filter(Boolean).join("\n") || null,
      },
    });
    await tx.application.update({ where: { id: app.id }, data: { status: "CONVERTED", tenantId: tenant.id } });
    await tx.document.updateMany({ where: { applicationId: app.id }, data: { tenantId: tenant.id } });
    await tx.listing.update({ where: { id: app.listingId }, data: { status: "CLOSED" } });
    return { tenantId: tenant.id, listing: app.listing, created: true };
  });
}
