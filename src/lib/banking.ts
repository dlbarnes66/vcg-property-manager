import { createHash, randomUUID } from "crypto";
import { db } from "./db";
import { createManualEntry, naturalBalance } from "./accounting";
import { addDays } from "./utils";

/* ------------------------------------------------------------------------------------------------
 * CSV parsing. Banks export many shapes; this handles the common ones:
 *   Date, Description, Amount            (signed, or with parentheses for negatives)
 *   Date, Description, Debit, Credit     (or Withdrawals / Deposits)
 * Dates: MM/DD/YYYY, M/D/YY, YYYY-MM-DD.
 * ---------------------------------------------------------------------------------------------- */

export type ParsedTxn = { date: Date; description: string; amount: number };

/** RFC 4180-ish CSV splitting (quoted fields, escaped quotes, commas/newlines inside quotes). */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return neg ? -cents : cents;
}

export function parseBankDate(raw: string): Date | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    return d.getUTCMonth() === +m[1] - 1 ? d : null;
  }
  return null;
}

const find = (headers: string[], names: RegExp) => headers.findIndex((h) => names.test(h));

export function parseBankCsv(text: string): { rows: ParsedTxn[]; errors: string[] } {
  const all = splitCsv(text);
  const errors: string[] = [];
  // Find the header row (some banks put account info above it)
  const hi = all.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdraw|deposit/i.test(c)));
  if (hi < 0) return { rows: [], errors: ["Couldn't find a header row with a Date column and an Amount (or Debit/Credit) column."] };
  const headers = all[hi].map((h) => h.trim().toLowerCase());
  const iDate = find(headers, /^(posted |posting |transaction |trans\.? )?date$|^date posted$/);
  // Prefer a real description; Chase's "Details" column only says DEBIT/CREDIT
  const iDesc = [/^description$/, /description/, /^(memo|payee|name|narrative)$/, /memo|payee|narrative/, /details?/]
    .map((re) => find(headers, re))
    .find((i) => i >= 0) ?? -1;
  const iAmt = find(headers, /^amount$|^transaction amount$/);
  const iDebit = find(headers, /^(debit|withdrawals?|money out)( amount)?$/);
  const iCredit = find(headers, /^(credit|deposits?|money in)( amount)?$/);
  if (iDate < 0) return { rows: [], errors: ["No Date column found."] };
  if (iAmt < 0 && iDebit < 0 && iCredit < 0) return { rows: [], errors: ["No Amount, Debit, or Credit column found."] };

  const rows: ParsedTxn[] = [];
  all.slice(hi + 1).forEach((r, n) => {
    const line = hi + n + 2;
    const date = parseBankDate(r[iDate] ?? "");
    if (!date) return errors.push(`Row ${line}: couldn't read the date "${r[iDate] ?? ""}"`);
    let amount: number | null;
    if (iAmt >= 0) amount = parseMoney(r[iAmt] ?? "");
    else {
      const dr = iDebit >= 0 ? (parseMoney(r[iDebit] ?? "") ?? 0) : 0;
      const cr = iCredit >= 0 ? (parseMoney(r[iCredit] ?? "") ?? 0) : 0;
      amount = Math.abs(cr) - Math.abs(dr);
    }
    if (amount == null || amount === 0) return errors.push(`Row ${line}: no amount`);
    rows.push({ date, description: (iDesc >= 0 ? r[iDesc] : "").trim().replace(/\s+/g, " ") || "(no description)", amount });
  });
  return { rows, errors };
}

/** Import parsed rows. Importing the same statement twice adds nothing the second time. */
export async function importBankRows(accountId: string, rows: ParsedTxn[]) {
  const acct = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!acct.isBank) throw new Error("Pick a bank account");
  const batch = randomUUID();
  const seen = new Map<string, number>();
  const data = rows.map((r) => {
    const key = `${accountId}|${r.date.toISOString().slice(0, 10)}|${r.amount}|${r.description.toLowerCase()}`;
    const n = (seen.get(key) ?? 0) + 1; // two identical rows in one statement are both real
    seen.set(key, n);
    return { accountId, date: r.date, description: r.description.slice(0, 500), amount: r.amount, hash: createHash("sha1").update(`${key}|${n}`).digest("hex"), importBatch: batch };
  });
  const res = await db.bankTransaction.createMany({ data, skipDuplicates: true });
  return { imported: res.count, duplicates: rows.length - res.count };
}

/* ------------------------------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------------------------------- */

/** Book lines on this bank account with the same amount within ±7 days that aren't matched yet. */
export async function suggestMatches(txn: { accountId: string; date: Date; amount: number }) {
  const lines = await db.journalLine.findMany({
    where: {
      accountId: txn.accountId,
      bankTransaction: null,
      ...(txn.amount > 0 ? { debit: txn.amount } : { credit: -txn.amount }),
      entry: { date: { gte: addDays(txn.date, -7), lte: addDays(txn.date, 7) } },
    },
    include: { entry: true },
    take: 10,
  });
  return lines.sort((a, b) => Math.abs(a.entry.date.getTime() - txn.date.getTime()) - Math.abs(b.entry.date.getTime() - txn.date.getTime()));
}

