import type { DocumentCategory, FormCategory } from "@prisma/client";

/**
 * The forms the AI can draft. `needs` decides which records the form is about (and which facts
 * get filled in); `guidance` is what the drafter is told about this specific form.
 */
export type FormNeeds = "lease" | "tenant" | "property" | "vendor" | "none";
export type FormType = {
  key: string;
  title: string;
  category: FormCategory;
  description: string;
  needs: FormNeeds;
  signatures: boolean;
  /** Eviction-related or otherwise high stakes: stronger "have a lawyer look" warning in the UI. */
  highStakes?: boolean;
  guidance: string;
};

export const CATEGORY_LABEL: Record<FormCategory, string> = {
  LEASE: "Leases",
  ADDENDUM: "Addenda",
  NOTICE: "Notices",
  MOVE: "Move-in / move-out",
  VENDOR: "Vendor & business",
  OTHER: "Other",
};
export const CATEGORY_ORDER: FormCategory[] = ["LEASE", "ADDENDUM", "NOTICE", "MOVE", "VENDOR", "OTHER"];

/** Where a finished PDF is filed in Documents. */
export const DOC_CATEGORY: Record<FormCategory, DocumentCategory> = {
  LEASE: "LEASE", ADDENDUM: "LEASE", NOTICE: "NOTICE", MOVE: "INSPECTION", VENDOR: "OTHER", OTHER: "OTHER",
};

