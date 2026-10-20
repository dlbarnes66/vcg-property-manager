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
- **Forms**: AI-drafted leases, addenda (voucher, pet, lead paint, mold, utilities…), notices (pay-or-quit, violation, entry, non-renewal, rent change), move-in/out checklists and deposit itemization, and vendor agreements, written for any of the 50 states + DC from your records. Edit, save as PDF to Documents, share to the tenant's portal, and keep approved versions in a library organized by state.
- **Reports**: 12 reports in four groups — HUD-VASH (HAP by housing authority, recert & inspection compliance, rent split & voucher mix), Investors (quarterly investor summary, property NOI, cash flow), Rent & collections (rent roll, delinquency aging, collections trend, vacancy loss), and Maintenance (work orders, spending by property & vendor). Every report filters by dates and property and downloads as a **PDF** or a **CSV** for Excel.
- **Resident portal** (`/portal`): invited tenants see their balance and rent breakdown, pay by bank transfer, submit repair requests with photos, and download documents you share. See below.
- **Leasing**: listings for vacant units with photos, a public rentals page (`/rentals`), a mobile-friendly application form with document upload, a screening checklist, approve/deny with recorded reasons, and one click to turn an approved applicant into a tenant + lease.
- **Accounting**: double-entry books per property. Rent charges, payments, and bills post automatically; manual journal entries; bills & bill payments; bank CSV import, matching, and reconciliation; P&L, balance sheet, and trial balance with CSV export.
- **AI Assistant**: ask questions in plain English ("who's behind on rent?", "how did Oak Ridge do last quarter?"). It answers from your live data and can draft messages, tasks, work orders, notes, and payments for you to approve.
- **AI Agent & Approvals**: nothing the AI suggests happens until you click Approve; every decision is logged. An optional daily review briefs you each morning and proposes next steps.
- **Workflows**: "when X, do Y" rules (rent reminders, past-due notices, recert and renewal tasks, failed-inspection tasks, posting rent on the 1st, late fees) that run automatically, each acting once per tenant/event, with Preview and an "ask me first" option.
- **Calendar**: month view (agenda on phones) combining your own events with inspections, cure deadlines, scheduled repairs, lease starts/ends, recertifications, task due dates, and rent due days. Subscribe from Google/Apple/Outlook.
- **Tasks**: due dates, priorities, repeating tasks (weekly → yearly), grouped by Overdue / Today / Next 7 days. Add them from any property, tenant, lease, or work order.
- **Notes**: internal notes on properties, tenants, leases, and work orders, with pinning and a searchable Notes page. Tenants never see them.
- **Communications**: email (SendGrid) and text (Twilio) to a tenant, all tenants at a property, all current tenants, a tenant's case manager, a vendor, or a housing authority. Templates with merge fields, per-tenant message history, text replies in an inbox, and a log for calls and visits.
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

## AI Assistant, Agent, and Workflows

**Turn on the AI**
1. Create an API key at console.anthropic.com (Settings → API Keys) and add billing.
2. Set `ANTHROPIC_API_KEY` in `.env` and restart. It uses Claude Sonnet 5.5 by default; set `ANTHROPIC_MODEL=claude-opus-5-5` for the most capable model.
3. Rough cost: a typical question uses 5–20K tokens, which is a few cents with Sonnet. You can set a monthly spend limit in the Anthropic console.

**What the AI can and can't do.** It can read everything in the app (tenants, balances, work orders, applications, calendar, books) and *propose* actions: emails/texts, tasks, work orders, notes, recording a payment you mention, posting rent, applying late fees. Proposals appear as cards with the full text; **nothing happens until you click Approve**, and approving twice can't run something twice. It can't delete anything, move money, or edit leases. It treats tenant-written text (messages, applications, work orders) as information, never as instructions. All decisions are listed under **Approvals**.

**Daily review.** On Approvals, **Run today's review** gives you a short briefing and up to 5 proposed actions. Set `AI_DAILY_REVIEW=true` to have it ready every morning.

**Workflows**
- Go to Communications → Templates → **Add starter templates**, then Workflows → **Add starter workflows**. They're added *off*. Click **Preview** to see exactly who each would affect today, then **Turn on**.
- Each workflow acts at most once per tenant per situation (e.g. once per lease per late month), even if runs overlap or a day is missed. Tick **Ask me first** to send its actions to Approvals instead.
- Texts only go to tenants marked OK to text; others are logged as skipped.
- **Scheduling:** set `CRON_SECRET` and deploy to Vercel. `vercel.json` runs workflows every morning at 8 AM Eastern (12:00 UTC). For hourly runs, change the schedule to `0 * * * *` (requires Vercel Pro), or have any scheduler call `GET /api/cron/workflows` with header `Authorization: Bearer <CRON_SECRET>`. Locally, use **Run all now**.

