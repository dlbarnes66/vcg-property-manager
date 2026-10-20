// Accounting: automatic posting, statements, bank import, matching, reconciliation. Runs against DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { CODES, assertBalanced, balanceSheet, createManualEntry, profitAndLoss, syncLedger, trialBalance, accountLedger } from "../src/lib/accounting";
import { categorizeTransaction, finishReconciliation, importBankRows, matchTransaction, parseBankCsv, parseMoney, reconciliationStatus, setCleared, splitCsv, suggestMatches, unmatchTransaction } from "../src/lib/banking";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};
let acct: (code: string) => string;
const FAR = d("2099-12-31");

before(async () => {
  // Isolated books: these tests own the journal (the test database is reseeded before runs).
  // Post whatever already exists (demo data), so the numbers below only reflect this test's records.
  // Statements are checked with the property filter; bank tests use a separate test bank account.
  await syncLedger();
  const accts = await db.account.findMany();
  acct = (code) => accts.find((a) => a.code === code)!.id;
  const testBank = await db.account.upsert({ where: { code: "1099" }, update: {}, create: { code: "1099", name: "__Test Bank", type: "ASSET", isBank: true } });
  ctx.testBank = testBank.id;

  const p = await db.property.create({ data: { name: "__acct test", street: "1", city: "x", state: "AL", zip: "1" } });
  const u = await db.unit.create({ data: { propertyId: p.id, label: "A1" } });
  const t = await db.tenant.create({ data: { firstName: "__Acct", lastName: "Tenant" } });
  const l = await db.lease.create({ data: { unitId: u.id, tenantId: t.id, startDate: d("2032-01-01"), contractRent: 100000, tenantPortion: 30000, hapAmount: 70000 } });
  const v = await db.vendor.create({ data: { name: "__Plumber" } });
  Object.assign(ctx, { property: p.id, lease: l.id, tenant: t.id, vendor: v.id });
});

