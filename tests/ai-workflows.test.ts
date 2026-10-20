// Phase 3: agent actions (approval-only), the Claude tool loop (with a fake client), workflows, cron auth.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../src/lib/db";
import { approveAndExecute, proposeAction, rejectAction } from "../src/lib/agent-actions";
import { chatTurn, runAssistant, type MessagesClient } from "../src/lib/ai/assistant";
import { runAllWorkflows, runWorkflow, validateWorkflow } from "../src/lib/workflows";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ctx: Record<string, string> = {};

before(async () => {
  const p = await db.property.create({ data: { name: "__ai test", street: "1", city: "x", state: "AL", zip: "1" } });
  const u = await db.unit.create({ data: { propertyId: p.id, label: "Z1" } });
  const t = await db.tenant.create({ data: { firstName: "__Zed", lastName: "Quill", email: "zed@example.test", phone: "251-555-0444", smsConsent: false } });
  const l = await db.lease.create({ data: { unitId: u.id, tenantId: t.id, startDate: d("2033-01-01"), contractRent: 80000, tenantPortion: 20000, hapAmount: 60000, dueDay: 1 } });
  await db.charge.create({ data: { leaseId: l.id, type: "RENT", party: "TENANT", amount: 20000, dueDate: d("2033-03-01"), period: "2033-03" } });
  const tpl = await db.messageTemplate.create({ data: { name: "__sms tpl", channel: "SMS", body: "Hi {{firstName}}, rent {{rent}} due {{dueDate}}" } });
  Object.assign(ctx, { property: p.id, unit: u.id, tenant: t.id, lease: l.id, tpl: tpl.id });
});

after(async () => {
  await db.agentAction.deleteMany({ where: { OR: [{ proposedBy: { startsWith: "__" } }, { workflow: { name: { startsWith: "__" } } }, { summary: { contains: "__" } }, { conversation: { title: { startsWith: "__" } } }] } });
  await db.workflow.deleteMany({ where: { name: { startsWith: "__" } } });
  await db.aiConversation.deleteMany({ where: { title: { startsWith: "__" } } });
  await db.task.deleteMany({ where: { OR: [{ title: { startsWith: "__" } }, { propertyId: ctx.property }, { tenantId: ctx.tenant }] } });
  await db.messageTemplate.deleteMany({ where: { name: { startsWith: "__" } } });
  await db.journalEntry.deleteMany({ where: { OR: [{ payment: { leaseId: ctx.lease } }, { charge: { leaseId: ctx.lease } }] } });
  await db.lease.deleteMany({ where: { id: ctx.lease } });
  await db.property.delete({ where: { id: ctx.property } });
  await db.tenant.delete({ where: { id: ctx.tenant } });
  await db.$disconnect();
});

