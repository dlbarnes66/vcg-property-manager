"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optDate, optStr, reqDate, reqMoney, reqStr } from "@/lib/form";
import { ACCOUNT_TYPES, PAYMENT_METHODS } from "@/lib/enums";
import { assertNotReconciled, createManualEntry, repostBill, syncLedger, type LineInput } from "@/lib/accounting";
import {
  categorizeTransaction, finishReconciliation, importBankRows, matchTransaction, parseBankCsv, setCleared, unmatchTransaction,
} from "@/lib/banking";
import { money, toCents } from "@/lib/utils";

const refresh = () => revalidatePath("/accounting", "layout");

/* ------------------------------- Chart of accounts ------------------------------- */

export async function saveAccount(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const code = reqStr(fd, "code", "Account number");
    if (!/^\d{3,6}$/.test(code)) throw new Error("Account number should be 3–6 digits, e.g. 5150");
    const data = {
      code,
      name: reqStr(fd, "name", "Name").slice(0, 120),
      type: oneOf(fd, "type", ACCOUNT_TYPES),
      isBank: bool(fd, "isBank"),
      active: id ? bool(fd, "active") : true,
      description: optStr(fd, "description"),
    };
    if (data.isBank && data.type !== "ASSET") throw new Error("Bank accounts must be Asset accounts");
    if (id) {
      const before = await db.account.findUniqueOrThrow({ where: { id }, include: { _count: { select: { lines: true } } } });
      if (before.isSystem && (data.code !== before.code || data.type !== before.type)) throw new Error("Built-in accounts keep their number and type (you can rename them)");
      if (before._count.lines > 0 && data.type !== before.type) throw new Error("This account has activity, so its type can't change");
      await db.account.update({ where: { id }, data });
    } else await db.account.create({ data });
    refresh();
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteAccount(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const a = await db.account.findUniqueOrThrow({ where: { id }, include: { _count: { select: { lines: true, billsExpensed: true } } } });
    if (a.isSystem) throw new Error("Built-in accounts can't be deleted");
    if (a._count.lines || a._count.billsExpensed) throw new Error("This account has activity. Mark it inactive instead.");
    await db.account.delete({ where: { id } });
    refresh();
    redirect("/accounting/accounts");
  } catch (e) {
    return toActionError(e);
  }
}

/* ------------------------------- Journal entries ------------------------------- */

