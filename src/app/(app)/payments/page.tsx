import Link from "next/link";
import { db } from "@/lib/db";
import { recordPayment } from "../leases/actions";
import { runLateFees, runRentCharges } from "./actions";
import { tenantName } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { PARTIES, PAYMENT_METHODS } from "@/lib/enums";
import { dateToInput, fmtDate, money, periodBounds, periodLabel, periodOf, titleCase, todayUTC } from "@/lib/utils";

export const metadata = { title: "Rent & payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const today = todayUTC();
  const period = sp.period && /^\d{4}-\d{2}$/.test(sp.period) ? sp.period : periodOf(today);
  const { start, end } = periodBounds(period);

  const [rentCharges, payments, activeLeases] = await Promise.all([
    db.charge.findMany({ where: { period, type: "RENT" } }),
    db.payment.findMany({
      where: { paidOn: { gte: start, lte: end } },
      orderBy: { paidOn: "desc" },
      include: { lease: { include: { tenant: true, unit: { include: { property: true } } } } },
    }),
    db.lease.findMany({
      where: { status: "ACTIVE" },
      orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { label: "asc" } }],
      include: { tenant: true, unit: { include: { property: true } } },
    }),
  ]);

  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  const billedTenant = sum(rentCharges.filter((c) => c.party === "TENANT"));
  const billedHap = sum(rentCharges.filter((c) => c.party === "HOUSING_AUTHORITY"));
  const paidTenant = sum(payments.filter((p) => p.party === "TENANT"));
  const paidHap = sum(payments.filter((p) => p.party === "HOUSING_AUTHORITY"));

  const prev = periodOf(new Date(start.getTime() - 86_400_000));
  const next = periodOf(new Date(end.getTime() + 86_400_000));

  return (
    <>
      <PageHeader
        title="Rent & payments"
        subtitle={
          <span className="flex items-center gap-3">
            <Link href={`/payments?period=${prev}`} className="hover:text-ink">←</Link>
            <span className="font-medium text-ink">{periodLabel(period)}</span>
            <Link href={`/payments?period=${next}`} className="hover:text-ink">→</Link>
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tenant rent billed" value={money(billedTenant)} />
        <Stat label="Tenant collected" value={money(paidTenant)} sub={billedTenant ? `${Math.round((paidTenant / billedTenant) * 100)}% of billed` : undefined} />
        <Stat label="HAP billed" value={money(billedHap)} />
        <Stat label="HAP received" value={money(paidHap)} sub={billedHap ? `${Math.round((paidHap / billedHap) * 100)}% of billed` : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={`Payments received in ${periodLabel(period)}`} />
          {payments.length === 0 ? (
            <Empty>No payments recorded this month.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Unit / tenant</Th>
                  <Th>From</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(p.paidOn)}</Td>
                    <Td>
                      <Link href={`/leases/${p.leaseId}`} className="hover:underline">
                        {p.lease.unit.property.name} · {p.lease.unit.label}
                      </Link>
                      <div className="text-xs text-muted">{tenantName(p.lease.tenant)}</div>
                    </Td>
                    <Td>
                      <Badge tone={p.party === "TENANT" ? "gray" : "blue"}>{p.party === "TENANT" ? "Tenant" : "HAP"}</Badge>
                    </Td>
                    <Td className="text-muted">
                      {titleCase(p.method)}
                      {p.reference ? ` #${p.reference}` : ""}
                    </Td>
                    <Td className="tabular text-right font-medium">{money(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Monthly rent run" subtitle="Run once at the start of each month. Safe to re-run; nothing is doubled." />
            <CardBody className="flex flex-col gap-5">
              <ActionForm action={runRentCharges} submitLabel={`Post ${periodLabel(period)} rent`}>
                <input type="hidden" name="period" value={period} />
                <p className="text-xs text-muted">
                  Creates a tenant-portion charge and a HAP charge for every active lease covering this month.
                </p>
              </ActionForm>
              <div className="border-t border-line pt-4">
                <ActionForm action={runLateFees} submitLabel="Apply late fees" submitVariant="secondary">
                  <input type="hidden" name="period" value={period} />
                  <p className="text-xs text-muted">
                    Adds each lease&apos;s late fee when the tenant is still past due after the grace period. Housing authorities are never charged late fees.
                  </p>
                </ActionForm>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Record payment" />
            <CardBody>
              <ActionForm action={recordPayment.bind(null, null)} submitLabel="Record payment" resetOnSuccess>
                <FormGrid className="sm:grid-cols-1">
                  <Field label="Lease *">
                    <Select name="leaseId" required defaultValue="">
                      <option value="">Select…</option>
                      {activeLeases.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.unit.property.name} · {l.unit.label} — {tenantName(l.tenant)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="From">
                    <EnumSelect name="party" values={PARTIES} labels={{ TENANT: "Tenant", HOUSING_AUTHORITY: "Housing authority (HAP)" }} defaultValue="TENANT" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Amount *">
                      <Input name="amount" inputMode="decimal" required />
                    </Field>
                    <Field label="Date *">
                      <Input name="paidOn" type="date" defaultValue={dateToInput(today)} required />
                    </Field>
                    <Field label="Method">
                      <EnumSelect name="method" values={PAYMENT_METHODS} defaultValue="ACH" />
                    </Field>
                    <Field label="Reference">
                      <Input name="reference" />
                    </Field>
                  </div>
                </FormGrid>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
