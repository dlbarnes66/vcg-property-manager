import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, FolderOpen, Wrench } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { ToSignBanner } from "@/components/to-sign-banner";
import { pendingForTenant } from "@/lib/esign";
import { payableNow, portalLease } from "@/lib/portal-data";
import { refreshStaleOnlinePayments, stripeEnabled } from "@/lib/stripe";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, CardHeader, Empty, Field, Input } from "@/components/ui";
import { dueDateFor } from "@/lib/ledger";
import { addDays, centsToInput, cn, daysBetween, fmtDate, money, periodOf, titleCase, todayUTC } from "@/lib/utils";
import { startRentPayment } from "./actions";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const { tenant } = await requireTenant();
  const toSign = (await pendingForTenant(tenant.id)).map((s) => ({ id: s.id, title: s.request.title, sentAt: s.request.createdAt }));
  const banner = <ToSignBanner items={toSign} hrefFor={(id) => `/portal/sign/${id}`} />;
  let lease = await portalLease(tenant.id);

  if (lease) {
    await refreshStaleOnlinePayments(lease.id);
    lease = await portalLease(tenant.id);
  }

  if (!lease) {
    return (
      <div className="flex flex-col gap-5">
      {banner}
      <Card>
        <Empty>
          Welcome, {tenant.firstName}. We couldn&apos;t find a lease linked to your account yet. Please contact your property manager.
        </Empty>
      </Card>
      </div>
    );
  }

  const today = todayUTC();
  const { balance, pastDue, processing, payable } = payableNow(lease);
  const online = stripeEnabled();
  const failed = lease.onlinePayments
    .filter((p) => p.status === "FAILED" && p.updatedAt > addDays(today, -30))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  // Next rent due date (this month's if still ahead, otherwise next month's)
  let nextDue = dueDateFor(periodOf(today), lease.dueDay);
  if (nextDue < today) nextDue = dueDateFor(periodOf(addDays(today, 32 - today.getUTCDate())), lease.dueDay);

  // Tenant-side ledger only, newest first
  type Row = { key: string; date: Date; label: string; charge?: number; payment?: number; created: Date };
  const rows: Row[] = [
    ...lease.charges.filter((c) => c.party === "TENANT").map((c) => ({ key: `c${c.id}`, date: c.dueDate, label: c.description ?? titleCase(c.type), charge: c.amount, created: c.createdAt })),
    ...lease.payments.filter((p) => p.party === "TENANT").map((p) => ({ key: `p${p.id}`, date: p.paidOn, label: `Payment received · ${titleCase(p.method)}`, payment: p.amount, created: p.createdAt })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.created.getTime() - b.created.getTime());
  let run = 0;
  const ledger = rows.map((r) => ({ ...r, balance: (run += (r.charge ?? 0) - (r.payment ?? 0)) })).reverse().slice(0, 12);

  const recertDays = lease.nextRecertDate ? daysBetween(today, lease.nextRecertDate) : null;
  const isVoucher = lease.hapAmount > 0;

  return (
    <div className="flex flex-col gap-5">
      {banner}
      <div>
        <h1 className="text-xl font-semibold">Hi, {tenant.firstName}</h1>
        <p className="text-sm text-muted">
          {lease.unit.property.name} · {lease.unit.label} · {lease.unit.property.street}, {lease.unit.property.city}
        </p>
      </div>

      {failed && (
        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            Your bank transfer of {money(failed.amount)} on {fmtDate(failed.createdAt)} didn&apos;t go through
            {failed.failureReason ? `: ${failed.failureReason}` : "."} Please try again or contact your property manager.
          </div>
        </div>
      )}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-muted">{balance < 0 ? "Credit on your account" : "Your balance"}</div>
              <div className={cn("tabular mt-1 text-3xl font-semibold", pastDue > 0 && "text-red-700", balance <= 0 && "text-emerald-700")}>
                {money(Math.abs(balance))}
              </div>
              {pastDue > 0 && <div className="mt-1 text-sm text-red-700">{money(pastDue)} is past due</div>}
              {processing > 0 && (
                <div className="mt-1 flex items-center gap-1.5 text-sm text-blue-700">
                  <Clock size={14} /> {money(processing)} bank transfer processing
                </div>
              )}
            </div>
            {balance <= 0 && <CheckCircle2 className="text-emerald-600" size={28} />}
          </div>

          {payable > 0 &&
            (online ? (
              <ActionForm action={startRentPayment} submitLabel="Pay by bank transfer" inline>
                <Field label="Amount" className="min-w-40 flex-1">
                  <Input name="amount" inputMode="decimal" defaultValue={centsToInput(payable)} required />
                </Field>
              </ActionForm>
            ) : (
              <p className="rounded-md bg-paper p-3 text-sm text-muted">Online payments are coming soon. For now, please pay your property manager the usual way.</p>
            ))}
          {payable > 0 && online && (
            <p className="text-xs text-muted">
              You&apos;ll link your bank securely through Stripe. Transfers take about 4 business days to clear; we&apos;ll show it as processing until then.
            </p>
          )}
          {payable <= 0 && processing === 0 && <p className="text-sm text-muted">You&apos;re all paid up. Thank you!</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your rent" />
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted">You pay each month</dt>
              <dd className="tabular mt-0.5 font-medium">{money(lease.tenantPortion)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Next due</dt>
              <dd className="mt-0.5 font-medium">{lease.status === "ACTIVE" ? fmtDate(nextDue) : "Lease ended"}</dd>
            </div>
            {isVoucher && (
              <div className="col-span-2">
                <dt className="text-xs text-muted">Paid by your housing authority (HUD-VASH)</dt>
                <dd className="tabular mt-0.5">{money(lease.hapAmount)} of {money(lease.contractRent)} total rent</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">Lease</dt>
              <dd className="mt-0.5">{fmtDate(lease.startDate)} – {lease.endDate ? fmtDate(lease.endDate) : "month to month"}</dd>
            </div>
            {lease.lateFeeAmount > 0 && (
              <div>
                <dt className="text-xs text-muted">Late fee</dt>
                <dd className="mt-0.5">{money(lease.lateFeeAmount)} after {lease.lateFeeGraceDays} days</dd>
              </div>
            )}
          </dl>
          {recertDays != null && recertDays <= 90 && (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Your annual recertification is due {fmtDate(lease.nextRecertDate)}. Your HUD-VASH case manager or housing authority will need updated income
              paperwork.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/portal/maintenance" className="flex items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm font-medium hover:shadow-sm">
          <Wrench size={18} className="text-navy" /> Request a repair
        </Link>
        <Link href="/portal/documents" className="flex items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm font-medium hover:shadow-sm">
          <FolderOpen size={18} className="text-navy" /> Your documents
        </Link>
      </div>

      <Card>
        <CardHeader title="Recent activity" />
        {ledger.length === 0 ? (
          <Empty>No charges or payments yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {ledger.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{r.label}</div>
                  <div className="text-xs text-muted">{fmtDate(r.date)}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("tabular font-medium", r.payment && "text-emerald-700")}>{r.payment ? `−${money(r.payment)}` : money(r.charge)}</div>
                  <div className="tabular text-xs text-muted">Balance {money(r.balance)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
