import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { accountOptions } from "@/components/account-select";
import { ActionForm } from "@/components/action-form";
import { JournalEntryForm } from "@/components/journal-entry-form";
import { Badge, Card, CardBody, CardHeader, Empty } from "@/components/ui";
import { sourceLabel } from "@/lib/accounting-labels";
import { cn, dateToInput, fmtDate, money, todayUTC } from "@/lib/utils";
import { createJournalEntry, deleteJournalEntry } from "../actions";

export const metadata = { title: "Journal" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "manual", label: "Manual & bank" },
  { key: "auto", label: "Automatic" },
] as const;

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show = "all" } = await searchParams;
  const where: Prisma.JournalEntryWhereInput =
    show === "manual" ? { source: { in: ["MANUAL", "BANK"] } } : show === "auto" ? { source: { in: ["CHARGE", "PAYMENT", "BILL", "BILL_PAYMENT"] } } : {};
  const [entries, accounts, properties] = await Promise.all([
    db.journalEntry.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { lines: { include: { account: { select: { code: true, name: true } }, property: { select: { name: true } } }, orderBy: { debit: "desc" } } },
    }),
    accountOptions(),
    db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="New journal entry" subtitle="For opening balances, owner contributions or distributions, mortgage payments, depreciation, and corrections." />
        <CardBody>
          <JournalEntryForm
            action={createJournalEntry}
            accounts={accounts.map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))}
            properties={properties.map((p) => ({ id: p.id, label: p.name }))}
            today={dateToInput(todayUTC())}
          />
        </CardBody>
      </Card>

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/accounting/journal?show=${f.key}`} className={cn("rounded-md px-3 py-1.5 text-sm", show === f.key ? "bg-navy text-white" : "text-muted hover:bg-white")}>{f.label}</Link>
        ))}
      </div>

      <Card>
        {entries.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted">{fmtDate(e.date)}</span>
                  <span className="font-medium">{e.memo ?? "—"}</span>
                  <Badge>{sourceLabel[e.source]}</Badge>
                  <span className="tabular ml-auto font-medium">{money(e.lines.reduce((s, l) => s + l.debit, 0))}</span>
                  {(e.source === "MANUAL" || e.source === "BANK") && (
                    <ActionForm action={deleteJournalEntry.bind(null, e.id)} submitLabel="Delete" submitVariant="ghost" inline confirm="Delete this entry?" />
                  )}
                </div>
                <table className="mt-1.5 w-full text-xs text-muted">
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.id}>
                        <td className={cn("py-0.5", l.credit && "pl-6")}>{l.account.code} · {l.account.name}{l.property ? ` · ${l.property.name}` : ""}</td>
                        <td className="tabular w-28 text-right">{l.debit ? money(l.debit) : ""}</td>
                        <td className="tabular w-28 text-right">{l.credit ? money(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
