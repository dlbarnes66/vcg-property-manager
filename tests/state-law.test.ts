// State Law Guide: complete, consistent data, and wired into form drafting and the AI assistant.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { runTool } from "../src/lib/ai/tools";
import { formType } from "../src/lib/forms/catalog";
import { userPrompt } from "../src/lib/forms/prompt";
import { STATE_LAWS, stateLaw, stateLawSummary, statutesUrl } from "../src/lib/state-law";
import { STATES } from "../src/lib/states";

after(() => db.$disconnect());

test("every state + DC has one complete entry", () => {
  assert.equal(STATE_LAWS.length, 51);
  assert.deepEqual(STATE_LAWS.map((s) => s.code).sort(), STATES.map((s) => s.code).sort());
  for (const s of STATE_LAWS) {
    const fields = [s.deposit.max, s.deposit.returnBy, s.deposit.cite, s.lateFee.rule, s.lateFee.grace, s.lateFee.cite, s.nonpayment.text, s.nonpayment.cite, s.monthToMonth.landlord, s.monthToMonth.tenant, s.entry.text, s.soi.text];
    for (const f of fields) assert.ok(f && f.trim().length > 0, `${s.code} has an empty field`);
    assert.ok(["yes", "limited", "no", "preempted"].includes(s.soi.status), s.code);
  }
});

test("spot checks on recent changes", () => {
  assert.match(stateLaw("GA")!.nonpayment.text, /3 business days/);
  assert.match(stateLaw("GA")!.deposit.max, /2 months/);
  assert.match(stateLaw("VA")!.nonpayment.text, /14 days/);
  assert.match(stateLaw("HI")!.nonpayment.text, /10 calendar days/);
  assert.match(stateLaw("CO")!.deposit.max, /2 months/);
  assert.match(stateLaw("CA")!.deposit.max, /1 month/);
  assert.match(stateLaw("AL")!.nonpayment.text, /7 business days/);
  assert.match(stateLaw("NC")!.lateFee.rule, /\$15 or 5%/);
  assert.equal(stateLaw("DE")!.soi.status, "yes");
  assert.equal(stateLaw("TX")!.soi.status, "preempted");
});

test("summary for the AI and the statutes link", () => {
  const s = stateLawSummary("NC")!;
  assert.match(s, /N\.C\. Gen\. Stat\. § 42-46/);
  assert.match(s, /trust account/);
  assert.equal(stateLawSummary("ZZ"), null);
  assert.equal(statutesUrl("North Carolina"), "https://law.justia.com/codes/north-carolina/");
  const prompt = userPrompt({ form: formType("pay-or-quit")!, state: "NC", facts: {}, today: "2026-10-20" });
  assert.match(prompt, /<state_reference>[\s\S]*10-day demand[\s\S]*<\/state_reference>/);
});

test("the assistant can look up a state", async () => {
  const r = (await runTool("state_law", { state: "north carolina" }, { proposedBy: "t" })) as { state: string; link: string; deposit: { max: string } };
  assert.equal(r.state, "North Carolina");
  assert.equal(r.link, "/resources/states/NC");
  assert.match(r.deposit.max, /2 months/);
  assert.deepEqual(await runTool("state_law", { state: "Atlantis" }, { proposedBy: "t" }), { error: "Unknown state" });
});