## Forms

1. **Forms → Landlord details**: enter the owner's legal name and notice address once. Every form uses them.
2. **New form** (or **Create form** on a lease or tenant page): pick the form and the lease or tenant it's for. The state comes from the property's address (you can change it). Add anything specific, like "12-month term, water included," then **Draft with AI**. You'll see it being written; a full lease takes a minute or two.
3. Review the **Check before using** list: blanks to fill in and state rules to verify. Edit the text directly or ask the AI to change something.
4. **Finish & save PDF** saves it to Documents, linked to the tenant and lease. Tick **Share with the tenant** to put it in their portal. Editing later and clicking **Update PDF** replaces the saved copy.
5. **Save to library** keeps the wording for that state. Once an attorney has approved a version, save it (or upload the attorney's file) to the state's library and start new forms from it.

The **State** dropdown on the Forms page filters everything (your forms and the library) to one state, with the states you use listed first.

AI drafts are a starting point, not legal advice. Landlord-tenant law differs by state and sometimes by city or county, and eviction-related notices must follow the state's process exactly. Have a local attorney review each type of form before first use. Without an Anthropic key you can still start from library templates or a blank page.

## Reports

Open **Reports** and pick one. Use the date shortcuts (Last quarter, Year to date, …) or your own dates, and optionally a single property, then **PDF** or **CSV**.

- **Investor summary** is the one to send Fund I investors each quarter. Type a short note in "Note to investors" and it prints at the top of the PDF. It's marked unaudited and uses the same accrual books as Accounting.
- **Property performance** needs your mortgage payments recorded in Accounting to show debt service: a journal entry with Dr 5700 Mortgage Interest, Dr 2500 Mortgage Payable (principal), Cr 1000 Operating Bank, tagged with the property. Set each property's purchase price to get a cap rate.
- **HAP by housing authority** and **Recert & inspection compliance** are the HUD-VASH ones: what each PHA owes and why it might be holding payment, and which households have a recert or inspection overdue.
- The **AI Assistant** can run any report too ("What was NOI last quarter?") and links you to it.

## Leasing

1. **Leasing → New listing**: pick a vacant unit, set rent and deposit, then open the listing to add photos and **Publish**.
2. Share the listing's application link (or your `/rentals` page). Applicants don't need an account. They can upload ID, income, and voucher paperwork, and **no SSN is collected**. Spam submissions are silently dropped, and one person can apply to a listing at most 3 times a day.
3. Each application creates a high-priority task, and emails `MANAGER_EMAIL` if SendGrid is set up.
4. On the application, work the **screening checklist**, then approve or deny. A denial requires a reason. Use the same written criteria for everyone; source of income (including vouchers) isn't a reason to deny, and if you deny based on a background or credit report, the applicant is owed an adverse action notice.
5. **Create tenant & lease** copies the applicant (with their case manager) into Tenants, moves their documents over, closes the listing, and opens the lease form with the unit, rent, and deposit filled in.

Applications you no longer need can be deleted, with their files, from the application page.

## Accounting

**How it works.** Accrual basis, double entry. You never re-type rent or payments; the books post them automatically:

| When this happens | The books record |
|---|---|
| Rent / fee charged | Dr Accounts Receivable (tenant **or** housing authority) · Cr the matching income account |
| Security deposit charged | Dr A/R – Tenants · Cr **Security Deposits Held** (a liability, not income) |
| Payment received | Dr Operating Bank · Cr the A/R it pays down |
| Bill entered | Dr the expense category · Cr Accounts Payable |
| Bill paid | Dr Accounts Payable · Cr the bank account |

Rent is split into **Rental Income – Tenant Portion (4000)** and **Rental Income – HAP (4010)**. Deleting a charge, payment, or bill removes its entry; editing or voiding a bill re-posts it. Anything in a finished bank reconciliation is locked.

**Getting started**
1. **Journal → New entry**: record opening balances. For example, Dr 1000 Operating Bank and Cr 3000 Owner's Equity for the cash on hand when you start. Tag lines with a property for per-property reports.
2. **Bills**: enter contractor invoices, utilities, insurance, and taxes. From a work order, use **Enter the bill for this repair**.
3. **Banking**: each month, download your bank's transactions as CSV and import them. Most are matched with one click to a payment or bill already in the books. Bank fees and autopays can be categorized right there. Then **Reconcile** against the statement's ending balance.
4. **Financial reports**: P&L, balance sheet, and trial balance for any dates, for all properties or one, with CSV export for your fund administrator or CPA.

The chart of accounts comes with sensible defaults. You can rename accounts and add your own, but built-in accounts keep their numbers because automatic posting depends on them. These books are for property operations; NAV keeps Fund I's official books.

## Calendar, tasks, and notes

- **Time zone.** Event times are entered and shown in `APP_TIMEZONE` (default `America/New_York`).
- **Subscribe.** Set `CALENDAR_FEED_TOKEN` to a long random value (`openssl rand -hex 24`). The Calendar page then shows a private link to add in Google Calendar (Other calendars → From URL) or Apple Calendar (File → New Calendar Subscription). It needs the app to be online, since Google can't reach `localhost`. Anyone with the link can read the calendar; change the token to revoke it.
- **Repeating tasks.** Marking a repeating task done creates the next one. Month-end tasks stay on the last day of the month.

## Communications (email + text)

**Email (SendGrid)**
1. In SendGrid, verify a sender or authenticate your domain (Settings → Sender Authentication).
2. Create an API key with "Mail Send" permission.
3. Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and optionally `SENDGRID_FROM_NAME`. Replies go to `MANAGER_EMAIL` if set.

**Text messages (Twilio)**
1. Buy a local number in Twilio. **Register it for A2P 10DLC** (Messaging → Regulatory Compliance). US carriers block unregistered business texting; registration takes a few days.
2. Create a Messaging Service with that number (recommended) and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_NUMBER`).
3. Set `NEXT_PUBLIC_APP_URL` to your public address, then in Twilio point the number's **A message comes in** webhook to `https://YOUR-DOMAIN/api/twilio/inbound`. Delivery updates go to `/api/twilio/status` automatically. Both are checked against Twilio's signature, which uses that exact public URL.

**Rules the app enforces**
- Tenants are only texted if their record has **OK to text** ticked. Only tick it if they agreed (on the lease or application, for example). A tenant texting STOP turns it off; START turns it back on.
- Group texts automatically add "Reply STOP to opt out."
- Tenants marked **Leave out of email announcements** are skipped for property-wide and all-tenant emails, but still get direct emails about their account.
- Every message is saved before it's sent, so failures show up (with the reason) in the history and under **Failed**.
- Merge fields: `{{firstName}} {{lastName}} {{property}} {{unit}} {{rent}} {{balance}} {{dueDate}}`. Click **Add starter templates** on the Templates page for rent reminders, a past-due notice, and an inspection notice.

Email delivery/open tracking (SendGrid's Event Webhook) isn't wired up yet, so sent emails show as "Sent" rather than "Delivered."

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

- **Notifications to you** when a tenant submits a repair, texts in, or a payment fails
- **AI extras:** let the assistant read uploaded documents (leases, HAP contracts); voice notes; tenant-facing AI help in the portal
- **Leasing extras:** online screening reports (TransUnion SmartMove or similar), application fees, emailing applicants from the app
- **Accounting extras:** live bank feeds (Plaid), owner statements, 1099s for vendors, budgets
- **Automated reminders** (email/SMS before the due date and when late), e.g. via SendGrid
- **Reports extras:** emailing reports on a schedule (e.g. the investor summary each quarter), charts, budget vs. actual, per-investor capital account statements
- Multi-tenant SaaS (organizations), if this becomes a product for other HUD-VASH landlords

## Project layout

```
prisma/schema.prisma        data model (read this first)
prisma/seed.ts              demo data
src/lib/ledger.ts           rent run, late fees, balances, aging (the money logic)
src/lib/forms/              form catalog, AI drafting prompts, facts from records, Markdown → PDF
src/lib/states.ts           the 50 states + DC
src/lib/report-defs.ts      the report catalog (titles, columns, KPIs)
src/lib/report-data.ts      the queries behind each report
src/lib/report-math.ts      vacancy days, recert/inspection status, cap rate (pure, tested)
src/lib/report-pdf.ts       PDF export (pdfkit)
src/lib/reports.ts          rent roll, delinquency, cash flow
src/lib/storage.ts          R2 / local file storage
src/app/(app)/…             one folder per module: page.tsx + actions.ts
src/app/portal/…            resident portal (tenant-facing)
src/lib/auth.ts             who is an admin vs. a tenant
src/lib/stripe.ts           Stripe checkout + payment sync; online-payments.ts posts to the ledger
src/lib/calendar.ts         everything that shows on the calendar; ics.ts builds the subscription feed
src/lib/accounting.ts       chart of accounts, automatic posting, statements; banking.ts imports/matches/reconciles
src/lib/leasing.ts          public application intake and applicant → tenant conversion
src/lib/ai/                 Claude tool loop (assistant.ts) and the tools it can use (tools.ts)
src/lib/agent-actions.ts    what the AI can propose, validation, and the approve → execute step
src/lib/workflows.ts        workflow triggers, once-only firing, and actions
src/lib/messaging.ts        who gets a message (consent / opt-out rules) and sending; messaging-providers.ts talks to SendGrid/Twilio
tests/                      ledger, portal, payments, webhooks, tasks, calendar, messaging, accounting, leasing, AI, workflows, reports, forms
```
