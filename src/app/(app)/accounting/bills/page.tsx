import Link from "next/link";
import type { Bill } from "@prisma/client";
import { db } from "@/lib/db";
import { AccountSelect, PropertySelect } from "@/components/account-select";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, Select, Table, Td, Th } from "@/components/ui";
import { PAYMENT_METHODS } from "@/lib/enums";
import { centsToInput, cn, dateToInput, fmtDate, money, todayUTC } from "@/lib/utils";
import { createBill, deleteBillPayment, payBill, updateBill, voidBill } from "../actions";

export const metadata = { title: "Bills" };

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string; maintenanceId?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === "PAID" || sp.status === "VOID" ? sp.status : "OPEN";
  const today = todayUTC();
  const [bills, vendors, fromWo] = await Promise.all([
    db.bill.findMany({
      where: { status },
      orderBy: status === "OPEN" ? [{ dueDate: { sort: "asc", nulls: "last" } }] : [{ billDate: "desc" }],
      take: 200,
      include: { vendor: true, property: true, expenseAccount: true, maintenance: { select: { id: true, title: true } }, payments: { include: { bankAccount: true }, orderBy: { date: "asc" } } },
    }),
    db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    sp.maintenanceId ? db.maintenanceRequest.findUnique({ where: { id: sp.maintenanceId }, include: { unit: true } }) : null,
  ]);
  const prefill = fromWo
    ? { vendorId: fromWo.vendorId, propertyId: fromWo.unit.propertyId, maintenanceId: fromWo.id, amount: fromWo.cost, description: fromWo.title }
    : undefined;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div className="flex gap-1">
          {(["OPEN", "PAID", "VOID"] as const).map((s) => (
            <Link key={s} href={`/accounting/bills?status=${s}`} className={cn("rounded-md px-3 py-1.5 text-sm", status === s ? "bg-navy text-white" : "text-muted hover:bg-white")}>
              {s === "OPEN" ? "To pay" : s === "PAID" ? "Paid" : "Void"}
            </Link>
          ))}
        </div>
        <Card>
          {bills.length === 0 ? (
            <Empty>{status === "OPEN" ? "No bills waiting to be paid." : "None."}</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Vendor</Th><Th>For</Th><Th>Due</Th><Th className="text-right">Amount</Th><Th className="text-right">Owed</Th><Th /></tr></thead>
              <tbody>
                {bills.map((b) => {
                  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
                  const owed = b.amount - paid;
                  const overdue = b.status === "OPEN" && b.dueDate && b.dueDate < today;
                  return (
                    <tr key={b.id}>
                      <Td className="font-medium">{b.vendor?.name ?? b.payee}{b.reference && <div className="text-xs font-normal text-muted">#{b.reference}</div>}</Td>
                      <Td>
                        {b.description}
                        <div className="text-xs text-muted">
                          {b.expenseAccount.name}{b.property ? ` · ${b.property.name}` : ""}
                          {b.maintenance && <> · <Link href={`/maintenance/${b.maintenance.id}`} className="underline">work order</Link></>}
                        </div>
                      </Td>
                      <Td className={cn("whitespace-nowrap", overdue && "font-medium text-red-700")}>{fmtDate(b.dueDate ?? b.billDate)}</Td>
                      <Td className="tabular text-right">{money(b.amount)}</Td>
                      <Td className="tabular text-right">{b.status === "VOID" ? <Badge>Void</Badge> : money(owed)}</Td>
                      <Td className="text-right">
                        <EditPopover label={b.status === "OPEN" ? "Pay / edit" : "Details"} title={`${b.vendor?.name ?? b.payee}: ${b.description}`}>
                          {b.payments.length > 0 && (
                            <ul className="mb-4 divide-y divide-line rounded-md border border-line text-sm">
                              {b.payments.map((p) => (
                                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                  <span>{fmtDate(p.date)} · {money(p.amount)} from {p.bankAccount.name}</span>
                                  <ActionForm action={deleteBillPayment.bind(null, p.id)} submitLabel="Delete" submitVariant="ghost" inline confirm="Delete this payment?" />
                                </li>
                              ))}
                            </ul>
                          )}
                          {b.status === "OPEN" && (
                            <>
                              <div className="mb-2 text-sm font-semibold">Record payment</div>
                              <ActionForm action={payBill.bind(null, b.id)} submitLabel="Record payment">
                                <FormGrid>
                                  <Field label="Amount"><Input name="amount" inputMode="decimal" defaultValue={centsToInput(owed)} required /></Field>
                                  <Field label="Date"><Input type="date" name="date" defaultValue={dateToInput(today)} required /></Field>
                                  <Field label="Paid from"><AccountSelect name="bankAccountId" bankOnly /></Field>
                                  <Field label="Method"><EnumSelect name="method" values={PAYMENT_METHODS} defaultValue="ACH" /></Field>
                                  <Field label="Check / reference" className="sm:col-span-2"><Input name="reference" /></Field>
                                </FormGrid>
                              </ActionForm>
                            </>
                          )}
                          {b.status === "OPEN" && b.payments.length === 0 && (
                            <div className="mt-4 border-t border-line pt-4">
                              <div className="mb-2 text-sm font-semibold">Edit bill</div>
                              <ActionForm action={updateBill.bind(null, b.id)} submitLabel="Save bill">
                                <BillFields bill={b} vendors={vendors} />
                              </ActionForm>
                              <div className="mt-3">
                                <ActionForm action={voidBill.bind(null, b.id)} submitLabel="Void bill" submitVariant="danger" confirm="Void this bill? It comes off the books." />
                              </div>
                            </div>
                          )}
                        </EditPopover>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader title={fromWo ? "Bill for work order" : "Enter a bill"} subtitle="Contractor invoices, utilities, insurance, taxes…" />
        <CardBody>
          <ActionForm action={createBill} submitLabel="Save bill" resetOnSuccess>
            <BillFields vendors={vendors} prefill={prefill} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="paidNow" className="size-4 accent-navy" /> Already paid
            </label>
            <FormGrid>
              <Field label="Paid from"><AccountSelect name="bankAccountId" bankOnly /></Field>
              <Field label="Method"><EnumSelect name="method" values={PAYMENT_METHODS} defaultValue="ACH" /></Field>
            </FormGrid>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

async function BillFields({
  bill, vendors, prefill,
}: {
  bill?: Bill;
  vendors: { id: string; name: string }[];
  prefill?: { vendorId: string | null; propertyId: string; maintenanceId: string; amount: number | null; description: string };
}) {
  const v = bill?.vendorId ?? prefill?.vendorId ?? "";
  return (
    <>
      {(bill?.maintenanceId ?? prefill?.maintenanceId) && <input type="hidden" name="maintenanceId" value={bill?.maintenanceId ?? prefill?.maintenanceId} />}
      <FormGrid>
        <Field label="Vendor">
          <Select name="vendorId" defaultValue={v}>
            <option value="">Not a saved vendor</option>
            {vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="…or pay to"><Input name="payee" defaultValue={bill?.payee ?? ""} placeholder="Alabama Power" /></Field>
        <Field label="Description *" className="sm:col-span-2"><Input name="description" defaultValue={bill?.description ?? prefill?.description} required /></Field>
        <Field label="Category *"><AccountSelect name="expenseAccountId" types={["EXPENSE", "ASSET", "LIABILITY"]} defaultValue={bill?.expenseAccountId} /></Field>
        <Field label="Property"><PropertySelect defaultValue={bill?.propertyId ?? prefill?.propertyId} blank="Company-wide" /></Field>
        <Field label="Amount *"><Input name="amount" inputMode="decimal" defaultValue={centsToInput(bill?.amount ?? prefill?.amount)} required /></Field>
        <Field label="Invoice #"><Input name="reference" defaultValue={bill?.reference ?? ""} /></Field>
        <Field label="Bill date *"><Input type="date" name="billDate" defaultValue={dateToInput(bill?.billDate ?? todayUTC())} required /></Field>
        <Field label="Due"><Input type="date" name="dueDate" defaultValue={dateToInput(bill?.dueDate)} /></Field>
      </FormGrid>
    </>
  );
}
