"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optInt, optStr, reqStr } from "@/lib/form";
import { TASK_PRIORITIES } from "@/lib/enums";
import { ACTIONS, TRIGGERS, addStarterWorkflows, runAllWorkflows, runWorkflow, validateWorkflow } from "@/lib/workflows";
import { appOrigin } from "@/lib/portal";

const refresh = () => revalidatePath("/", "layout");
const triggers = Object.keys(TRIGGERS) as (keyof typeof TRIGGERS)[];
const actions = Object.keys(ACTIONS) as (keyof typeof ACTIONS)[];

async function fields(fd: FormData) {
  const action = oneOf(fd, "action", actions);
  const templateId = action === "SEND_TEMPLATE" ? optStr(fd, "templateId") : null;
  const tpl = templateId ? await db.messageTemplate.findUnique({ where: { id: templateId } }) : null;
  const data = {
    name: reqStr(fd, "name", "Name").slice(0, 120),
    trigger: oneOf(fd, "trigger", triggers),
    days: optInt(fd, "days", "Days") ?? 0,
    action,
    templateId,
    channel: tpl ? (tpl.channel === "SMS" ? ("SMS" as const) : ("EMAIL" as const)) : null,
    taskTitle: optStr(fd, "taskTitle"),
    taskDueInDays: optInt(fd, "taskDueInDays", "Due in") ?? 1,
    taskPriority: oneOf(fd, "taskPriority", TASK_PRIORITIES, "NORMAL"),
    requireApproval: bool(fd, "requireApproval"),
    propertyId: optStr(fd, "propertyId"),
  };
  validateWorkflow(data);
  return data;
}

export async function saveWorkflow(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const data = await fields(fd);
    if (id) await db.workflow.update({ where: { id }, data });
    else await db.workflow.create({ data: { ...data, enabled: false } });
    refresh();
    return { ok: true, message: id ? "Saved" : "Created (off). Preview it, then turn it on." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleWorkflow(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const w = await db.workflow.findUniqueOrThrow({ where: { id } });
    await db.workflow.update({ where: { id }, data: { enabled: !w.enabled } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteWorkflow(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.workflow.delete({ where: { id } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function previewWorkflow(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const w = await db.workflow.findUniqueOrThrow({ where: { id } });
    const r = await runWorkflow(w, { source: "manual", dryRun: true });
    if (r.preview.length === 0) return { ok: true, message: `Nothing to do right now${r.skippedAlreadyDone ? ` (${r.skippedAlreadyDone} already handled)` : ""}.` };
    return { ok: true, message: `Would act on ${r.preview.length}: ${r.preview.slice(0, 8).join("; ")}${r.preview.length > 8 ? "…" : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function runOneNow(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const w = await db.workflow.findUniqueOrThrow({ where: { id } });
    const origin = await appOrigin();
    const r = await runWorkflow(w, { source: "manual", actorEmail: email, statusCallback: origin.startsWith("https://") ? `${origin}/api/twilio/status` : undefined });
    refresh();
    return r.failed ? { error: `Did ${r.fired}, failed ${r.failed}: ${r.errors[0]}` } : { ok: true, message: `Did ${r.fired}${r.skippedAlreadyDone ? `, ${r.skippedAlreadyDone} already handled` : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function runAllNow(_: ActionResult): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const origin = await appOrigin();
    const rs = await runAllWorkflows({ source: "manual", actorEmail: email, statusCallback: origin.startsWith("https://") ? `${origin}/api/twilio/status` : undefined });
    refresh();
    const fired = rs.reduce((s, r) => s + r.fired, 0);
    const failed = rs.reduce((s, r) => s + r.failed, 0);
    return failed ? { error: `Ran ${rs.length} workflows: ${fired} done, ${failed} failed. See run history.` } : { ok: true, message: `Ran ${rs.length} workflow${rs.length === 1 ? "" : "s"}: ${fired} action${fired === 1 ? "" : "s"}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function addStarters(_: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await addStarterWorkflows();
    refresh();
    return {
      ok: true,
      message: `${r.added ? `Added ${r.added} starter workflows (all off)` : "You already have the starter workflows"}${r.missingTemplates ? ". Add the starter message templates first to also get the rent reminder and past-due workflows." : ""}`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