after(async () => {
  await db.bankTransaction.deleteMany({ where: { accountId: ctx.testBank } });
  await db.reconciliation.deleteMany({ where: { accountId: ctx.testBank } });
  await db.bill.deleteMany({ where: { vendorId: ctx.vendor } });
  await db.journalEntry.deleteMany({ where: { lines: { some: { OR: [{ propertyId: ctx.property }, { accountId: ctx.testBank }] } } } });
  await db.account.delete({ where: { id: ctx.testBank } });
  await db.lease.deleteMany({ where: { id: ctx.lease } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.delete({ where: { id: ctx.tenant } });
  await db.vendor.delete({ where: { id: ctx.vendor } });
  await db.$disconnect();
});

const linesOf = async (where: object) =>
  (await db.journalEntry.findFirstOrThrow({ where, include: { lines: { include: { account: true } } } })).lines
    .map((l) => `${l.account.code} ${l.debit ? "Dr" : "Cr"} ${l.debit || l.credit}`)
    .sort();

test("assertBalanced rejects bad entries", () => {
  assert.throws(() => assertBalanced([{ accountId: "a", debit: 100 }]), /two lines/);
  assert.throws(() => assertBalanced([{ accountId: "a", debit: 100 }, { accountId: "b", credit: 90 }]), /must equal/);
  assert.throws(() => assertBalanced([{ accountId: "a", debit: 100, credit: 100 }, { accountId: "b", credit: 0 }]), /either a debit or a credit/);
  assertBalanced([{ accountId: "a", debit: 100 }, { accountId: "b", credit: 60 }, { accountId: "c", credit: 40 }]);
});

test("charges, payments, deposits, bills post with the right accounts — once", async () => {
  const L = ctx.lease;
  const [rentT, rentH, dep, late] = await Promise.all([
    db.charge.create({ data: { leaseId: L, type: "RENT", party: "TENANT", amount: 30000, dueDate: d("2032-01-01"), period: "2032-01" } }),
    db.charge.create({ data: { leaseId: L, type: "RENT", party: "HOUSING_AUTHORITY", amount: 70000, dueDate: d("2032-01-01"), period: "2032-01" } }),
    db.charge.create({ data: { leaseId: L, type: "SECURITY_DEPOSIT", party: "TENANT", amount: 30000, dueDate: d("2032-01-01") } }),
    db.charge.create({ data: { leaseId: L, type: "LATE_FEE", party: "TENANT", amount: 2500, dueDate: d("2032-01-10"), period: "2032-01" } }),
  ]);
  const payH = await db.payment.create({ data: { leaseId: L, party: "HOUSING_AUTHORITY", amount: 70000, paidOn: d("2032-01-03") } });
  const payT = await db.payment.create({ data: { leaseId: L, party: "TENANT", amount: 30000, paidOn: d("2032-01-04") } });
  const bill = await db.bill.create({ data: { vendorId: ctx.vendor, propertyId: ctx.property, expenseAccountId: acct(CODES.REPAIRS), billDate: d("2032-01-05"), amount: 15000, description: "Leak" } });
  const bp = await db.billPayment.create({ data: { billId: bill.id, bankAccountId: acct(CODES.BANK), date: d("2032-01-06"), amount: 15000 } });

  const c1 = await syncLedger();
  assert.deepEqual([c1.charges, c1.payments, c1.bills, c1.billPayments], [4, 2, 1, 1]);
  const c2 = await Promise.all([syncLedger(), syncLedger()]); // concurrent re-runs add nothing
  assert.ok(c2.every((c) => c.charges + c.payments + c.bills + c.billPayments === 0));

  assert.deepEqual(await linesOf({ chargeId: rentT.id }), ["1200 Dr 30000", "4000 Cr 30000"]);
  assert.deepEqual(await linesOf({ chargeId: rentH.id }), ["1210 Dr 70000", "4010 Cr 70000"]);
  assert.deepEqual(await linesOf({ chargeId: dep.id }), ["1200 Dr 30000", "2100 Cr 30000"], "deposit is a liability, not income");
  assert.deepEqual(await linesOf({ chargeId: late.id }), ["1200 Dr 2500", "4100 Cr 2500"]);
  assert.deepEqual(await linesOf({ paymentId: payH.id }), ["1000 Dr 70000", "1210 Cr 70000"]);
  assert.deepEqual(await linesOf({ paymentId: payT.id }), ["1000 Dr 30000", "1200 Cr 30000"]);
  assert.deepEqual(await linesOf({ billId: bill.id }), ["2000 Cr 15000", "5000 Dr 15000"]);
  assert.deepEqual(await linesOf({ billPaymentId: bp.id }), ["1000 Cr 15000", "2000 Dr 15000"]);
  ctx.late = late.id;
  ctx.bill = bill.id;
});

test("statements: P&L, balance sheet, and trial balance tie out", async () => {
  const P = ctx.property;
  await createManualEntry({ date: d("2031-12-31"), memo: "Opening balance", lines: [{ accountId: acct(CODES.BANK), debit: 500000, propertyId: P }, { accountId: acct(CODES.EQUITY), credit: 500000, propertyId: P }] });
  const pl = await profitAndLoss(d("2032-01-01"), d("2032-01-31"), P);
  assert.equal(pl.totalIncome, 30000 + 70000 + 2500);
  assert.equal(pl.totalExpenses, 15000);
  assert.equal(pl.netIncome, 87500);

  const bs = await balanceSheet(d("2032-01-31"), P);
  assert.ok(bs.balanced, "assets = liabilities + equity");
  assert.ok((await balanceSheet(d("2032-01-31"))).balanced, "whole company balances too");
  // Bank 5000 + 700 + 300 − 150 = 5850; AR tenant 300 dep + 25 late = 325
  assert.equal(bs.assets.find((a) => a.code === "1000")?.balance, 585000);
  assert.equal(bs.assets.find((a) => a.code === "1200")?.balance, 32500);
  assert.equal(bs.liabilities.find((a) => a.code === "2100")?.balance, 30000);
  assert.equal(bs.earnings, 87500);

  assert.ok((await trialBalance(d("2032-01-31"))).balanced);
  assert.ok((await trialBalance(d("2032-01-31"), P)).balanced);

  const ledger = await accountLedger(acct(CODES.BANK), d("2032-01-01"), d("2032-01-31"), P);
  assert.equal(ledger.openingBalance, 500000);
  assert.equal(ledger.closingBalance, 585000);
});

test("deleting a charge removes its entry; voiding a bill takes it off the books", async () => {
  await db.charge.delete({ where: { id: ctx.late } });
  assert.equal(await db.journalEntry.count({ where: { chargeId: ctx.late } }), 0);
  await db.billPayment.deleteMany({ where: { billId: ctx.bill } });
  await db.bill.update({ where: { id: ctx.bill }, data: { status: "VOID" } });
  const r = await syncLedger();
  assert.equal(r.voided, 1);
  const pl = await profitAndLoss(d("2032-01-01"), d("2032-01-31"), ctx.property);
  assert.equal(pl.totalExpenses, 0);
  assert.equal(pl.totalIncome, 100000);
  assert.ok((await balanceSheet(d("2032-01-31"), ctx.property)).balanced);
});

test("CSV parsing: signed amounts, parentheses, debit/credit columns, preamble, quotes", () => {
  assert.equal(parseMoney("$1,234.56"), 123456);
  assert.equal(parseMoney("(12.00)"), -1200);
  assert.equal(parseMoney("-5"), -500);
  assert.equal(parseMoney("abc"), null);
  assert.deepEqual(splitCsv('a,"b, c","say ""hi"""\r\n1,2,3'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);

  const chase = parseBankCsv("Details,Posting Date,Description,Amount,Type,Balance\nCREDIT,01/03/2032,HAP DEPOSIT MOBILE HA,700.00,ACH_CREDIT,\nDEBIT,1/6/32,\"PLUMBER, LLC\",-150.00,ACH_DEBIT,\n");
  assert.deepEqual(chase.errors, []);
  assert.deepEqual(chase.rows.map((r) => [r.date.toISOString().slice(0, 10), r.description, r.amount]), [["2032-01-03", "HAP DEPOSIT MOBILE HA", 70000], ["2032-01-06", "PLUMBER, LLC", -15000]]);

  const split = parseBankCsv("Account: 1234\nExported 2032-02-01\n\nDate,Memo,Withdrawals,Deposits\n2032-01-04,Rent,,300.00\n2032-01-31,Service fee,12.00,\nbad,row,,\n");
  assert.deepEqual(split.rows.map((r) => r.amount), [30000, -1200]);
  assert.equal(split.errors.length, 1);

  assert.match(parseBankCsv("foo,bar\n1,2").errors[0], /header row/);
});

test("bank import dedupes; matching, categorizing, reconciling", async () => {
  const bank = ctx.testBank;
  // Book side: opening balance plus two deposits recorded in the books
  await createManualEntry({ date: d("2031-12-31"), memo: "Opening balance", lines: [{ accountId: bank, debit: 500000 }, { accountId: acct(CODES.EQUITY), credit: 500000 }] });
  await createManualEntry({ date: d("2032-01-02"), memo: "HAP", lines: [{ accountId: bank, debit: 70000 }, { accountId: acct(CODES.AR_HAP), credit: 70000 }] });
  await createManualEntry({ date: d("2032-01-04"), memo: "Rent", lines: [{ accountId: bank, debit: 30000 }, { accountId: acct(CODES.AR_TENANT), credit: 30000 }] });

  const csv = "Date,Description,Amount\n01/03/2032,HAP DEPOSIT,700.00\n01/04/2032,RENT,300.00\n01/31/2032,SERVICE FEE,-12.00\n01/31/2032,SERVICE FEE,-12.00\n";
  const { rows } = parseBankCsv(csv);
  assert.deepEqual(await importBankRows(bank, rows), { imported: 4, duplicates: 0 }, "identical rows in one statement are both kept");
  assert.deepEqual(await importBankRows(bank, rows), { imported: 0, duplicates: 4 }, "re-importing adds nothing");
  await assert.rejects(importBankRows(acct(CODES.REPAIRS), rows), /bank account/);

  const txns = await db.bankTransaction.findMany({ where: { accountId: bank } });
  const hap = txns.find((t) => t.amount === 70000)!;
  const sugg = await suggestMatches(hap);
  assert.equal(sugg.length, 1, "one book entry within a week with the same amount");
  await matchTransaction(hap.id, sugg[0].id);
  await assert.rejects(matchTransaction(hap.id, sugg[0].id), /already/);

  const rent = txns.find((t) => t.amount === 30000)!;
  await matchTransaction(rent.id, (await suggestMatches(rent))[0].id);
  for (const f of txns.filter((t) => t.amount === -1200)) await categorizeTransaction(f.id, { accountId: acct("5800"), memo: "Bank fee" });

  // Statement: 5000 + 700 + 300 − 24 = 5976
  let st = await reconciliationStatus(bank, d("2032-01-31"), 597600);
  assert.equal(st.difference, 500000, "opening balance not cleared yet");
  assert.equal(st.bookBalance, 597600);
  await assert.rejects(finishReconciliation(bank, d("2032-01-31"), 597600), /off by/);
  await setCleared(st.outstanding.find((l) => l.entry.memo === "Opening balance")!.id, true);
  st = await reconciliationStatus(bank, d("2032-01-31"), 597600);
  assert.equal(st.difference, 0);
  await finishReconciliation(bank, d("2032-01-31"), 597600);
  await assert.rejects(unmatchTransaction(hap.id), /locked/);
  assert.equal(await db.journalLine.count({ where: { accountId: bank, reconciliationId: { not: null } } }), 5);
});
