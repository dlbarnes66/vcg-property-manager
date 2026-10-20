// Phase 1: tasks, calendar, iCal, messaging rules. Runs against DATABASE_URL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { nextOccurrence, zonedToUtc, utcToZonedInput, zonedDay } from "../src/lib/dates";
import { completeTask } from "../src/lib/tasks";
import { calendarItems } from "../src/lib/calendar";
import { buildIcs } from "../src/lib/ics";
import { renderTemplate, smsKeyword, smsSegments, toE164, twilioSignature, validTwilioSignature } from "../src/lib/messaging-core";
import { resolveRecipients, sendToAudience } from "../src/lib/messaging";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};

before(async () => {
  const p = await db.property.create({ data: { name: "__ops test", street: "1", city: "x", state: "AL", zip: "1" } });
  const u1 = await db.unit.create({ data: { propertyId: p.id, label: "O1" } });
  const u2 = await db.unit.create({ data: { propertyId: p.id, label: "O2" } });
  const u3 = await db.unit.create({ data: { propertyId: p.id, label: "O3" } });
  const ok = await db.tenant.create({ data: { firstName: "__Ok", lastName: "Texter", email: "ok@example.test", phone: "(251) 555-0001", smsConsent: true } });
  const no = await db.tenant.create({ data: { firstName: "__No", lastName: "Consent", email: "no@example.test", phone: "251-555-0002", emailOptOut: true } });
  const bare = await db.tenant.create({ data: { firstName: "__Bare", lastName: "Contact", caseManagerName: "Case Mgr", caseManagerEmail: "cm@example.test" } });
  for (const [u, t, rent] of [[u1, ok, 30000], [u2, no, 25000], [u3, bare, 20000]] as const)
    await db.lease.create({ data: { unitId: u.id, tenantId: t.id, startDate: d("2031-01-01"), endDate: d("2031-12-31"), contractRent: rent, tenantPortion: rent, dueDay: 5, nextRecertDate: d("2031-03-10") } });
  Object.assign(ctx, { property: p.id, ok: ok.id, no: no.id, bare: bare.id });
});

after(async () => {
  await db.message.deleteMany({ where: { OR: [{ tenantId: { in: [ctx.ok, ctx.no, ctx.bare] } }, { body: { startsWith: "__" } }] } });
  await db.task.deleteMany({ where: { title: { startsWith: "__" } } });
  await db.calendarEvent.deleteMany({ where: { title: { startsWith: "__" } } });
  await db.lease.deleteMany({ where: { unit: { propertyId: ctx.property } } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.deleteMany({ where: { id: { in: [ctx.ok, ctx.no, ctx.bare] } } });
  await db.$disconnect();
});

test("recurrence: weekly, month-end stays month-end, mid-month clamps", () => {
  const iso = (x: Date | null) => x?.toISOString().slice(0, 10);
  assert.equal(iso(nextOccurrence(d("2031-01-28"), "WEEKLY")), "2031-02-04");
  assert.equal(iso(nextOccurrence(d("2031-01-31"), "MONTHLY")), "2031-02-28");
  assert.equal(iso(nextOccurrence(d("2031-02-28"), "MONTHLY")), "2031-03-31");
  assert.equal(iso(nextOccurrence(d("2031-01-15"), "QUARTERLY")), "2031-04-15");
  assert.equal(iso(nextOccurrence(d("2032-02-29"), "YEARLY")), "2033-02-28");
  assert.equal(nextOccurrence(d("2031-01-15"), "NONE"), null);
});

test("time zones: wall clock in New York ↔ UTC, across DST", () => {
  assert.equal(zonedToUtc("2031-07-01T09:00", "America/New_York").toISOString(), "2031-07-01T13:00:00.000Z"); // EDT
  assert.equal(zonedToUtc("2031-12-01T09:00", "America/New_York").toISOString(), "2031-12-01T14:00:00.000Z"); // EST
  assert.equal(utcToZonedInput(new Date("2031-12-01T14:00:00Z"), "America/New_York"), "2031-12-01T09:00");
  // 11pm in New York is already tomorrow in UTC, but it belongs on today's calendar square
  assert.equal(zonedDay(new Date("2031-12-02T04:00:00Z"), "America/New_York").toISOString().slice(0, 10), "2031-12-01");
});

test("completing a repeating task creates the next one exactly once", async () => {
  const t = await db.task.create({ data: { title: "__Monthly filter check", dueDate: d("2031-01-31"), recurrence: "MONTHLY", propertyId: ctx.property } });
  const r1 = await completeTask(t.id);
  assert.equal(r1.next?.dueDate?.toISOString().slice(0, 10), "2031-02-28");
  assert.equal(r1.next?.propertyId, ctx.property);
  await db.task.update({ where: { id: t.id }, data: { status: "TODO", completedAt: null } });
  await completeTask(t.id); // reopen + complete again
  assert.equal(await db.task.count({ where: { title: "__Monthly filter check" } }), 2);
});

test("calendar combines events, tasks, leases, recerts, and rent due days", async () => {
  await db.calendarEvent.create({ data: { title: "__Showing", start: zonedToUtc("2031-03-04T23:30", "America/New_York"), type: "SHOWING" } });
  await db.task.create({ data: { title: "__Call PHA", dueDate: d("2031-03-05") } });
  const items = (await calendarItems(d("2031-03-01"), d("2031-03-31"), "America/New_York")).filter(
    (i) => i.title.startsWith("__") || i.title.includes("__") || i.kind === "rent",
  );
  const showing = items.find((i) => i.title === "__Showing");
  assert.equal(showing?.day.toISOString().slice(0, 10), "2031-03-04"); // 11:30pm local stays on the 4th
  assert.ok(items.some((i) => i.kind === "task" && i.title === "__Call PHA"));
  const rent = items.find((i) => i.kind === "rent" && i.day.toISOString().startsWith("2031-03-05"));
  assert.ok(rent && /3 leases/.test(rent.title), "three test leases are due on the 5th");
  const recerts = (await calendarItems(d("2031-03-10"), d("2031-03-10"))).filter((i) => i.kind === "recert" && i.title.includes("__"));
  assert.equal(recerts.length, 3);

  const ics = buildIcs(items, { name: "Test, calendar", appUrl: "https://example.test", now: new Date("2031-01-01T00:00:00Z") });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("X-WR-CALNAME:Test\\, calendar"));
  assert.ok(ics.includes("DTSTART:20310305T043000Z"), "timed event in UTC");
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "lines folded to 75 octets");
});

