import { Prisma, type AccountType, type ChargeType, type Party } from "@prisma/client";
import { db } from "./db";
import { addDays } from "./utils";

/*
 * Double-entry bookkeeping (accrual basis). Every journal entry's debits equal its credits.
 *
 * Automatic posting (kept in sync from the operational records, never typed twice):
 *   Lease charge   Dr Accounts Receivable (tenant or housing authority)  Cr Income (or Security Deposits Held)
 *   Payment        Dr Operating Bank                                     Cr Accounts Receivable
 *   Bill           Dr Expense account                                    Cr Accounts Payable
 *   Bill payment   Dr Accounts Payable                                   Cr Bank
 * Deleting a charge, payment, bill, or bill payment deletes its entry (database cascade).
 */

export const CODES = {
  BANK: "1000",
  AR_TENANT: "1200",
  AR_HAP: "1210",
  AP: "2000",
  DEPOSITS_HELD: "2100",
  EQUITY: "3000",
  RENT_TENANT: "4000",
  RENT_HAP: "4010",
  LATE_FEES: "4100",
  UTILITY_INCOME: "4200",
  DAMAGE_INCOME: "4300",
  OTHER_INCOME: "4900",
  REPAIRS: "5000",
  MORTGAGE: "2500",
  MORTGAGE_INTEREST: "5700",
} as const;

type Seed = { code: string; name: string; type: AccountType; isBank?: boolean; isSystem?: boolean; description?: string };
export const DEFAULT_CHART: Seed[] = [
  { code: "1000", name: "Operating Bank", type: "ASSET", isBank: true, isSystem: true, description: "Rent and payments are deposited here" },
  { code: "1010", name: "Security Deposit Bank", type: "ASSET", isBank: true },
  { code: "1200", name: "Accounts Receivable – Tenants", type: "ASSET", isSystem: true },
  { code: "1210", name: "Accounts Receivable – Housing Authorities", type: "ASSET", isSystem: true, description: "HAP owed by PHAs" },
  { code: "1500", name: "Buildings & Improvements", type: "ASSET" },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY", isSystem: true },
  { code: "2100", name: "Security Deposits Held", type: "LIABILITY", isSystem: true, description: "Owed back to tenants" },
  { code: "2500", name: "Mortgage Payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's Equity", type: "EQUITY", isSystem: true, description: "Opening balances and contributions" },
  { code: "3100", name: "Owner Distributions", type: "EQUITY" },
  { code: "4000", name: "Rental Income – Tenant Portion", type: "INCOME", isSystem: true },
  { code: "4010", name: "Rental Income – HAP", type: "INCOME", isSystem: true },
  { code: "4100", name: "Late Fee Income", type: "INCOME", isSystem: true },
  { code: "4200", name: "Utility Reimbursements", type: "INCOME", isSystem: true },
  { code: "4300", name: "Damage Charges", type: "INCOME", isSystem: true },
  { code: "4900", name: "Other Income", type: "INCOME", isSystem: true },
  { code: "5000", name: "Repairs & Maintenance", type: "EXPENSE", isSystem: true },
  { code: "5100", name: "Utilities", type: "EXPENSE" },
  { code: "5200", name: "Insurance", type: "EXPENSE" },
  { code: "5300", name: "Property Taxes", type: "EXPENSE" },
  { code: "5400", name: "Management Fees", type: "EXPENSE" },
  { code: "5500", name: "Landscaping & Cleaning", type: "EXPENSE" },
  { code: "5600", name: "Legal & Professional", type: "EXPENSE" },
  { code: "5700", name: "Mortgage Interest", type: "EXPENSE" },
  { code: "5800", name: "Bank Fees", type: "EXPENSE" },
  { code: "5900", name: "Other Expense", type: "EXPENSE" },
];

export async function ensureChartOfAccounts() {
  await db.account.createMany({ data: DEFAULT_CHART, skipDuplicates: true });
}

async function idsByCode() {
  const accts = await db.account.findMany({ select: { id: true, code: true } });
  const m = new Map(accts.map((a) => [a.code, a.id]));
  return (code: string) => {
    const id = m.get(code);
    if (!id) throw new Error(`Account ${code} is missing from the chart of accounts`);
    return id;
  };
}

export const debitNormal = (t: AccountType) => t === "ASSET" || t === "EXPENSE";
/** Balance in the account's natural direction (assets/expenses: debits − credits; others: credits − debits). */
export const naturalBalance = (t: AccountType, debit: number, credit: number) => (debitNormal(t) ? debit - credit : credit - debit);

export type LineInput = { accountId: string; debit?: number; credit?: number; propertyId?: string | null; memo?: string | null };

/** Throws a readable error unless the lines form a valid balanced entry. */
export function assertBalanced(lines: LineInput[]) {
  if (lines.length < 2) throw new Error("An entry needs at least two lines");
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const d = l.debit ?? 0;
    const c = l.credit ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) throw new Error("Amounts must be positive");
    if ((d > 0) === (c > 0)) throw new Error("Each line needs either a debit or a credit, not both");
    dr += d;
    cr += c;
  }
  if (dr !== cr) throw new Error(`Debits (${(dr / 100).toFixed(2)}) must equal credits (${(cr / 100).toFixed(2)})`);
}

