import Link from "next/link";
import { accountLedger } from "@/lib/accounting";
import { PropertySelect } from "@/components/account-select";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Stat, Table, Td, Th } from "@/components/ui";
import { addDays, dateToInput, fmtDate, money, toDate, todayUTC } from "@/lib/utils";
import { sourceLabel } from "@/lib/accounting-labels";

export default async function AccountRegister({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string; propertyId?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const today = todayUTC();
  const from = safeDate(sp.from) ?? new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const to = safeDate(sp.to) ?? today;
  const { account, openingBalance, rows, closingBalance } = await accountLedger(id, from, to, sp.propertyId || null);

  return (
    <div className="flex flex-col gap-6">
      <Link href="/accounting/accounts" className="text-xs text-muted hover:text-ink">← Chart of accounts</Link>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Account" value={<span className="text-lg">{account.code} · {account.name}</span>} />
        <Stat label={`Balance ${fmtDate(addDays(from, -1))}`} value={money(openingBalance)} />
        <Stat label="Activity" value={money(closingBalance - openingBalance)} sub={`${rows.length} lines`} />
        <Stat label={`Balance ${fmtDate(to)}`} value={money(closingBalance)} />
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" name="from" defaultValue={dateToInput(from)} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={dateToInput(to)} /></Field>
        <Field label="Property"><PropertySelect defaultValue={sp.propertyId} blank="All properties" /></Field>
        <Button type="submit" variant="secondary">Show</Button>
      </form>
      <Card>
        <CardHeader title="Register" />
        {rows.length === 0 ? (
          <Empty>No activity in this period.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Memo</Th><Th>Property</Th><Th>Source</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(r.entry.date)}</Td>
                  <Td>{r.memo ?? r.entry.memo ?? "—"}{r.clearedAt && <span className="ml-2"><Badge tone="green">{r.reconciliationId ? "Reconciled" : "Cleared"}</Badge></span>}</Td>
                  <Td className="text-muted">{r.property?.name ?? "—"}</Td>
                  <Td><Badge>{sourceLabel[r.entry.source]}</Badge></Td>
                  <Td className="tabular text-right">{r.debit ? money(r.debit) : ""}</Td>
                  <Td className="tabular text-right">{r.credit ? money(r.credit) : ""}</Td>
                  <Td className="tabular text-right">{money(r.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function safeDate(s?: string) {
  try {
    return s ? toDate(s) : null;
  } catch {
    return null;
  }
}