test("phone, templates, segments, keywords", () => {
  assert.equal(toE164("(251) 555-0001"), "+12515550001");
  assert.equal(toE164("1-251-555-0001"), "+12515550001");
  assert.equal(toE164("555-0001"), null);
  const r = renderTemplate("Hi {{firstName}}, you owe {{ balance }} {{unknown}}", { firstName: "Ana", balance: "$5.00" });
  assert.equal(r.text, "Hi Ana, you owe $5.00 ");
  assert.deepEqual(r.missing, ["unknown"]);
  assert.equal(smsSegments("a".repeat(160)), 1);
  assert.equal(smsSegments("a".repeat(161)), 2);
  assert.equal(smsSegments("Rent due 🏠"), 1);
  assert.equal(smsKeyword(" stop "), "stop");
  assert.equal(smsKeyword("Start"), "start");
  assert.equal(smsKeyword("stop by tomorrow"), null);
});

test("Twilio signature: matches Twilio's documented example and rejects tampering", () => {
  // Example from Twilio's security docs (cross-checked against the official twilio library)
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  assert.equal(twilioSignature(token, url, params), "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  assert.ok(validTwilioSignature(token, url, params, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="));
  assert.ok(!validTwilioSignature(token, url, { ...params, Digits: "9999" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ="));
  assert.ok(!validTwilioSignature(token, url, params, null));
});

test("recipients: text consent, announcement opt-out, case managers", async () => {
  const sms = await resolveRecipients({ kind: "property", id: ctx.property }, "SMS");
  assert.deepEqual(sms.recipients.map((r) => r.address), ["+12515550001"]);
  assert.ok(sms.skipped.some((s) => s.name.startsWith("__No") && /agreed to texts/.test(s.reason)));
  assert.ok(sms.skipped.some((s) => s.name.startsWith("__Bare")));

  const email = await resolveRecipients({ kind: "property", id: ctx.property }, "EMAIL");
  assert.deepEqual(email.recipients.map((r) => r.address), ["ok@example.test"]);
  assert.ok(email.skipped.some((s) => s.name.startsWith("__No") && /opted out/.test(s.reason)));

  // A direct email still reaches someone who opted out of announcements
  const direct = await resolveRecipients({ kind: "tenant", id: ctx.no }, "EMAIL");
  assert.equal(direct.recipients[0]?.address, "no@example.test");
  // …but a direct text never goes without consent
  const directSms = await resolveRecipients({ kind: "tenant", id: ctx.no }, "SMS");
  assert.equal(directSms.recipients.length, 0);

  const cm = await resolveRecipients({ kind: "case-manager", id: ctx.bare }, "EMAIL");
  assert.equal(cm.recipients[0]?.address, "cm@example.test");
  assert.equal(cm.recipients[0]?.tenantId, ctx.bare);
  assert.equal(cm.recipients[0]?.vars.rent, "$200.00");
});

test("sending: saves every message first, merges fields, records provider failures", async () => {
  const realFetch = globalThis.fetch;
  process.env.SENDGRID_API_KEY = "SG.test";
  process.env.SENDGRID_FROM_EMAIL = "pm@example.test";
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body.personalizations[0].to[0].email);
    if (body.personalizations[0].to[0].email === "ok@example.test") return new Response(null, { status: 202, headers: { "x-message-id": "sg-test-1" } });
    return new Response(JSON.stringify({ errors: [{ message: "bounced" }] }), { status: 400 });
  }) as typeof fetch;
  try {
    const out = await sendToAudience({
      audience: { kind: "tenant", id: ctx.ok }, channel: "EMAIL", subject: "Rent for {{unit}}", body: "__Hi {{firstName}}, rent is {{rent}}.", sentByEmail: "admin@example.test",
    });
    assert.equal(out.sent, 1);
    const m = await db.message.findFirstOrThrow({ where: { batchId: out.batchId } });
    assert.equal(m.status, "SENT");
    assert.equal(m.subject, "Rent for O1");
    assert.equal(m.body, "__Hi __Ok, rent is $300.00.");
    assert.equal(m.providerMessageId, "sg-test-1");

    const bad = await sendToAudience({ audience: { kind: "tenant", id: ctx.no }, channel: "EMAIL", subject: "x", body: "__x", sentByEmail: "a@example.test" });
    assert.equal(bad.sent, 0);
    assert.match(bad.failed[0].error, /bounced/);
    assert.equal((await db.message.findFirstOrThrow({ where: { batchId: bad.batchId } })).status, "FAILED");
    assert.deepEqual(calls, ["ok@example.test", "no@example.test"]);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_FROM_EMAIL;
  }
});