export const FORM_TYPES: FormType[] = [
  /* ---------- Leases ---------- */
  {
    key: "residential-lease", title: "Residential lease agreement", category: "LEASE", needs: "lease", signatures: true, highStakes: true,
    description: "A complete residential lease for the unit, written for the property's state.",
    guidance:
      "A complete residential lease. Sections: parties; premises; term (fixed, and what happens at the end); rent (amount, due day, where/how to pay, grace period, late fee only if lawful in the state and within any cap); security deposit (amount, where held if the state requires disclosure, return deadline and itemization per state law); utilities; occupancy and guests; use; maintenance and repairs (landlord and tenant duties, how to request repairs, emergency contact); landlord entry (notice required by the state); alterations; pets (refer to a pet addendum if any); smoking; renters insurance (recommended, not required unless lawful); assignment and subletting; default and remedies (only lawful court process; no self-help); abandonment; move-out and inspection; notices (addresses); required state and federal disclosures (lead-based paint for pre-1978 housing; any state-required disclosures such as mold, radon, flood, deposit location, owner/agent identity); fair housing statement; reasonable accommodation statement; entire agreement and severability; signatures. If the lease has a housing authority / HAP portion, include the rent split and a section stating the HUD Tenancy Addendum is part of the lease, prevails over anything that conflicts, and is attached unchanged.",
  },
  {
    key: "month-to-month", title: "Month-to-month rental agreement", category: "LEASE", needs: "lease", signatures: true, highStakes: true,
    description: "A periodic (month-to-month) tenancy with the state's termination notice rules.",
    guidance: "Same coverage as a residential lease, but a month-to-month tenancy. State the notice either side must give to end it and to change rent, per the state's rules.",
  },
  {
    key: "lease-renewal", title: "Lease renewal / extension", category: "LEASE", needs: "lease", signatures: true,
    description: "Extends the current lease with a new end date and any changed terms.",
    guidance: "A short agreement extending the existing lease to a new end date. Restate rent and the tenant/HAP split. Say all other terms remain the same. Leave the new end date and any new rent as blanks if not provided.",
  },
  /* ---------- Addenda ---------- */
  {
    key: "voucher-addendum", title: "Voucher (HUD-VASH / HCV) lease addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "Owner's addendum for voucher leases: rent split, housing authority, and how the HUD Tenancy Addendum fits in.",
    guidance:
      "An owner's addendum for a Housing Choice Voucher / HUD-VASH lease. Cover: housing authority name; contract rent; tenant portion and HAP amount; that the tenant is responsible only for the tenant portion and the owner may not charge the tenant for any HAP the housing authority fails to pay; rent changes only as allowed by the HAP contract and with housing authority notice; the HUD Tenancy Addendum (form HUD-52641-A) is attached unchanged and controls over any conflicting term; annual recertification and inspections cooperation; that nothing in the lease waives program rights. Do not reproduce the HUD Tenancy Addendum text.",
  },
  {
    key: "pet-addendum", title: "Pet addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "Pet rules, deposit/fee where lawful, and the assistance-animal exception.",
    guidance: "Pet description fields (blanks), rules, liability, waste, noise, any pet deposit or fee only if lawful in the state. State clearly that assistance animals (service and support animals) are not pets and no pet deposit, fee, or pet rent applies to them.",
  },
  {
    key: "lead-paint", title: "Lead-based paint disclosure (pre-1978)", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "The federally required disclosure for housing built before 1978.",
    guidance:
      "The federal lessor's disclosure of information on lead-based paint and lead-based paint hazards (40 CFR 745.113). Include the required Lead Warning Statement for leases, the lessor's disclosure (check boxes for known / no knowledge, records available / none), lessee's acknowledgment (received the pamphlet 'Protect Your Family From Lead in Your Home'), agent's acknowledgment, and certification of accuracy with signatures and dates. Use check boxes written as [ ].",
  },
  {
    key: "mold-addendum", title: "Mold & moisture addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "Mold prevention duties and reporting, plus any state-required disclosure.",
    guidance: "Tenant duties to ventilate and report leaks/moisture promptly, landlord duty to repair, and any mold disclosure the state requires.",
  },
  {
    key: "smoke-free", title: "Smoke-free addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "No smoking or vaping in the unit and common areas.",
    guidance: "Define smoking (including vaping and marijuana), where it is prohibited, and the consequence (lease violation with notice and opportunity to cure as required by state law).",
  },
  {
    key: "utilities-addendum", title: "Utilities addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "Which utilities the tenant pays vs. the landlord, and how billing works.",
    guidance: "A table of utilities (electric, gas, water, sewer, trash, internet) with who pays each, account set-up timing, and that utilities may not be shut off as a remedy. For voucher leases, note the utility allowance is set by the housing authority.",
  },
  {
    key: "parking-addendum", title: "Parking & vehicle addendum", category: "ADDENDUM", needs: "lease", signatures: true,
    description: "Assigned spaces, vehicle info, and towing rules.",
    guidance: "Vehicle description blanks, assigned space, prohibited vehicles/repairs, and towing only as allowed by state and local law with any required signage/notice.",
  },
  /* ---------- Notices ---------- */
  {
    key: "late-rent-reminder", title: "Late rent reminder (friendly)", category: "NOTICE", needs: "lease", signatures: false,
    description: "A courteous reminder before any formal notice.",
    guidance: "A short, respectful letter: rent is past due, the amount (tenant portion only), how to pay, an offer to talk or set up a plan, and the VA case manager can help if relevant. Not a legal demand.",
  },
  {
    key: "pay-or-quit", title: "Notice to pay rent or quit", category: "NOTICE", needs: "lease", signatures: true, highStakes: true,
    description: "The formal demand that starts the state's nonpayment process.",
    guidance:
      "The formal notice for nonpayment of rent in this state, with the state's required notice period, required content, and service method. Demand only the tenant portion of unpaid rent (never HAP the housing authority owes), and list late fees separately only if the state allows them in this notice. Include the date of service and a certificate of service section. For voucher tenancies, note that a copy must be sent to the housing authority. Use the state's terminology for this notice.",
  },
  {
    key: "lease-violation", title: "Notice of lease violation / cure", category: "NOTICE", needs: "lease", signatures: true, highStakes: true,
    description: "Describes a violation and the time to fix it, per state rules.",
    guidance: "Identify the lease section violated (blank), describe the violation (blank), the cure period required by the state, and what happens if not cured (only lawful court process). Include certificate of service. Voucher tenancies: copy to the housing authority.",
  },
  {
    key: "entry-notice", title: "Notice of intent to enter", category: "NOTICE", needs: "lease", signatures: false,
    description: "Advance notice of a repair, inspection, or showing.",
    guidance: "Date/time window (blanks), purpose, the advance notice the state requires (or 24 hours if the state sets none), and contact info.",
  },
  {
    key: "non-renewal", title: "Notice of non-renewal", category: "NOTICE", needs: "lease", signatures: true, highStakes: true,
    description: "Landlord's notice that the lease won't be renewed.",
    guidance: "Lease end date, move-out date, the notice period required by state law and the lease, move-out expectations and deposit return process. For voucher tenancies, note any housing authority notice requirement and that owners generally need good cause during the initial term.",
  },
  {
    key: "rent-change", title: "Notice of rent change", category: "NOTICE", needs: "lease", signatures: true,
    description: "Advance notice of a rent increase or decrease.",
    guidance: "Current rent, new rent (blank if not given), effective date, the advance notice the state and lease require. For voucher tenancies: rent changes require housing authority approval and notice to the housing authority before the effective date; the tenant portion is set by the housing authority.",
  },
  {
    key: "tenant-move-out-notice", title: "Notice to vacate (tenant's notice form)", category: "NOTICE", needs: "lease", signatures: true,
    description: "A form tenants can fill in to give notice they're moving out.",
    guidance: "Fields for the tenant: move-out date, forwarding address, reason (optional), signature. State the notice period the lease requires.",
  },
  /* ---------- Move-in / move-out ---------- */
  {
    key: "move-in-checklist", title: "Move-in inspection checklist", category: "MOVE", needs: "lease", signatures: true,
    description: "Room-by-room condition report signed at move-in.",
    guidance: "A room-by-room checklist as Markdown tables with columns: Item | Condition at move-in | Notes. Rooms: entry, living room, kitchen (appliances listed), each bedroom (use the unit's bedroom count), bathroom(s), laundry, exterior/patio, smoke and CO detectors (tested Y/N). Include meter readings and keys issued, and any state requirement to give the tenant a copy.",
  },
  {
    key: "move-out-checklist", title: "Move-out inspection checklist", category: "MOVE", needs: "lease", signatures: true,
    description: "Room-by-room comparison with move-in, for the deposit.",
    guidance: "Same rooms as the move-in checklist, as tables with columns: Item | Condition at move-in | Condition at move-out | Charge (if any). Distinguish normal wear and tear from damage.",
  },
  {
    key: "deposit-itemization", title: "Security deposit itemization", category: "MOVE", needs: "lease", signatures: true,
    description: "Itemized deductions and refund, within the state's deadline.",
    guidance: "Deposit held, a table of deductions (description | amount), unpaid rent (tenant portion only), the refund due or balance owed, forwarding address, the state's deadline to send this and how it is delivered.",
  },
  {
    key: "move-out-instructions", title: "Move-out instructions letter", category: "MOVE", needs: "lease", signatures: false,
    description: "What to do before the move-out inspection.",
    guidance: "Friendly checklist: cleaning, keys, utilities, forwarding address, scheduling the walk-through, and how and when the deposit will be returned under state law.",
  },
  /* ---------- Vendor & business ---------- */
  {
    key: "vendor-agreement", title: "Vendor / contractor service agreement", category: "VENDOR", needs: "vendor", signatures: true,
    description: "Scope, pricing, insurance, and access rules for a contractor.",
    guidance: "Independent contractor agreement: scope (blank), pricing and invoicing, insurance (general liability, workers comp as required by the state) with certificate, licensing, permits, tenant privacy and entry rules (owner gives notice; vendor doesn't enter without it), safety, warranty, indemnity, termination, W-9 requirement.",
  },
  {
    key: "w9-request", title: "W-9 request letter", category: "VENDOR", needs: "vendor", signatures: false,
    description: "Asks a vendor for a completed IRS Form W-9.",
    guidance: "Short letter asking for a completed IRS Form W-9 before payment, how to send it securely (don't email SSNs unencrypted), and why it's needed (1099 reporting).",
  },
  {
    key: "management-agreement", title: "Property management agreement", category: "VENDOR", needs: "property", signatures: true, highStakes: true,
    description: "Owner and property manager responsibilities, fees, and authority.",
    guidance: "Agreement between the owner entity and a property manager: services, authority and spending limits, trust/escrow accounts per state real estate law, fees (blanks), reporting, licensing required by the state, fair housing compliance, HUD program compliance for voucher units, insurance, term and termination.",
  },
];

export const formType = (key: string) => FORM_TYPES.find((f) => f.key === key) ?? null;
