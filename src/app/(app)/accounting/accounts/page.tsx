import Link from "next/link";
import type { Account, AccountType } from "@prisma/client";
import { accountTotals } from "@/lib/accounting";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Card, CardBody, CardHeader, Field, Input, Table, Td, Th, Textarea } from "@/components/ui";
import { ACCOUNT_TYPES } from "@/lib/enums";
import { money, todayUTC } from "@/lib/utils";
import { deleteAccount, saveAccount } from "../actions";

export const metadata = { title: "Chart of accounts" };
const typeLabel: Record<AccountType, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

export default async function AccountsPage() {
  const [totals, accounts] = await Promise.all([accountTotals({ to: todayUTC() }), db.account.findMany({ orderBy: { code: "asc" } })]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        {(Object.keys(typeLabel) as AccountType[]).map((type) => {
          const rows = totals.filter((t) => t.type === type);
          if (!rows.length) return null;
          return (
            <Card key={type}>
              <CardHeader title={typeLabel[type]} />
              <Table>
                <thead><tr><Th>No.</Th><Th>Account</Th><Th className="text-right">Balance</Th><Th /></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const a = byId.get(r.id)!;
                    return (
                      <tr key={r.id} className={a.active ? "" : "opacity-50"}>
                        <Td className="tabular text-muted">{r.code}</Td>
                        <Td>
                          <Link href={`/accounting/accounts/${r.id}`} className="hover:underline">{r.name}</Link>
                          {a.isBank && <span className="ml-2"><Badge tone="blue">Bank</Badge></span>}
                          {!a.active && <span className="ml-2"><Badge>Inactive</Badge></span>}
                        </Td>
                        <Td className="tabular text-right">{money(r.balance)}</Td>
                        <Td className="text-right">
                          <EditPopover title={`Edit ${r.code}`}>
                            <ActionForm action={saveAccount.bind(null, a.id)} submitLabel="Save account">
                              <AccountFields a={a} />
                            </ActionForm>
                            {!a.isSystem && (
                              <div className="mt-3 border-t border-line pt-3">
                                <ActionForm action={deleteAccount.bind(null, a.id)} submitLabel="Delete account" submitVariant="danger" confirm="Delete this account?" />
                              </div>
                            )}
                          </EditPopover>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          );
        })}
      </div>
      <Card className="h-fit">
        <CardHeader title="Add account" subtitle="e.g. a second bank account, or a more specific expense category" />
        <CardBody>
          <ActionForm action={saveAccount.bind(null, null)} submitLabel="Add account" resetOnSuccess>
            <AccountFields />
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}

function AccountFields({ a }: { a?: Account }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Number *">
          <Input name="code" defaultValue={a?.code} placeholder="5150" required readOnly={a?.isSystem} />
        </Field>
        <Field label="Name *" className="col-span-2">
          <Input name="name" defaultValue={a?.name} required />
        </Field>
      </div>
      <Field label="Type">
        {a?.isSystem ? <><input type="hidden" name="type" value={a.type} /><Input value={typeLabel[a.type]} readOnly /></> : <EnumSelect name="type" values={ACCOUNT_TYPES} defaultValue={a?.type ?? "EXPENSE"} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isBank" defaultChecked={a?.isBank} className="size-4 accent-navy" /> Bank account (import statements, receive payments)
      </label>
      {a && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={a.active} className="size-4 accent-navy" /> Active
        </label>
      )}
      <Field label="Description">
        <Textarea name="description" rows={2} defaultValue={a?.description ?? ""} />
      </Field>
    </>
  );
}
