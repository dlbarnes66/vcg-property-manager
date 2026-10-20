import Link from "next/link";
import { db } from "@/lib/db";
import { accountTotals, profitAndLoss, trialBalance } from "@/lib/accounting";
import { Badge, Card, CardHeader, Empty, Stat, Table, Td, Th } from "@/components/ui";
import { cn, fmtDate, money, todayUTC } from "@/lib/utils";
import { sourceLabel } from "@/lib/accounting-labels";

export default async function AccountingOverview() {
  const today = todayUTC();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const [totals, month, ytd, tb, openBills, toReview, recent] = await Promise.all([
    accountTotals({ to: today }),
    profitAndLoss(monthStart, today),
    profitAndLoss(yearStart, today),
    trialBalance(today),
    db.bill.findMany({ where: { status: "OPEN" }, include: { payments: true } }),
    db.bankTransaction.count({ where: { status: "UNMATCHED" } }),
    db.journalEntry.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 8, include: { lines: true } }),
  ]);
  const bal = (code: string) => totals.find((t) => t.code === code)?.balance ?? 0;
  const banks = totals.filter((t) => t.isBank);
  const apOpen = openBills.reduce((s, b) => s + b.amount - b.payments.reduce((x, p) => x + p.amount, 0), 0);
  const overdueBills = openBills.filter((b) => b.dueDate && b.dueDate < today).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cash in bank" value={money(banks.reduce((s, b) => s + b.balance, 0))} sub={`${banks.length} bank account${banks.length === 1 ? "" : "s"}`} />
        <Stat label="Owed by tenants" value={money(bal("1200"))} sub={`HAP owed: ${money(bal("1210"))}`} />
        <Stat label="Bills to pay" value={money(apOpen)} tone={overdueBills ? "bad" : "default"} sub={overdueBills ? `${overdueBills} overdue` : `${openBills.length} open`} />
        <Stat label="Security deposits held" value={money(bal("2100"))} sub="Owed back to tenants" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profit & loss" action={<Link href="/accounting/reports" className="text-xs text-muted hover:text-ink">Full reports →</Link>} />
          <Table>
            <thead><tr><Th /><Th className="text-right">This month</Th><Th className="text-right">Year to date</Th></tr></thead>
            <tbody>
              <tr><Td>Income</Td><Td className="tabular text-right">{money(month.totalIncome)}</Td><Td className="tabular text-right">{money(ytd.totalIncome)}</Td></tr>
              <tr><Td>Expenses</Td><Td className="tabular text-right">{money(month.totalExpenses)}</Td><Td className="tabular text-right">{money(ytd.totalExpenses)}</Td></tr>
              <tr className="font-semibold">
                <Td>Net income</Td>
                <Td className={cn("tabular text-right", month.netIncome < 0 && "text-red-700")}>{money(month.netIncome)}</Td>
                <Td className={cn("tabular text-right", ytd.netIncome < 0 && "text-red-700")}>{money(ytd.netIncome)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Bank accounts" action={<Link href="/accounting/banking" className="text-xs text-muted hover:text-ink">Banking →</Link>} />
          {banks.length === 0 ? (
            <Empty>No bank accounts.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {banks.map((b) => (
                <li key={b.id} className="flex items-center justify-between px-5 py-3">
                  <Link href={`/accounting/accounts/${b.id}`} className="hover:underline">{b.code} · {b.name}</Link>
                  <span className="tabular font-medium">{money(b.balance)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs">
            {toReview > 0 ? (
              <Link href="/accounting/banking" className="font-medium text-amber-700">{toReview} imported bank transaction{toReview === 1 ? "" : "s"} to review →</Link>
            ) : (
              <span className="text-muted">No imported transactions waiting</span>
            )}
            <Badge tone={tb.balanced ? "green" : "red"}>{tb.balanced ? "Books balance" : "Out of balance"}</Badge>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent entries" action={<Link href="/accounting/journal" className="text-xs text-muted hover:text-ink">Journal →</Link>} />
        {recent.length === 0 ? (
          <Empty>No entries yet. Rent charges, payments, and bills post here automatically.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Memo</Th><Th>Source</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(e.date)}</Td>
                  <Td>{e.memo ?? "—"}</Td>
                  <Td><Badge>{sourceLabel[e.source]}</Badge></Td>
                  <Td className="tabular text-right">{money(e.lines.reduce((s, l) => s + l.debit, 0))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
