"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { approveAndExecute, rejectAction } from "@/lib/agent-actions";
import { aiConfigured, runDailyReview } from "@/lib/ai/assistant";
import { appOrigin } from "@/lib/portal";

const refresh = () => revalidatePath("/", "layout");

export async function approveAction(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const origin = await appOrigin();
    const a = await approveAndExecute(id, email, { statusCallback: origin.startsWith("https://") ? `${origin}/api/twilio/status` : undefined });
    refresh();
    return a.status === "FAILED" ? { error: `Approved, but it failed: ${a.error}` } : { ok: true, message: a.result ?? "Done" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function rejectActionForm(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    await rejectAction(id, email);
    refresh();
    return { ok: true, message: "Dismissed" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function startDailyReview(_: ActionResult): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    if (!aiConfigured()) throw new Error("Add ANTHROPIC_API_KEY to .env first (see README).");
    const out = await runDailyReview(email);
    refresh();
    redirect(`/assistant/${out.conversationId}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteConversation(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.aiConversation.delete({ where: { id } });
    revalidatePath("/assistant");
    redirect("/assistant");
  } catch (e) {
    return toActionError(e);
  }
}