const creditAccountForCharge = (type: ChargeType, party: Party) =>
  ({
    RENT: party === "HOUSING_AUTHORITY" ? CODES.RENT_HAP : CODES.RENT_TENANT,
    LATE_FEE: CODES.LATE_FEES,
    SECURITY_DEPOSIT: CODES.DEPOSITS_HELD,
    UTILITY: CODES.UTILITY_INCOME,
    DAMAGE: CODES.DAMAGE_INCOME,
    OTHER: CODES.OTHER_INCOME,
  })[type];
const arFor = (party: Party) => (party === "HOUSING_AUTHORITY" ? CODES.AR_HAP : CODES.AR_TENANT);

const isDup = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Posts anything that doesn't have its journal entry yet. Safe to run any number of times, from
 * any number of requests at once (each source can only ever have one entry).
 */
export async function syncLedger() {
  await ensureChartOfAccounts();
  const id = await idsByCode();
  const counts = { charges: 0, payments: 0, bills: 0, billPayments: 0, voided: 0 };

  const post = async (data: Prisma.JournalEntryCreateInput) => {
    try {
      await db.journalEntry.create({ data });
      return 1;
    } catch (e) {
      if (isDup(e)) return 0;
      throw e;
    }
  };
  const lines = (...ls: LineInput[]) => {
    assertBalanced(ls);
    return { create: ls.map((l) => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, propertyId: l.propertyId ?? null, memo: l.memo ?? null })) };
  };

  const charges = await db.charge.findMany({ where: { journalEntry: null, amount: { gt: 0 } }, include: { lease: { include: { unit: true } } }, take: 5000 });
  for (const c of charges) {
    const propertyId = c.lease.unit.propertyId;
    counts.charges += await post({
      date: c.dueDate, source: "CHARGE", memo: c.description ?? c.type, charge: { connect: { id: c.id } },
      lines: lines({ accountId: id(arFor(c.party)), debit: c.amount, propertyId }, { accountId: id(creditAccountForCharge(c.type, c.party)), credit: c.amount, propertyId }),
    });
  }

  const payments = await db.payment.findMany({ where: { journalEntry: null, amount: { gt: 0 } }, include: { lease: { include: { unit: true } } }, take: 5000 });
  for (const p of payments) {
    const propertyId = p.lease.unit.propertyId;
    counts.payments += await post({
      date: p.paidOn, source: "PAYMENT", memo: `Payment received${p.reference ? ` #${p.reference}` : ""}`, payment: { connect: { id: p.id } },
      lines: lines({ accountId: id(CODES.BANK), debit: p.amount, propertyId }, { accountId: id(arFor(p.party)), credit: p.amount, propertyId }),
    });
  }

  // Voided bills come off the books entirely.
  counts.voided = (await db.journalEntry.deleteMany({ where: { bill: { status: "VOID" } } })).count;
  const bills = await db.bill.findMany({ where: { journalEntry: null, status: { not: "VOID" } }, include: { vendor: true } });
  for (const b of bills) {
    counts.bills += await post({
      date: b.billDate, source: "BILL", memo: `${b.vendor?.name ?? b.payee ?? "Bill"}: ${b.description}`, bill: { connect: { id: b.id } },
      lines: lines({ accountId: b.expenseAccountId, debit: b.amount, propertyId: b.propertyId }, { accountId: id(CODES.AP), credit: b.amount, propertyId: b.propertyId }),
    });
  }

  const bps = await db.billPayment.findMany({ where: { journalEntry: null }, include: { bill: { include: { vendor: true } } } });
  for (const bp of bps) {
    counts.billPayments += await post({
      date: bp.date, source: "BILL_PAYMENT", memo: `Paid ${bp.bill.vendor?.name ?? bp.bill.payee ?? "bill"}${bp.reference ? ` #${bp.reference}` : ""}`,
      billPayment: { connect: { id: bp.id } },
      lines: lines({ accountId: id(CODES.AP), debit: bp.amount, propertyId: bp.bill.propertyId }, { accountId: bp.bankAccountId, credit: bp.amount, propertyId: bp.bill.propertyId }),
    });
  }
  return counts;
}

/** Re-posts one bill after it's edited (amount, account, date, property). */
export async function repostBill(billId: string) {
  await db.journalEntry.deleteMany({ where: { billId } });
  await syncLedger();
}

export async function createManualEntry(opts: { date: Date; memo?: string | null; lines: LineInput[]; createdByEmail?: string; source?: "MANUAL" | "BANK" }) {
  assertBalanced(opts.lines);
  return db.journalEntry.create({
    data: {
      date: opts.date, memo: opts.memo ?? null, source: opts.source ?? "MANUAL", createdByEmail: opts.createdByEmail,
      lines: { create: opts.lines.map((l) => ({ accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, propertyId: l.propertyId ?? null, memo: l.memo ?? null })) },
    },
    include: { lines: true },
  });
}