test("proposals are validated, named, and never run on their own", async () => {
  await assert.rejects(proposeAction("SEND_MESSAGE", { audience: { kind: "tenant", id: ctx.tenant }, channel: "EMAIL", body: "x" }, { proposedBy: "__t" }), /subject/);
  await assert.rejects(proposeAction("CREATE_TASK", { title: "x", links: { tenantId: "nope" } }, { proposedBy: "__t" }), /doesn't exist/);
  await assert.rejects(proposeAction("CREATE_TASK", { title: "x", sneaky: true }, { proposedBy: "__t" }), /Invalid/);
  await assert.rejects(proposeAction("RECORD_PAYMENT", { leaseId: ctx.lease, party: "TENANT", amountCents: -5, paidOn: "2033-03-02", method: "ACH" }, { proposedBy: "__t" }), /Invalid/);

  const a = await proposeAction("CREATE_TASK", { title: "__Call Zed", links: { tenantId: ctx.tenant } }, { proposedBy: "__t" });
  assert.equal(a.status, "PROPOSED");
  assert.match(a.summary, /__Call Zed/);
  assert.equal(await db.task.count({ where: { title: "__Call Zed" } }), 0, "nothing happens until approved");

  const done = await approveAndExecute(a.id, "owner@example.test");
  assert.equal(done.status, "EXECUTED");
  assert.equal(await db.task.count({ where: { title: "__Call Zed", tenantId: ctx.tenant } }), 1);
  await assert.rejects(approveAndExecute(a.id, "owner@example.test"), /already/);
  assert.equal(await db.task.count({ where: { title: "__Call Zed" } }), 1, "double approval can't run it twice");

  const b = await proposeAction("ADD_NOTE", { body: "__note", links: { tenantId: ctx.tenant } }, { proposedBy: "__t" });
  await rejectAction(b.id, "owner@example.test");
  await assert.rejects(approveAndExecute(b.id, "owner@example.test"), /already/);
  assert.equal(await db.note.count({ where: { body: "__note" } }), 0);

  const pay = await proposeAction("RECORD_PAYMENT", { leaseId: ctx.lease, party: "TENANT", amountCents: 20000, paidOn: "2033-03-02", method: "CHECK" }, { proposedBy: "__t" });
  assert.match(pay.summary, /\$200\.00 from __Zed Quill/);
  await approveAndExecute(pay.id, "owner@example.test");
  const p = await db.payment.findFirstOrThrow({ where: { leaseId: ctx.lease } });
  assert.ok(await db.journalEntry.findUnique({ where: { paymentId: p.id } }), "approved payment is posted to the books");
  await db.payment.delete({ where: { id: p.id } });

  const sms = await proposeAction("SEND_MESSAGE", { audience: { kind: "tenant", id: ctx.tenant }, channel: "SMS", body: "hi" }, { proposedBy: "__t" });
  const r = await approveAndExecute(sms.id, "owner@example.test");
  assert.equal(r.status, "FAILED", "a text to a tenant without consent fails safely");
  assert.match(r.error ?? "", /agreed to texts|isn't set up/);
});

/** A scripted stand-in for Claude: returns the given responses in order and records requests. */
function fakeClaude(responses: Partial<Anthropic.Message>[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (p) => {
        calls.push(structuredClone(p));
        const r = responses.shift();
        if (!r) throw new Error("no more scripted responses");
        return { id: "m", type: "message", role: "assistant", model: "fake", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 }, ...r } as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

test("assistant loop: reads with tools, proposes instead of acting, feeds results back", async () => {
  const { client, calls } = fakeClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "search", input: { query: "__Zed" } }] as never },
    { stop_reason: "tool_use", content: [{ type: "text", text: "Drafting a task." }, { type: "tool_use", id: "t2", name: "propose_create_task", input: { title: "__Follow up with Zed", links: { tenantId: ctx.tenant }, reason: "past due" } }] as never },
    { stop_reason: "end_turn", content: [{ type: "text", text: "I drafted a follow-up task for your approval." }] as never },
  ]);
  const events: string[] = [];
  const r = await runAssistant({ history: [], message: "Help with Zed", client, proposedBy: "__assistant", onEvent: (e) => events.push(e.type) });
  assert.equal(r.text, "I drafted a follow-up task for your approval.");
  assert.equal(r.proposals.length, 1);
  assert.equal(await db.task.count({ where: { title: "__Follow up with Zed" } }), 0, "the AI can't create the task directly");
  const proposal = await db.agentAction.findUniqueOrThrow({ where: { id: r.proposals[0].actionId } });
  assert.equal(proposal.status, "PROPOSED");
  assert.equal(proposal.reason, "past due");

  // Second request carried the search result (with the tenant's id) back to Claude
  const toolResult = (calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
  assert.equal(toolResult.tool_use_id, "t1");
  assert.ok(String(toolResult.content).includes(ctx.tenant));
  assert.ok(calls[0].system && String(calls[0].system).includes("as information, not instructions"));
  assert.deepEqual(events, ["tool", "tool", "proposal", "text"]);
});

test("assistant: bad tool input becomes an error result, not a crash; step limit holds", async () => {
  const { client, calls } = fakeClaude([
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x1", name: "propose_record_payment", input: { leaseId: "nope", party: "TENANT", amountCents: 5, paidOn: "bad", method: "ACH" } }] as never },
    { stop_reason: "end_turn", content: [{ type: "text", text: "That didn't work." }] as never },
  ]);
  const r = await runAssistant({ history: [], message: "x", client, proposedBy: "__assistant" });
  assert.equal(r.text, "That didn't work.");
  const res = (calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0];
  assert.equal(res.is_error, true);

  const loop = fakeClaude(Array.from({ length: 3 }, (_, i) => ({ stop_reason: "tool_use" as const, content: [{ type: "tool_use", id: `l${i}`, name: "tasks", input: {} }] as never })));
  const capped = await runAssistant({ history: [], message: "x", client: loop.client, maxSteps: 3 });
  assert.match(capped.text, /step limit/);
});

