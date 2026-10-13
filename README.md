# VCG Property Manager

A "DoorLoop Lite" for VCG Veterans Housing Fund I: properties, units, tenants, leases, rent, maintenance, inspections, documents, and reports, built around how **HUD-VASH** rent actually works.

**Stack:** Next.js 15 (App Router, server actions) · TypeScript · Tailwind v4 · Prisma · PostgreSQL · Clerk · Cloudflare R2 (optional)

---

## What's different from a generic landlord app

| HUD-VASH reality | How the app handles it |
|---|---|
| Rent comes from two payers | Every lease splits **contract rent = tenant portion + HAP**. Each month posts two charges, and the tenant and housing authority have **separate balances**. A HAP payment never "covers" a tenant's debt, and vice versa. |
| Late fees only apply to the tenant | Late fees are charged on the tenant portion only, never to the PHA. |
| HAP is abated when a unit fails inspection | The Inspections module tracks HQS/NSPIRE results and cure-by dates. Recording a failure can auto-schedule the re-inspection and open a work order. Open failures show on the dashboard. |
| Annual recertification changes the split | Each lease has a next-recert date; recerts due within 60 days surface on the dashboard. After the new rent letter, edit the lease's tenant/HAP amounts; future charges use the new split. |
| VA case managers are part of the team | Tenant records store the HUD-VASH case manager's contact info. |

## Modules

- **Dashboard**: occupancy, this month's collections, tenant vs HAP past due, failed inspections, emergency work orders, upcoming inspections/recerts/lease ends, and a banner if this month's rent hasn't been posted.
- **Properties & units**: quick-create N units; occupancy and rent per property.
- **Tenants**: veteran flag, case manager, emergency contact, lease history with balances.
- **Leases**: rent split (HAP auto-fills), voucher #, PHA, deposit, late fee + grace days. The lease page has a full ledger with a running balance per party, record payment, add charge, and end lease.
- **Rent & payments**: monthly **rent run** (safe to click twice), **apply late fees**, and month-by-month collections.
- **Maintenance**: work orders with priority, status, vendor, cost, and photos.
- **Inspections**: HQS initial/annual, NSPIRE, re-inspections, move-in/out.
- **Documents**: upload to any property, tenant, lease, or work order; library view with filters.
- **Reports**: rent roll, delinquency aging (0–30 / 31–60 / 61–90 / 90+, split by payer), 12-month cash flow. Each exports to CSV.
- **Directory**: housing authorities (with HAP per month and HAP past due per PHA) and vendors.

All money is stored as integer cents. Dates are stored as UTC midnight so they never shift by a day.

---

## Run it locally (Mac)

**1. Prerequisites:** Node 20+ and Postgres. Easiest Postgres options:
- `brew install postgresql@16 && brew services start postgresql@16`, or
- a free Neon or Supabase Postgres database (copy its connection string).

**2. Clerk:** create a **new** application at dashboard.clerk.com (separate from Grant Scout Pro). Under *Configure → Restrictions*, turn on **Restricted** sign-up mode so only people you invite can create accounts.

**3. Configure and start:**
```bash
cp .env.example .env        # then fill in DATABASE_URL, Clerk keys, ALLOWED_EMAILS
npm install
npx prisma migrate dev      # creates the tables
npm run db:seed             # optional: fictional demo data to click around
npm run dev                 # http://localhost:3000
```
To clear demo data before entering real properties: `npm run db:seed -- --reset` (wipes **everything**; never run it against production).

**4. Tests:** `npm test` runs the ledger math tests plus integration tests against your `DATABASE_URL` (point it at your dev database).

## Monthly routine

1. Around the 1st: **Rent & Payments → Post [Month] rent.**
2. As money arrives: record each payment, choosing **Tenant** or **Housing authority (HAP)** as the payer.
3. After the grace period: **Apply late fees.**
4. Check **Reports → Delinquency** for anyone (or any PHA) behind.

## Deploying (Vercel + Neon + R2)

1. Push to a private GitHub repo and import it in Vercel.
2. Create a Neon Postgres database and set `DATABASE_URL` in Vercel.
3. Set the production Clerk keys and `ALLOWED_EMAILS`.
4. **Set up Cloudflare R2 before uploading real documents.** Without the `R2_*` variables, files are saved to local disk, which Vercel erases between deployments. Create an R2 bucket and an API token with read/write on it, then set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. The bucket stays private; downloads use 5-minute signed links.
5. The build command is `npm run build`. Run `npx prisma migrate deploy` against the production database once (or add it to the build).

## Security notes

- Every page and server action checks the Clerk session **and** `ALLOWED_EMAILS`. Document downloads and CSV exports check the same.
- Tenant files can include IDs and income documents. Keep Clerk sign-up restricted, keep the R2 bucket private, and limit `ALLOWED_EMAILS` to people who need access.
- This is single-owner software: everyone on the allow-list sees all properties.

## Not in Phase 1 (natural next steps)

- **Tenant portal** and **online rent payments** (Stripe ACH for the tenant portion; PHAs pay by direct deposit)
- **Automated reminders** (email/SMS before the due date and when late), e.g. via SendGrid
- **Owner/investor statements** per property for Fund I LP reporting
- **Bank reconciliation / full double-entry accounting.** The cash-flow report is cash-basis and isn't a substitute for the fund's books kept by the fund administrator.
- Multi-tenant SaaS (organizations), if this becomes a product for other HUD-VASH landlords

## Project layout

```
prisma/schema.prisma        data model (read this first)
prisma/seed.ts              demo data
src/lib/ledger.ts           rent run, late fees, balances, aging (the money logic)
src/lib/reports.ts          rent roll, delinquency, cash flow, CSV
src/lib/auth.ts             Clerk + email allow-list gate
src/lib/storage.ts          R2 / local file storage
src/app/(app)/…             one folder per module: page.tsx + actions.ts
tests/                      ledger unit tests + database integration tests
```
