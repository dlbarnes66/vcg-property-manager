"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { oneOf, optDate, optStr, reqStr } from "@/lib/form";
import { sendToAudience, type Audience } from "@/lib/messaging";
import { emailConfigured, smsConfigured } from "@/lib/messaging-providers";
import { appOrigin } from "@/lib/portal";

function readAudience(fd: FormData): Audience {
  const kind = reqStr(fd, "audience", "Recipient");
  if (kind === "all-tenants") return { kind };
  const id = reqStr(fd, `${kind}Id`, "Recipient");
  if (["tenant", "case-manager", "property", "vendor", "pha"].includes(kind)) return { kind, id } as Audience;
  throw new Error("Pick who to send to");
}

function refresh(fd?: FormData) {
  revalidatePath("/communications");
  revalidatePath("/", "layout");
  const back = fd ? optStr(fd, "returnPath") : null;
  if (back?.startsWith("/") && !back.startsWith("//")) revalidatePath(back);
}

export async function sendMessage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const channel = oneOf(fd, "channel", ["EMAIL", "SMS"] as const);
    if (channel === "EMAIL" && !emailConfigured()) throw new Error("Email isn't set up yet. Add your SendGrid settings to .env (see README).");
    if (channel === "SMS" && !smsConfigured()) throw new Error("Texting isn't set up yet. Add your Twilio settings to .env (see README).");
    const body = reqStr(fd, "body", "Message").slice(0, channel === "SMS" ? 1600 : 20_000);
    const subject = channel === "EMAIL" ? reqStr(fd, "subject", "Subject").slice(0, 200) : null;

    const origin = await appOrigin();
    const out = await sendToAudience({
      audience: readAudience(fd),
      channel,
      subject,
      body,
      sentByEmail: email,
      statusCallback: origin.startsWith("https://") ? `${origin}/api/twilio/status` : undefined,
      context: { leaseId: optStr(fd, "leaseId"), maintenanceId: optStr(fd, "maintenanceId") },
    });
    refresh(fd);

    const parts = [`Sent to ${out.sent}`];
    if (out.failed.length) parts.push(`failed for ${out.failed.length} (${out.failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join("; ")})`);
    if (out.skipped.length) parts.push(`skipped ${out.skipped.length} (${out.skipped.slice(0, 5).map((s) => `${s.name}: ${s.reason}`).join("; ")}${out.skipped.length > 5 ? "…" : ""})`);
    if (out.blankFields.length) parts.push(`blank merge fields: ${out.blankFields.join(", ")}`);
    const msg = parts.join(" · ");
    if (out.sent === 0) return { error: msg === "Sent to 0" ? "No one to send to." : msg };
    return { ok: true, message: msg };
  } catch (e) {
    return toActionError(e);
  }
}

/** Record a call, visit, letter, or a message sent from your own phone/email. Nothing is sent. */
export async function logMessage(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const who = reqStr(fd, "who", "Who");
    const [kind, id] = who.split(":");
    if (!id || !["tenant", "vendor", "pha"].includes(kind)) throw new Error("Pick who it was with");
    const when = optDate(fd, "date") ?? new Date();
    await db.message.create({
      data: {
        channel: oneOf(fd, "channel", ["CALL", "EMAIL", "SMS", "OTHER"] as const, "CALL"),
        direction: oneOf(fd, "direction", ["OUTBOUND", "INBOUND"] as const, "OUTBOUND"),
        status: "LOGGED",
        subject: optStr(fd, "subject"),
        body: reqStr(fd, "body", "Summary").slice(0, 10_000),
        sentByEmail: email,
        sentAt: when,
        readAt: new Date(),
        tenantId: kind === "tenant" ? id : null,
        vendorId: kind === "vendor" ? id : null,
        housingAuthorityId: kind === "pha" ? id : null,
      },
    });
    refresh(fd);
    return { ok: true, message: "Logged" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function markRead(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.message.update({ where: { id }, data: { readAt: new Date() } });
    refresh();
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function markAllRead(_: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await db.message.updateMany({ where: { direction: "INBOUND", readAt: null }, data: { readAt: new Date() } });
    refresh();
    return { ok: true, message: `Marked ${r.count} read` };
  } catch (e) {
    return toActionError(e);
  }
}

/* ------------------------------- Templates ------------------------------- */

function templateFields(fd: FormData) {
  const channel = oneOf(fd, "channel", ["EMAIL", "SMS"] as const);
  return {
    name: reqStr(fd, "name", "Name").slice(0, 100),
    channel,
    subject: channel === "EMAIL" ? optStr(fd, "subject") : null,
    body: reqStr(fd, "body", "Message").slice(0, 20_000),
  };
}

export async function saveTemplate(id: string | null, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const data = templateFields(fd);
    if (id) await db.messageTemplate.update({ where: { id }, data });
    else await db.messageTemplate.create({ data });
    revalidatePath("/communications/templates");
    revalidatePath("/communications");
    return { ok: true, message: "Template saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTemplate(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.messageTemplate.delete({ where: { id } });
    revalidatePath("/communications/templates");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

const STARTERS = [
  { name: "Rent reminder (text)", channel: "SMS" as const, subject: null, body: "Hi {{firstName}}, a reminder that your rent of {{rent}} for {{property}} {{unit}} is due {{dueDate}}. Questions? Just reply to this text." },
  {
    name: "Rent reminder (email)", channel: "EMAIL" as const, subject: "Rent reminder: due {{dueDate}}",
    body: "Hi {{firstName}},\n\nThis is a friendly reminder that your rent of {{rent}} for {{property}}, {{unit}} is due {{dueDate}}. You can pay in your resident portal.\n\nThank you,\nProperty Management",
  },
  {
    name: "Past-due balance", channel: "EMAIL" as const, subject: "Your account has a balance of {{balance}}",
    body: "Hi {{firstName}},\n\nOur records show a balance of {{balance}} on your account for {{property}}, {{unit}}. If you've already paid, thank you, and please disregard this message. If you're having trouble, reach out. We'd rather work something out together.\n\nProperty Management",
  },
  { name: "Repair scheduled (text)", channel: "SMS" as const, subject: null, body: "Hi {{firstName}}, your repair at {{property}} {{unit}} is scheduled. We'll text again if anything changes." },
  {
    name: "Inspection notice", channel: "EMAIL" as const, subject: "Upcoming unit inspection at {{property}}",
    body: "Hi {{firstName}},\n\nYour housing authority has scheduled an inspection of {{unit}} at {{property}}. Please make sure smoke detectors work, outlets have covers, and there's clear access to windows and utility areas.\n\nThank you,\nProperty Management",
  },
];

export async function addStarterTemplates(_: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const r = await db.messageTemplate.createMany({ data: STARTERS, skipDuplicates: true });
    revalidatePath("/communications/templates");
    revalidatePath("/communications");
    return { ok: true, message: r.count ? `Added ${r.count} templates` : "You already have the starter templates" };
  } catch (e) {
    return toActionError(e);
  }
}