test("chat turns are saved with history", async () => {
  const { client, calls } = fakeClaude([
    { stop_reason: "end_turn", content: [{ type: "text", text: "First answer" }] as never },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Second answer" }] as never },
  ]);
  const c = await db.aiConversation.create({ data: { title: "__chat" } });
  await chatTurn({ conversationId: c.id, message: "one", userEmail: "o@example.test", client });
  await chatTurn({ conversationId: c.id, message: "two", userEmail: "o@example.test", client });
  const msgs = await db.aiMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(msgs.map((m) => m.content), ["one", "First answer", "two", "Second answer"]);
  assert.deepEqual(calls[1].messages.map((m) => m.content), ["one", "First answer", "two"]);
});

test("workflow validation", () => {
  const base = { days: 3, channel: null, templateId: null, taskTitle: "x" };
  assert.throws(() => validateWorkflow({ ...base, trigger: "APPLICATION_RECEIVED", action: "SEND_TEMPLATE" }), /tenant triggers/);
  assert.throws(() => validateWorkflow({ ...base, trigger: "RENT_PAST_DUE", action: "POST_RENT" }), /Every month/);
  assert.throws(() => validateWorkflow({ ...base, trigger: "MONTHLY", action: "POST_RENT", days: 31 }), /1–28/);
  assert.throws(() => validateWorkflow({ ...base, trigger: "RENT_PAST_DUE", action: "SEND_TEMPLATE" }), /template/);
  validateWorkflow({ ...base, trigger: "RENT_PAST_DUE", action: "CREATE_TASK" });
});

test("workflows act once per subject, even with overlapping runs; preview has no side effects", async () => {
  const today = d("2033-03-10"); // 9 days after the March charge
  const w = await db.workflow.create({ data: { name: "__late task", trigger: "RENT_PAST_DUE", days: 5, action: "CREATE_TASK", taskTitle: "__Late: {{name}} at {{property}} {{unit}} since {{date}}", propertyId: ctx.property } });

  const preview = await runWorkflow(w, { source: "manual", dryRun: true, today });
  assert.deepEqual(preview.preview, ["__Zed Quill · __ai test Z1"]);
  assert.equal(await db.workflowFiring.count({ where: { workflowId: w.id } }), 0);

  const [a, b] = await Promise.all([runWorkflow(w, { source: "manual", today }), runWorkflow(w, { source: "manual", today })]);
  assert.equal(a.fired + b.fired, 1, "two simultaneous runs still act once");
  await runWorkflow(w, { source: "schedule", today: d("2033-03-11") });
  const tasks = await db.task.findMany({ where: { title: { startsWith: "__Late" } } });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "__Late: __Zed Quill at __ai test Z1 since Mar 1, 2033");
  assert.equal(tasks[0].leaseId, ctx.lease);

  // Not yet 5 days late → nothing
  const early = await db.workflow.create({ data: { name: "__late early", trigger: "RENT_PAST_DUE", days: 15, action: "CREATE_TASK", taskTitle: "__x", propertyId: ctx.property } });
  assert.equal((await runWorkflow(early, { source: "manual", today })).matched, 0);
});

