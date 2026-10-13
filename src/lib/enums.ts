// Mirrors the Prisma enums, usable in client and server components without importing @prisma/client.
export const PROPERTY_TYPES = ["MULTIFAMILY", "SINGLE_FAMILY", "DUPLEX", "OTHER"] as const;
export const LEASE_STATUSES = ["DRAFT", "ACTIVE", "ENDED"] as const;
export const PARTIES = ["TENANT", "HOUSING_AUTHORITY"] as const;
export const CHARGE_TYPES = ["RENT", "LATE_FEE", "SECURITY_DEPOSIT", "UTILITY", "DAMAGE", "OTHER"] as const;
export const PAYMENT_METHODS = ["ACH", "CHECK", "CASH", "CARD", "MONEY_ORDER", "OTHER"] as const;
export const MAINT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "EMERGENCY"] as const;
export const MAINT_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export const INSPECTION_TYPES = ["HQS_INITIAL", "HQS_ANNUAL", "NSPIRE", "REINSPECTION", "MOVE_IN", "MOVE_OUT", "INTERNAL"] as const;
export const INSPECTION_RESULTS = ["PENDING", "PASS", "FAIL", "INCONCLUSIVE"] as const;
export const DOC_CATEGORIES = ["LEASE", "HAP_CONTRACT", "INSPECTION", "RECEIPT", "PHOTO", "ID", "NOTICE", "OTHER"] as const;
