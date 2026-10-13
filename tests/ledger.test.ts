// Run: npm test   (uses Node's built-in test runner via tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePartyLedger, dueDateFor, leaseCoversPeriod } from "../src/lib/ledger";
import { toCents, periodBounds } from "../src/lib/utils";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const T = "TENANT" as const;
const H = "HOUSING_AUTHORITY" as const;

test("toCents parses currency safely", () => {
  assert.equal(toCents("$1,234.50"), 123450);
  assert.equal(toCents("0.1"), 10);
  assert.equal(toCents("19.999"), 2000);
  assert.equal(toCents(""), null);
  assert.throws(() => toCents("abc"));
});

test("due date clamps to month end", () => {
  assert.equal(dueDateFor("2026-02", 31).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(dueDateFor("2028-02", 31).toISOString().slice(0, 10), "2028-02-29");
  assert.equal(dueDateFor("2026-10", 1).toISOString().slice(0, 10), "2026-10-01");
  assert.equal(periodBounds("2026-12").end.toISOString().slice(0, 10), "2026-12-31");
});

test("lease coverage by period", () => {
  const l = { status: "ACTIVE" as const, startDate: d("2026-03-15"), endDate: d("2026-06-10") };
  assert.equal(leaseCoversPeriod(l, "2026-02"), false);
  assert.equal(leaseCoversPeriod(l, "2026-03"), true);
  assert.equal(leaseCoversPeriod(l, "2026-06"), true);
  assert.equal(leaseCoversPeriod(l, "2026-07"), false);
  assert.equal(leaseCoversPeriod({ ...l, status: "ENDED" }, "2026-04"), false);
});

test("tenant and HAP balances are independent", () => {
  const charges = [
    { party: T, amount: 30000, dueDate: d("2026-09-01") },
    { party: H, amount: 70000, dueDate: d("2026-09-01") },
  ];
  // HAP paid in full; tenant paid nothing → tenant owes, HAP doesn't, and HAP money never covers tenant debt
  const payments = [{ party: H, amount: 70000 }];
  const asOf = d("2026-09-20");
  const t = computePartyLedger(T, charges, payments, asOf);
  const h = computePartyLedger(H, charges, payments, asOf);
  assert.equal(t.pastDue, 30000);
  assert.equal(h.pastDue, 0);
  assert.equal(h.balance, 0);
});

test("FIFO allocation and aging buckets", () => {
  const charges = [
    { party: T, amount: 10000, dueDate: d("2026-06-01") },
    { party: T, amount: 10000, dueDate: d("2026-07-01") },
    { party: T, amount: 10000, dueDate: d("2026-08-01") },
    { party: T, amount: 10000, dueDate: d("2026-09-01") },
    { party: T, amount: 10000, dueDate: d("2026-10-01") },
    { party: T, amount: 10000, dueDate: d("2026-11-01") }, // future: not past due
  ];
  const payments = [{ party: T, amount: 15000 }]; // covers June + half of July
  const r = computePartyLedger(T, charges, payments, d("2026-10-12"));
  assert.equal(r.balance, 45000);
  assert.equal(r.pastDue, 35000); // half July + Aug + Sep + Oct
  assert.equal(r.oldestPastDue?.toISOString().slice(0, 10), "2026-07-01");
  assert.equal(r.aging.d30, 10000); // Oct 1 (11 days) 
  assert.equal(r.aging.d60, 10000); // Sep 1 (41 days)
  assert.equal(r.aging.d90, 10000); // Aug 1 (72 days)
  assert.equal(r.aging.over90, 5000); // half of Jul 1 (103 days)
});

test("overpayment becomes a credit, not past due", () => {
  const r = computePartyLedger(T, [{ party: T, amount: 10000, dueDate: d("2026-10-01") }], [{ party: T, amount: 12500 }], d("2026-10-12"));
  assert.equal(r.balance, -2500);
  assert.equal(r.pastDue, 0);
});
