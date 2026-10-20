import Link from "next/link";
import { db } from "@/lib/db";
import { reconciliationStatus, suggestMatches } from "@/lib/banking";
import { AccountSelect, PropertySelect } from "@/components/account-select";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { FilterSelect } from "@/components/filter-select";
import { Badge, Button, Card, CardBody, CardHeader, Empty, Field, Input, Stat } from "@/components/ui";
import { cn, dateToInput, fmtDate, money, toCents, toDate, todayUTC } from "@/lib/utils";
import {
  categorizeTxnAction, excludeTxnAction, finishReconciliationAction, importStatement, matchTxnAction, setClearedAction, unmatchTxnAction,
} from "../actions";

export const metadata = { title: "Banking" };

export default async function BankingPage({ searchParams }: { searchParams: Promise<{ account?: string; view?: string; statementDate?: string; statementBalance?: string }> }) {
  const sp = await searchParams;
  const banks = await db.account.findMany({ where: { isBank: true, active: true }, orderBy: { code: "asc" } });
  if (banks.length === 0) return <Card><Empty>Add a bank account in the chart of accounts first.</Empty></Card>;
  const account = banks.find((b) => b.id === sp.account) ?? banks[0];
  const view = sp.view === "matched" || sp.view === "excluded" || sp.view === "reconcile" ? sp.view : "review";
  const q = (v: string) => `/accounting/banking?account=${account.id}&view=${v}`;

  const counts = await db.bankTransaction.groupBy({ by: ["status"], where: { accountId: account.id }, _count: true });
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const lastRec = await db.reconciliation.findFirst({ where: { accountId: account.id }, orderBy: { statementDate: "desc" } });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <form>
          <Field label="Bank account">
            <FilterSelect name="account" defaultValue={account.id}>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </FilterSelect>
          </Field>
        </form>
        <div className="flex gap-1">
          {[["review", `To review (${count("UNMATCHED")})`], ["matched", `Matched (${count("MATCHED")})`], ["excluded", `Excluded (${count("EXCLUDED")})`], ["reconcile", "Reconcile"]].map(([k, l]) => (
            <Link key={k} href={q(k)} className={cn("rounded-md px-3 py-1.5 text-sm", view === k ? "bg-navy text-white" : "text-muted hover:bg-white")}>{l}</Link>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">{lastRec ? `Last reconciled through ${fmtDate(lastRec.statementDate)}` : "Never reconciled"}</span>
      </div>

      {view === "reconcile" ? (
        <Reconcile accountId={account.id} sp={sp} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TxnList accountId={account.id} status={view === "matched" ? "MATCHED" : view === "excluded" ? "EXCLUDED" : "UNMATCHED"} />
          </div>
          <Card className="h-fit">
            <CardHeader title="Import a statement" subtitle="Download transactions as CSV from your bank's website, then upload here. Re-importing the same file is safe." />
            <CardBody>
              <ActionForm action={importStatement} submitLabel="Import CSV" resetOnSuccess>
                <input type="hidden" name="accountId" value={account.id} />
                <Input type="file" name="file" accept=".csv,text/csv" className="h-auto py-1.5" required />
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

async function TxnList({ accountId, status }: { accountId: string; status: "UNMATCHED" | "MATCHED" | "EXCLUDED" }) {
  const txns = await db.bankTransaction.findMany({
    where: { accountId, status },
    orderBy: { date: status === "UNMATCHED" ? "asc" : "desc" },
    take: 100,
    include: { matchedLine: { include: { entry: true } } },
  });
  if (txns.length === 0)
    return <Card><Empty>{status === "UNMATCHED" ? "Nothing to review. Import a statement to get started." : "None."}</Empty></Card>;
  const suggestions = status === "UNMATCHED" ? await Promise.all(txns.map((t) => suggestMatches(t))) : [];

  return (
    <Card>
      <ul className="divide-y divide-line">
        {txns.map((t, i) => (
          <li key={t.id} className="px-5 py-3 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-20 shrink-0 text-xs text-muted">{fmtDate(t.date)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{t.description}</div>
                {t.matchedLine && <div className="text-xs text-muted">Matched to: {t.matchedLine.entry.memo ?? "entry"} ({fmtDate(t.matchedLine.entry.date)})</div>}
              </div>
              <div className={cn("tabular shrink-0 font-semibold", t.amount > 0 ? "text-emerald-700" : "")}>{money(t.amount)}</div>
            </div>
            {status === "UNMATCHED" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-[5.75rem]">
                {suggestions[i].slice(0, 2).map((l) => (
                  <ActionForm key={l.id} action={matchTxnAction.bind(null, t.id, l.id)} submitLabel={`Match: ${(l.entry.memo ?? "entry").slice(0, 40)} · ${fmtDate(l.entry.date)}`} submitVariant="secondary" inline />
                ))}
                <EditPopover label="Categorize" title={`${money(t.amount)} · ${t.description}`}>
                  <p className="mb-3 text-xs text-muted">
                    For bank activity that isn&apos;t in the books yet (bank fees, an autopay, interest). This records it and matches it in one step.
                  </p>
                  <ActionForm action={categorizeTxnAction.bind(null, t.id)} submitLabel="Record & match">
                    <Field label={t.amount > 0 ? "Where did the money come from?" : "What was it for?"}>
                      <AccountSelect name="accountId" types={t.amount > 0 ? ["INCOME", "EQUITY", "LIABILITY", "ASSET"] : ["EXPENSE", "LIABILITY", "EQUITY", "ASSET"]} />
                    </Field>
                    <Field label="Property"><PropertySelect blank="Company-wide" /></Field>
                    <Field label="Memo"><Input name="memo" defaultValue={t.description} /></Field>
                  </ActionForm>
                </EditPopover>
                <ActionForm action={excludeTxnAction.bind(null, t.id, true)} submitLabel="Exclude" submitVariant="ghost" inline />
                {suggestions[i].length === 0 && <span className="text-xs text-muted">No matching entry within a week</span>}
              </div>
            )}
            {status === "MATCHED" && !t.matchedLine?.reconciliationId && (
              <div className="mt-1 pl-[5.75rem]"><ActionForm action={unmatchTxnAction.bind(null, t.id)} submitLabel="Unmatch" submitVariant="ghost" inline /></div>
            )}
            {status === "MATCHED" && t.matchedLine?.reconciliationId && <div className="mt-1 pl-[5.75rem]"><Badge tone="green">Reconciled</Badge></div>}
            {status === "EXCLUDED" && (
              <div className="mt-1 pl-[5.75rem]"><ActionForm action={excludeTxnAction.bind(null, t.id, false)} submitLabel="Restore" submitVariant="ghost" inline /></div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function Reconcile({ accountId, sp }: { accountId: string; sp: { statementDate?: string; statementBalance?: string } }) {
  let statementDate: Date | null = null;
  let statementBalance: number | null = null;
  try {
    statementDate = sp.statementDate ? toDate(sp.statementDate) : null;
    statementBalance = sp.statementBalance ? toCents(sp.statementBalance) : null;
  } catch {}
  const s = statementDate && statementBalance != null ? await reconciliationStatus(accountId, statementDate, statementBalance) : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Reconcile to your bank statement" subtitle="Enter the ending date and balance printed on the statement." />
        <CardBody>
          <form className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="account" value={accountId} />
            <input type="hidden" name="view" value="reconcile" />
            <Field label="Statement ending date"><Input type="date" name="statementDate" defaultValue={sp.statementDate ?? dateToInput(todayUTC())} required /></Field>
            <Field label="Statement ending balance"><Input name="statementBalance" inputMode="decimal" defaultValue={sp.statementBalance} placeholder="0.00" required /></Field>
            <Button type="submit" variant="secondary">Check</Button>
          </form>
        </CardBody>
      </Card>

      {s && statementDate && statementBalance != null && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Statement balance" value={money(statementBalance)} />
            <Stat label="Cleared in the books" value={money(s.clearedBalance)} />
            <Stat label="Difference" value={money(s.difference)} tone={s.difference === 0 ? "good" : "bad"} sub={s.difference === 0 ? "Ready to finish" : "Should be $0.00"} />
            <Stat label="Book balance" value={money(s.bookBalance)} sub={`${s.outstanding.length} not cleared yet`} />
          </div>
          {s.unmatchedBank > 0 && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {s.unmatchedBank} imported transaction{s.unmatchedBank === 1 ? "" : "s"} on or before this date still need review. <Link className="underline" href={`/accounting/banking?account=${accountId}&view=review`}>Review them</Link>.
            </p>
          )}
          <Card>
            <CardHeader title="In the books but not cleared" subtitle="Checks not cashed yet, deposits in transit, or items with no bank line (like an opening balance). Mark cleared only if it appears on this statement." />
            {s.outstanding.length === 0 ? (
              <Empty>Everything is cleared.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {s.outstanding.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-24 text-xs text-muted">{fmtDate(l.entry.date)}</span>
                    <span className="flex-1 truncate">{l.memo ?? l.entry.memo ?? "—"}</span>
                    <span className="tabular w-28 text-right">{money(l.debit - l.credit)}</span>
                    <ActionForm action={setClearedAction.bind(null, l.id, true)} submitLabel="Mark cleared" submitVariant="ghost" inline />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ActionForm action={finishReconciliationAction} submitLabel="Finish reconciliation" confirm="Finish? Cleared transactions through this date will be locked.">
            <input type="hidden" name="accountId" value={accountId} />
            <input type="hidden" name="statementDate" value={dateToInput(statementDate)} />
            <input type="hidden" name="statementBalance" value={(statementBalance / 100).toFixed(2)} />
          </ActionForm>
        </>
      )}
    </div>
  );
}