export async function createJournalEntry(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const accts = fd.getAll("line.accountId").map(String);
    const debits = fd.getAll("line.debit").map(String);
    const credits = fd.getAll("line.credit").map(String);
    const props = fd.getAll("line.propertyId").map(String);
    const memos = fd.getAll("line.memo").map(String);
    const lines: LineInput[] = [];
    accts.forEach((accountId, i) => {
      const debit = toCents(debits[i]) ?? 0;
      const credit = toCents(credits[i]) ?? 0;
      if (!accountId && !debit && !credit) return; // blank row
      if (!accountId) throw new Error(`Line ${i + 1}: pick an account`);
      lines.push({ accountId, debit, credit, propertyId: props[i] || null, memo: memos[i] || null });
    });
    await createManualEntry({ date: reqDate(fd, "date", "Date"), memo: optStr(fd, "memo"), lines, createdByEmail: email });
    refresh();
    return { ok: true, message: `Entry saved (${money(lines.reduce((s, l) => s + (l.debit ?? 0), 0))})` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteJournalEntry(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const e = await db.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { bankTransaction: true } } } });
    if (e.source !== "MANUAL" && e.source !== "BANK") throw new Error("Automatic entries change when you edit or delete the charge, payment, or bill they came from.");
    await assertNotReconciled({ entryId: id });
    // Put any matched bank lines back in the "to review" list
    await db.bankTransaction.updateMany({ where: { matchedLineId: { in: e.lines.map((l) => l.id) } }, data: { status: "UNMATCHED", matchedLineId: null } });
    await db.journalEntry.delete({ where: { id } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

/* ------------------------------------ Bills ------------------------------------ */

function billFields(fd: FormData) {
  const vendorId = optStr(fd, "vendorId");
  const payee = optStr(fd, "payee");
  if (!vendorId && !payee) throw new Error("Pick a vendor or type who it's from");
  const amount = reqMoney(fd, "amount", "Amount");
  if (amount <= 0) throw new Error("Amount must be more than $0");
  return {
    vendorId,
    payee: vendorId ? null : payee,
    propertyId: optStr(fd, "propertyId"),
    maintenanceId: optStr(fd, "maintenanceId"),
    expenseAccountId: reqStr(fd, "expenseAccountId", "Category"),
    billDate: reqDate(fd, "billDate", "Bill date"),
    dueDate: optDate(fd, "dueDate"),
    amount,
    description: reqStr(fd, "description", "Description").slice(0, 300),
    reference: optStr(fd, "reference"),
  };
}

export async function createBill(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const data = billFields(fd);
    const bill = await db.bill.create({ data });
    if (bool(fd, "paidNow")) {
      await db.billPayment.create({
        data: { billId: bill.id, bankAccountId: reqStr(fd, "bankAccountId", "Paid from"), date: optDate(fd, "paidOn") ?? data.billDate, amount: data.amount, method: oneOf(fd, "method", PAYMENT_METHODS, "ACH") },
      });
      await db.bill.update({ where: { id: bill.id }, data: { status: "PAID" } });
    }
    await syncLedger();
    refresh();
    revalidatePath("/maintenance");
    return { ok: true, message: `Bill for ${money(data.amount)} saved` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateBill(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const bill = await db.bill.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    if (bill.payments.length) throw new Error("This bill has payments. Delete the payments first to edit it.");
    await assertNotReconciled({ billId: id });
    await db.bill.update({ where: { id }, data: billFields(fd) });
    await repostBill(id);
    refresh();
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function payBill(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const bill = await db.bill.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    if (bill.status === "VOID") throw new Error("This bill is void");
    const remaining = bill.amount - bill.payments.reduce((s, p) => s + p.amount, 0);
    const amount = reqMoney(fd, "amount", "Amount");
    if (amount <= 0 || amount > remaining) throw new Error(`Pay between $0.01 and ${money(remaining)}`);
    await db.billPayment.create({
      data: { billId: id, bankAccountId: reqStr(fd, "bankAccountId", "Paid from"), date: reqDate(fd, "date", "Date"), amount, method: oneOf(fd, "method", PAYMENT_METHODS, "ACH"), reference: optStr(fd, "reference") },
    });
    if (amount === remaining) await db.bill.update({ where: { id }, data: { status: "PAID" } });
    await syncLedger();
    refresh();
    return { ok: true, message: `Paid ${money(amount)}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteBillPayment(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await assertNotReconciled({ billPaymentId: id });
    const bp = await db.billPayment.delete({ where: { id } });
    await db.bill.update({ where: { id: bp.billId }, data: { status: "OPEN" } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidBill(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const bill = await db.bill.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    if (bill.payments.length) throw new Error("Delete this bill's payments before voiding it");
    await assertNotReconciled({ billId: id });
    await db.bill.update({ where: { id }, data: { status: "VOID" } });
    await syncLedger();
    refresh();
    return { ok: true, message: "Bill voided" };
  } catch (e) {
    return toActionError(e);
  }
}

/* ----------------------------------- Banking ----------------------------------- */

export async function importStatement(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const accountId = reqStr(fd, "accountId", "Bank account");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file exported from your bank");
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is larger than 5 MB");
    const { rows, errors } = parseBankCsv(await file.text());
    if (rows.length === 0) throw new Error(errors[0] ?? "No transactions found in that file");
    const r = await importBankRows(accountId, rows);
    refresh();
    const extra = [r.duplicates ? `${r.duplicates} already imported` : "", errors.length ? `${errors.length} rows skipped (${errors.slice(0, 2).join("; ")})` : ""].filter(Boolean).join(" · ");
    return { ok: true, message: `Imported ${r.imported} transaction${r.imported === 1 ? "" : "s"}${extra ? ` · ${extra}` : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function matchTxnAction(txnId: string, lineId: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await matchTransaction(txnId, lineId);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function categorizeTxnAction(txnId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    await categorizeTransaction(txnId, { accountId: reqStr(fd, "accountId", "Category"), propertyId: optStr(fd, "propertyId"), memo: optStr(fd, "memo"), createdByEmail: email });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unmatchTxnAction(txnId: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await unmatchTransaction(txnId);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function excludeTxnAction(txnId: string, exclude: boolean, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const t = await db.bankTransaction.findUniqueOrThrow({ where: { id: txnId } });
    if (t.status === "MATCHED") throw new Error("Unmatch it first");
    await db.bankTransaction.update({ where: { id: txnId }, data: { status: exclude ? "EXCLUDED" : "UNMATCHED" } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function setClearedAction(lineId: string, cleared: boolean, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await setCleared(lineId, cleared);
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function finishReconciliationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const balance = toCents(fd.get("statementBalance"));
    if (balance == null) throw new Error("Enter the statement's ending balance");
    await finishReconciliation(reqStr(fd, "accountId", "Account"), reqDate(fd, "statementDate", "Statement date"), balance, email);
    refresh();
    return { ok: true, message: "Reconciliation finished. Those transactions are now locked." };
  } catch (e) {
    return toActionError(e);
  }
}