/* ------------------------------------------------------------------------------------------------
 * Statements
 * ---------------------------------------------------------------------------------------------- */

export type AccountTotal = { id: string; code: string; name: string; type: AccountType; isBank: boolean; debit: number; credit: number; balance: number };

/** Debit/credit totals per account for entries dated in [from, to] (inclusive days). */
export async function accountTotals(opts: { from?: Date; to: Date; propertyId?: string | null }): Promise<AccountTotal[]> {
  const where: Prisma.JournalLineWhereInput = {
    entry: { date: { ...(opts.from ? { gte: opts.from } : {}), lt: addDays(opts.to, 1) } },
    ...(opts.propertyId ? { propertyId: opts.propertyId } : {}),
  };
  const [sums, accounts] = await Promise.all([
    db.journalLine.groupBy({ by: ["accountId"], where, _sum: { debit: true, credit: true } }),
    db.account.findMany({ orderBy: { code: "asc" } }),
  ]);
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const s = byId.get(a.id);
    const debit = s?.debit ?? 0;
    const credit = s?.credit ?? 0;
    return { id: a.id, code: a.code, name: a.name, type: a.type, isBank: a.isBank, debit, credit, balance: naturalBalance(a.type, debit, credit) };
  });
}

export async function trialBalance(asOf: Date, propertyId?: string | null) {
  const rows = (await accountTotals({ to: asOf, propertyId })).filter((r) => r.debit || r.credit);
  const shown = rows.map((r) => ({ ...r, dr: Math.max(0, r.debit - r.credit), cr: Math.max(0, r.credit - r.debit) }));
  const totalDr = shown.reduce((s, r) => s + r.dr, 0);
  const totalCr = shown.reduce((s, r) => s + r.cr, 0);
  return { rows: shown, totalDr, totalCr, balanced: totalDr === totalCr };
}

export async function profitAndLoss(from: Date, to: Date, propertyId?: string | null) {
  const rows = await accountTotals({ from, to, propertyId });
  const income = rows.filter((r) => r.type === "INCOME" && (r.debit || r.credit));
  const expenses = rows.filter((r) => r.type === "EXPENSE" && (r.debit || r.credit));
  const totalIncome = income.reduce((s, r) => s + r.balance, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.balance, 0);
  return { income, expenses, totalIncome, totalExpenses, netIncome: totalIncome - totalExpenses };
}

/** Assets = Liabilities + Equity, where equity includes all net income to date ("current earnings"). */
export async function balanceSheet(asOf: Date, propertyId?: string | null) {
  const rows = await accountTotals({ to: asOf, propertyId });
  const pick = (t: AccountType) => rows.filter((r) => r.type === t && (r.debit || r.credit));
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const earnings = rows.filter((r) => r.type === "INCOME").reduce((s, r) => s + r.balance, 0) - rows.filter((r) => r.type === "EXPENSE").reduce((s, r) => s + r.balance, 0);
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquity = equity.reduce((s, r) => s + r.balance, 0) + earnings;
  return { assets, liabilities, equity, earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

/** One account's activity with a running balance (in its natural direction). */
export async function accountLedger(accountId: string, from: Date, to: Date, propertyId?: string | null) {
  const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
  const base: Prisma.JournalLineWhereInput = { accountId, ...(propertyId ? { propertyId } : {}) };
  const opening = await db.journalLine.aggregate({ where: { ...base, entry: { date: { lt: from } } }, _sum: { debit: true, credit: true } });
  const lines = await db.journalLine.findMany({
    where: { ...base, entry: { date: { gte: from, lt: addDays(to, 1) } } },
    include: { entry: true, property: { select: { name: true } }, bankTransaction: { select: { id: true } } },
    orderBy: [{ entry: { date: "asc" } }, { createdAt: "asc" }],
  });
  let running = naturalBalance(account.type, opening._sum.debit ?? 0, opening._sum.credit ?? 0);
  const openingBalance = running;
  const rows = lines.map((l) => {
    running += naturalBalance(account.type, l.debit, l.credit);
    return { ...l, balance: running };
  });
  return { account, openingBalance, rows, closingBalance: running };
}

/** Refuse to delete a record whose journal entry is part of a finished bank reconciliation. */
export async function assertNotReconciled(where: { chargeId?: string; paymentId?: string; billId?: string; billPaymentId?: string; entryId?: string; leaseId?: string }) {
  const { leaseId, entryId, ...src } = where;
  const entryWhere: Prisma.JournalEntryWhereInput = entryId
    ? { id: entryId }
    : leaseId
      ? { OR: [{ charge: { leaseId } }, { payment: { leaseId } }] }
      : src;
  const locked = await db.journalLine.count({ where: { reconciliationId: { not: null }, entry: entryWhere } });
  if (locked) throw new Error("This is part of a finished bank reconciliation, so it can't be deleted. Record a correcting entry instead.");
}