export async function matchTransaction(txnId: string, lineId: string) {
  const [txn, line] = await Promise.all([
    db.bankTransaction.findUniqueOrThrow({ where: { id: txnId } }),
    db.journalLine.findUniqueOrThrow({ where: { id: lineId }, include: { bankTransaction: true } }),
  ]);
  if (txn.status !== "UNMATCHED") throw new Error("That bank transaction is already handled");
  if (line.bankTransaction) throw new Error("That book entry is already matched");
  if (line.accountId !== txn.accountId) throw new Error("That entry is on a different account");
  const lineAmount = line.debit - line.credit;
  if (lineAmount !== txn.amount) throw new Error("Amounts don't match");
  await db.$transaction([
    db.bankTransaction.update({ where: { id: txnId }, data: { status: "MATCHED", matchedLineId: lineId } }),
    db.journalLine.update({ where: { id: lineId }, data: { clearedAt: new Date() } }),
  ]);
}

/** For bank activity with no book entry yet (fees, a utility autopay): record it against an account and match it. */
export async function categorizeTransaction(txnId: string, opts: { accountId: string; propertyId?: string | null; memo?: string | null; createdByEmail?: string }) {
  const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: txnId } });
  if (txn.status !== "UNMATCHED") throw new Error("That bank transaction is already handled");
  if (opts.accountId === txn.accountId) throw new Error("Pick the other side of the transaction (an income, expense, or other account)");
  const amt = Math.abs(txn.amount);
  const bankSide = txn.amount > 0 ? { debit: amt } : { credit: amt };
  const otherSide = txn.amount > 0 ? { credit: amt } : { debit: amt };
  const entry = await createManualEntry({
    date: txn.date,
    memo: opts.memo || txn.description,
    source: "BANK",
    createdByEmail: opts.createdByEmail,
    lines: [
      { accountId: txn.accountId, ...bankSide, propertyId: opts.propertyId },
      { accountId: opts.accountId, ...otherSide, propertyId: opts.propertyId },
    ],
  });
  const bankLine = entry.lines.find((l) => l.accountId === txn.accountId)!;
  await matchTransaction(txnId, bankLine.id);
  return entry;
}

export async function unmatchTransaction(txnId: string) {
  const txn = await db.bankTransaction.findUniqueOrThrow({ where: { id: txnId }, include: { matchedLine: true } });
  if (txn.matchedLine?.reconciliationId) throw new Error("That's part of a finished reconciliation and is locked");
  await db.$transaction([
    db.bankTransaction.update({ where: { id: txnId }, data: { status: "UNMATCHED", matchedLineId: null } }),
    ...(txn.matchedLineId ? [db.journalLine.update({ where: { id: txn.matchedLineId }, data: { clearedAt: null } })] : []),
  ]);
}

/* ------------------------------------------------------------------------------------------------
 * Reconciliation: statement ending balance must equal the balance of cleared book lines.
 * ---------------------------------------------------------------------------------------------- */

export async function reconciliationStatus(accountId: string, statementDate: Date, statementBalance: number) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const upTo = { entry: { date: { lt: addDays(statementDate, 1) } } };
  const [cleared, book, outstanding, unmatchedBank] = await Promise.all([
    db.journalLine.aggregate({ where: { accountId, clearedAt: { not: null }, ...upTo }, _sum: { debit: true, credit: true } }),
    db.journalLine.aggregate({ where: { accountId, ...upTo }, _sum: { debit: true, credit: true } }),
    db.journalLine.findMany({ where: { accountId, clearedAt: null, ...upTo }, include: { entry: true }, orderBy: { entry: { date: "asc" } }, take: 200 }),
    db.bankTransaction.count({ where: { accountId, status: "UNMATCHED", date: { lt: addDays(statementDate, 1) } } }),
  ]);
  const clearedBalance = naturalBalance(account.type, cleared._sum.debit ?? 0, cleared._sum.credit ?? 0);
  const bookBalance = naturalBalance(account.type, book._sum.debit ?? 0, book._sum.credit ?? 0);
  return { account, clearedBalance, bookBalance, difference: statementBalance - clearedBalance, outstanding, unmatchedBank };
}

/** Marks a book line cleared without a bank transaction (e.g. the opening balance). */
export async function setCleared(lineId: string, cleared: boolean) {
  const line = await db.journalLine.findUniqueOrThrow({ where: { id: lineId }, include: { bankTransaction: true } });
  if (line.reconciliationId) throw new Error("That's part of a finished reconciliation and is locked");
  if (!cleared && line.bankTransaction) throw new Error("Unmatch the bank transaction instead");
  await db.journalLine.update({ where: { id: lineId }, data: { clearedAt: cleared ? new Date() : null } });
}

export async function finishReconciliation(accountId: string, statementDate: Date, statementBalance: number, createdByEmail?: string) {
  const s = await reconciliationStatus(accountId, statementDate, statementBalance);
  if (s.difference !== 0) throw new Error(`The statement is off by ${(s.difference / 100).toFixed(2)}. Match or clear transactions until the difference is 0.00.`);
  return db.$transaction(async (tx) => {
    const rec = await tx.reconciliation.create({ data: { accountId, statementDate, statementBalance, createdByEmail } });
    await tx.journalLine.updateMany({
      where: { accountId, clearedAt: { not: null }, reconciliationId: null, entry: { date: { lt: addDays(statementDate, 1) } } },
      data: { reconciliationId: rec.id },
    });
    return rec;
  });
}
