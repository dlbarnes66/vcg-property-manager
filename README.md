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
- **Resident portal** (`/portal`): invited tenants see their balance and rent breakdown, pay by bank transfer, submit repair requests with photos, and download documents you share. See below.
- **Directory**: housing authorities (with HAP per month and HAP past due per PHA) and vendors.

All money is stored as integer cents. Dates are stored as UTC midnight so they never shift by a day.

---

## Run it locally (Mac)

**1. Prerequisites:** Node 20+ and Postgres. Easiest Postgres options:
- `brew install postgresql@16 && brew services start postgresql@16`, or
- a free Neon or Supabase Postgres database (copy its connection string).

**2. Clerk:** create a **new** application at dashboard.clerk.com (separate from Grant Scout Pro). Under *Configure → Restrictions*, turn on **Restricted** sign-up mode so only people you invite can create accounts.

**3. Configure and start:**
Copy the env template, then fill in `DATABASE_URL`, the Clerk keys, and `ALLOWED_EMAILS`:
```bash
cp .env.example .env
```
Install, create the tables, add optional fictional demo data, and start the app at http://localhost:3000:
```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```
To clear demo data before entering real properties: `npm run db:seed -- --reset` (wipes **everything**; never run it against production).

**4. Tests:** `npm test` runs the ledger math tests plus integration tests against your `DATABASE_URL` (point it at your dev database).

## Resident portal

Tenants sign in through the same Clerk app as you, but they land on `/portal` and can only ever see their own lease.

**Who is who.** Anyone whose verified email is in `ALLOWED_EMAILS` is an admin. A tenant gets access only when you invite them: open the tenant, then **Resident portal → Invite to portal**. Clerk emails them a sign-up link (good for 14 days). Their account is tied to that tenant record and must keep the same email; if you change a tenant's email, their access turns off until you re-invite. **Turn off access** takes effect immediately.

**What they see.** Their balance (tenant portion only; the HAP side never appears as something they owe), what they pay each month vs. what the housing authority pays, upcoming recertification, recent activity, and repair requests they've submitted.

**Documents.** Nothing is visible to tenants unless you mark it **Share** (or tick "Show in tenant portal" when uploading). Lease uploads default to shared. A document shared on a property or unit is visible to whoever currently lives there, which is good for house rules and notices.

**Repair requests** show up in Maintenance with a "From tenant" badge, the tenant's photos, and whether they gave permission to enter. Emergencies appear on your dashboard.

**Clerk setup for the portal:** in your Clerk app, keep sign-up **Restricted** (invites still work) and set `NEXT_PUBLIC_APP_URL` to your site's address in production so invitation links point to the right place.

## Online rent payments (Stripe)

Tenants pay their portion by **ACH bank transfer** through Stripe Checkout. Stripe's fee for ACH is 0.8%, capped at $5. Cards are off by default; set `STRIPE_ALLOW_CARDS=true` to allow them (about 2.9% + 30¢).

How it flows: the tenant enters an amount (up to what they owe) → links their bank in Stripe → the payment shows as **processing** for about 4 business days → when Stripe confirms the money, a payment is posted to the ledger automatically (method ACH, reference = Stripe payment ID). Failed transfers show on the tenant's home page and on the lease. A payment is never posted twice, even if Stripe sends the same notice several times.

**Setup**
1. Create a Stripe account and turn on **ACH Direct Debit** under Settings → Payment methods.
2. Copy the **secret key** (Developers → API keys) into `STRIPE_SECRET_KEY`. Use the `sk_test_...` key while testing.
3. Webhook:
   - **Locally:** install the Stripe CLI (`brew install stripe/stripe-cli/stripe`), run `stripe login`, then `stripe listen --forward-to localhost:3000/api/stripe/webhook`. Put the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
   - **Production:** Developers → Webhooks → Add endpoint `https://YOUR-DOMAIN/api/stripe/webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Restart `npm run dev`. The Pay button appears only when `STRIPE_SECRET_KEY` is set.

If a webhook is ever missed, the app re-checks in-flight payments with Stripe when the tenant opens their portal.

In test mode, pick **Test Institution** in the bank-linking screen, and use the "success" account to simulate a payment that clears.

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

- Every admin page and server action requires an `ALLOWED_EMAILS` admin. Tenants are redirected to their portal, and every portal query is scoped to the signed-in tenant (never to an ID sent from the browser).
- Document downloads: admins can open anything; tenants only documents shared with them. CSV exports are admin-only.
- The Stripe webhook is verified by signature; unsigned or forged requests are rejected.
- Tenant files can include IDs and income documents. Keep Clerk sign-up restricted, keep the R2 bucket private, and limit `ALLOWED_EMAILS` to people who need access.
- Admins all see every property. Tenants see only their own lease.

## Not built yet (natural next steps)

- **Notifications to you** when a tenant submits a repair or a payment fails (email/SMS)
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
src/lib/storage.ts          R2 / local file storage
src/app/(app)/…             one folder per module: page.tsx + actions.ts
src/app/portal/…            resident portal (tenant-facing)
src/lib/auth.ts             who is an admin vs. a tenant
src/lib/stripe.ts           Stripe checkout + payment sync; online-payments.ts posts to the ledger
tests/                      ledger, portal isolation, payment posting, webhook signature tests
```