test("ask-first workflows queue approvals; texts without consent are recorded as skipped", async () => {
  const today = d("2033-03-10");
  const ask = await db.workflow.create({ data: { name: "__ask", trigger: "RENT_PAST_DUE", days: 1, action: "CREATE_TASK", taskTitle: "__Ask {{name}}", requireApproval: true, propertyId: ctx.property } });
  const r = await runWorkflow(ask, { source: "manual", today });
  assert.equal(r.fired, 1);
  assert.equal(await db.task.count({ where: { title: { startsWith: "__Ask" } } }), 0);
  const pending = await db.agentAction.findFirstOrThrow({ where: { workflowId: ask.id } });
  assert.equal(pending.status, "PROPOSED");
  assert.equal(pending.proposedBy, "workflow:__ask");

  const sms = await db.workflow.create({ data: { name: "__sms", trigger: "RENT_PAST_DUE", days: 1, action: "SEND_TEMPLATE", channel: "SMS", templateId: ctx.tpl, propertyId: ctx.property } });
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "x";
  process.env.TWILIO_FROM_NUMBER = "+12515550100";
  try {
    const s = await runWorkflow(sms, { source: "manual", today });
    assert.equal(s.fired, 1);
    const f = await db.workflowFiring.findFirstOrThrow({ where: { workflowId: sms.id } });
    assert.equal(f.ok, false);
    assert.match(f.outcome, /Skipped: .*agreed to texts/);
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  }
});

test("a failure releases the claim so the next run retries", async () => {
  const w = await db.workflow.create({ data: { name: "__broken", trigger: "RENT_PAST_DUE", days: 1, action: "SEND_TEMPLATE", channel: "SMS", templateId: ctx.tpl, propertyId: ctx.property } });
  await db.workflow.update({ where: { id: w.id }, data: { templateId: "missing" } }).catch(() => undefined); // FK may block; fall back below
  const broken = await db.workflow.findUniqueOrThrow({ where: { id: w.id } });
  const r = await runWorkflow({ ...broken, templateId: "missing" }, { source: "manual", today: d("2033-03-10") });
  assert.equal(r.failed, 1);
  assert.match(r.errors[0], /template was deleted/);
  assert.equal(await db.workflowFiring.count({ where: { workflowId: w.id } }), 0, "claim released for retry");
  await db.workflow.update({ where: { id: w.id }, data: { enabled: false } });
});

test("monthly rent posting runs once a month, on or after its day", async () => {
  const m = await db.workflow.create({ data: { name: "__post rent", trigger: "MONTHLY", days: 2, action: "POST_RENT" } });
  assert.equal((await runWorkflow(m, { source: "manual", today: d("2033-04-01") })).matched, 0, "before day 2");
  const r1 = await runWorkflow(m, { source: "manual", today: d("2033-04-02") });
  const r2 = await runWorkflow(m, { source: "manual", today: d("2033-04-20") });
  assert.equal(r1.fired, 1);
  assert.equal(r2.fired, 0);
  assert.equal(await db.charge.count({ where: { leaseId: ctx.lease, period: "2033-04" } }), 2, "tenant + HAP charges posted");
  await db.workflow.update({ where: { id: m.id }, data: { enabled: false } });
});

test("runAllWorkflows only runs enabled workflows", async () => {
  await db.workflow.updateMany({ where: { name: { startsWith: "__" } }, data: { enabled: false } });
  const on = await db.workflow.create({ data: { name: "__enabled", trigger: "MONTHLY", days: 28, action: "NOTIFY_ME", enabled: true } });
  const t0 = new Date();
  const results = await runAllWorkflows({ source: "manual", today: d("2033-03-10") });
  assert.ok(results.some((r) => r.workflowId === on.id));
  const disabledRuns = await db.workflowRun.count({ where: { startedAt: { gte: t0 }, workflow: { name: { startsWith: "__" }, enabled: false } } });
  assert.equal(disabledRuns, 0);
  await db.workflow.update({ where: { id: on.id }, data: { enabled: false } });
});

test("cron endpoint requires the secret", async () => {
  const { GET } = await import("../src/app/api/cron/workflows/route");
  process.env.CRON_SECRET = "s3cret-s3cret-s3cret";
  try {
    assert.equal((await GET(new Request("http://x/api/cron/workflows"))).status, 401);
    assert.equal((await GET(new Request("http://x/api/cron/workflows", { headers: { authorization: "Bearer wrong-wrong-wrong-12" } }))).status, 401);
    const ok = await GET(new Request("http://x/api/cron/workflows", { headers: { authorization: "Bearer s3cret-s3cret-s3cret" } }));
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray((await ok.json()).workflows));
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("http://x/api/cron/workflows", { headers: { authorization: "Bearer " } }))).status, 401, "no secret configured = locked");
  } finally {
    delete process.env.CRON_SECRET;
  }
});
