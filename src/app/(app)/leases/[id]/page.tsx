import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { computeLeaseLedger } from "@/lib/ledger";
import { tenantName } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { NotesPanel } from "@/components/notes-panel";
import { TasksPanel } from "@/components/tasks-panel";
import { EnumSelect } from "@/components/enum-select";
import {
  Badge, Card, CardBody, CardHeader, DetailList, Empty, Field, FormGrid, Input, LinkButton, PageHeader, Stat, Table, Td, Th,
} from "@/components/ui";
import { CHARGE_TYPES, PARTIES, PAYMENT_METHODS } from "@/lib/enums";
import { addDays, cn, dateToInput, daysBetween, fmtDate, money, titleCase, todayUTC } from "@/lib/utils";
import { addCharge, deleteCharge, deletePayment, endLease, recordPayment } from "../actions";

const partyLabels = { TENANT: "Tenant", HOUSING_AUTHORITY: "Housing authority (HAP)" };

export default async function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lease = await db.lease.findUnique({
    where: { id },
    include: {
      tenant: true,
      unit: { include: { property: true } },
      housingAuthority: true,
      charges: { orderBy: { dueDate: "asc" } },
      payments: { orderBy: { paidOn: "asc" } },
      onlinePayments: { where: { status: { in: ["PROCESSING", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!lease) notFound();

  const today = todayUTC();
  const { tenant, authority } = computeLeaseLedger(lease.charges, lease.payments, today);

  // Combined ledger with a running balance per party
  type Row = { id: string; kind: "charge" | "payment"; date: Date; party: "TENANT" | "HOUSING_AUTHORITY"; label: string; amount: number; created: Date };
  const rows: Row[] = [
    ...lease.charges.map((c) => ({ id: c.id, kind: "charge" as const, date: c.dueDate, party: c.party, label: c.description ?? titleCase(c.type), amount: c.amount, created: c.createdAt })),
    ...lease.payments.map((p) => ({
      id: p.id, kind: "payment" as const, date: p.paidOn, party: p.party,
      label: `Payment · ${titleCase(p.method)}${p.reference ? ` #${p.reference}` : ""}`, amount: p.amount, created: p.createdAt,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || (a.kind === b.kind ? a.created.getTime() - b.created.getTime() : a.kind === "charge" ? -1 : 1));
  const running = { TENANT: 0, HOUSING_AUTHORITY: 0 };
  const ledger = rows.map((r) => {
    running[r.party] += r.kind === "charge" ? r.amount : -r.amount;
    return { ...r, balance: running[r.party] };
  });

  const recertDays = lease.nextRecertDate ? daysBetween(today, lease.nextRecertDate) : null;
  const isVoucher = lease.hapAmount > 0;

  return (
    <>
      <PageHeader
        title={`${lease.unit.property.name} · ${lease.unit.label}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/tenants/${lease.tenantId}`} className="hover:underline">
              {tenantName(lease.tenant)}
            </Link>
            <Badge tone={lease.status === "ACTIVE" ? "green" : lease.status === "DRAFT" ? "amber" : "gray"}>{titleCase(lease.status)}</Badge>
            {isVoucher && <Badge tone="blue">HUD-VASH</Badge>}
          </span>
        }
        back={{ href: "/leases", label: "Leases" }}
        actions={
          <>
            <LinkButton href={`/forms/new?leaseId=${id}`} variant="secondary">
              <ScrollText size={14} /> Create form
            </LinkButton>
            <LinkButton href={`/leases/${id}/edit`} variant="secondary">
              <Pencil size={14} /> Edit
            </LinkButton>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tenant balance" value={money(tenant.balance)} tone={tenant.pastDue > 0 ? "bad" : tenant.balance < 0 ? "good" : "default"}
          sub={tenant.pastDue > 0 ? `${money(tenant.pastDue)} past due` : tenant.balance < 0 ? "Credit" : "Current"} />
        <Stat label="HAP balance" value={money(authority.balance)} tone={authority.pastDue > 0 ? "bad" : "default"}
          sub={isVoucher ? (authority.pastDue > 0 ? `${money(authority.pastDue)} past due` : "Current") : "No voucher"} />
        <Stat label="Contract rent" value={money(lease.contractRent)} sub={`${money(lease.tenantPortion)} tenant · ${money(lease.hapAmount)} HAP`} />
        <Stat label="Next recert" value={lease.nextRecertDate ? fmtDate(lease.nextRecertDate) : "—"}
          tone={recertDays != null && recertDays <= 60 ? "bad" : "default"}
          sub={recertDays == null ? "Not set" : recertDays < 0 ? `${-recertDays} days overdue` : `in ${recertDays} days`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {lease.onlinePayments.length > 0 && (
            <Card>
              <CardHeader title="Online payments" subtitle="Bank transfers post to the ledger automatically once they clear (usually about 4 business days)." />
              <ul className="divide-y divide-line text-sm">
                {lease.onlinePayments.map((op) => (
                  <li key={op.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="text-muted">
                      {fmtDate(op.createdAt)}
                      {op.failureReason ? ` · ${op.failureReason}` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={op.status === "FAILED" ? "red" : "blue"}>{op.status === "FAILED" ? "Failed" : "Processing"}</Badge>
                      <span className="tabular font-medium">{money(op.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Ledger" subtitle="Running balance is per party: tenant and housing authority are tracked separately." />
            {ledger.length === 0 ? (
              <Empty>No charges or payments yet. Monthly rent is posted from Rent &amp; Payments.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Party</Th>
                    <Th className="text-right">Charge</Th>
                    <Th className="text-right">Payment</Th>
                    <Th className="text-right">Balance</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r) => (
                    <tr key={`${r.kind}-${r.id}`}>
                      <Td className="whitespace-nowrap text-muted">{fmtDate(r.date)}</Td>
                      <Td>{r.label}</Td>
                      <Td>
                        <Badge tone={r.party === "TENANT" ? "gray" : "blue"}>{r.party === "TENANT" ? "Tenant" : "HAP"}</Badge>
                      </Td>
                      <Td className="tabular text-right">{r.kind === "charge" ? money(r.amount) : ""}</Td>
                      <Td className="tabular text-right text-emerald-700">{r.kind === "payment" ? money(r.amount) : ""}</Td>
                      <Td className={cn("tabular text-right", r.balance > 0 && "text-ink", r.balance < 0 && "text-emerald-700")}>{money(r.balance)}</Td>
                      <Td className="text-right">
                        <ActionForm
                          action={(r.kind === "charge" ? deleteCharge : deletePayment).bind(null, r.id)}
                          submitLabel="×"
                          submitVariant="ghost"
                          inline
                          confirm={`Delete this ${r.kind} of ${money(r.amount)}?`}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Record payment" />
              <CardBody>
                <ActionForm action={recordPayment.bind(null, id)} submitLabel="Record payment" resetOnSuccess>
                  <FormGrid className="sm:grid-cols-2">
                    <Field label="From" className="sm:col-span-2">
                      <EnumSelect name="party" values={PARTIES} labels={partyLabels} defaultValue="TENANT" />
                    </Field>
                    <Field label="Amount *">
                      <Input name="amount" inputMode="decimal" required placeholder={(lease.tenantPortion / 100).toFixed(2)} />
                    </Field>
                    <Field label="Date *">
                      <Input name="paidOn" type="date" defaultValue={dateToInput(today)} required />
                    </Field>
                    <Field label="Method">
                      <EnumSelect name="method" values={PAYMENT_METHODS} defaultValue="ACH" />
                    </Field>
                    <Field label="Reference">
                      <Input name="reference" placeholder="Check # / trace" />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Add charge" />
              <CardBody>
                <ActionForm action={addCharge.bind(null, id)} submitLabel="Add charge" resetOnSuccess>
                  <FormGrid className="sm:grid-cols-2">
                    <Field label="Type">
                      <EnumSelect name="type" values={CHARGE_TYPES} defaultValue="UTILITY" />
                    </Field>
                    <Field label="Bill to">
                      <EnumSelect name="party" values={PARTIES} labels={{ TENANT: "Tenant", HOUSING_AUTHORITY: "Housing authority" }} defaultValue="TENANT" />
                    </Field>
                    <Field label="Amount *">
                      <Input name="amount" inputMode="decimal" required />
                    </Field>
                    <Field label="Due date *">
                      <Input name="dueDate" type="date" defaultValue={dateToInput(today)} required />
                    </Field>
                    <Field label="Description" className="sm:col-span-2">
                      <Input name="description" placeholder="Water bill — Sept" />
                    </Field>
                  </FormGrid>
                </ActionForm>
              </CardBody>
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Lease terms" />
            <CardBody>
              <DetailList
                items={[
                  ["Start", fmtDate(lease.startDate)],
                  ["End", lease.endDate ? fmtDate(lease.endDate) : "Month-to-month"],
                  ["Due day", lease.dueDay],
                  ["Security deposit", money(lease.securityDeposit)],
                  ["Late fee", lease.lateFeeAmount ? `${money(lease.lateFeeAmount)} after ${lease.lateFeeGraceDays} days` : "None"],
                  ["Move-in", fmtDate(lease.moveInDate)],
                ]}
              />
            </CardBody>
          </Card>
          {(isVoucher || lease.housingAuthority) && (
            <Card>
              <CardHeader title="Voucher" />
              <CardBody>
                <DetailList
                  items={[
                    ["Housing authority", lease.housingAuthority?.name],
                    ["Voucher #", lease.voucherNumber],
                    ["HAP / mo", money(lease.hapAmount)],
                    ["HAP contract start", fmtDate(lease.hapContractStart)],
                    ["Next recert", fmtDate(lease.nextRecertDate)],
                    ["Case manager", lease.tenant.caseManagerName ? `${lease.tenant.caseManagerName}${lease.tenant.caseManagerPhone ? ` · ${lease.tenant.caseManagerPhone}` : ""}` : null],
                  ]}
                />
              </CardBody>
            </Card>
          )}
          {lease.status === "ACTIVE" && (
            <Card>
              <CardHeader title="End lease" subtitle="Stops future rent charges. History is kept." />
              <CardBody>
                <ActionForm action={endLease.bind(null, id)} submitLabel="End lease" submitVariant="danger" confirm="End this lease?">
                  <Field label="Last day of lease *">
                    <Input name="endDate" type="date" defaultValue={dateToInput(lease.endDate ?? addDays(today, 30))} required />
                  </Field>
                  <Field label="Move-out date">
                    <Input name="moveOutDate" type="date" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <TasksPanel link={{ leaseId: id }} />
          <NotesPanel link={{ leaseId: id }} />
          <DocumentsPanel link={{ leaseId: id }} defaultCategory="LEASE" defaultShared />
        </div>
      </div>
    </>
  );
}

