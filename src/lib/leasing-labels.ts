import type { ApplicationStatus } from "@prisma/client";

export const appTone = (s: ApplicationStatus) =>
  ({ NEW: "blue", SCREENING: "amber", APPROVED: "green", DENIED: "red", WITHDRAWN: "gray", CONVERTED: "navy" })[s] as "blue" | "amber" | "green" | "red" | "gray" | "navy";
export const appLabel: Record<ApplicationStatus, string> = { NEW: "New", SCREENING: "Screening", APPROVED: "Approved", DENIED: "Denied", WITHDRAWN: "Withdrawn", CONVERTED: "Tenant" };
