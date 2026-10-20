"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, optStr, reqStr } from "@/lib/form";
import { readLinks } from "@/lib/links";

const back = (p: string | null) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/notes");

export async function addNote(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const { email } = await requireAdmin();
    const links = readLinks(fd);
    if (!Object.values(links).some(Boolean)) throw new Error("A note must be attached to a record");
    await db.note.create({ data: { body: reqStr(fd, "body", "Note").slice(0, 10_000), pinned: bool(fd, "pinned"), authorEmail: email, ...links } });
    revalidatePath(back(optStr(fd, "returnPath")));
    revalidatePath("/notes");
    return { ok: true, message: "Note saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateNote(id: string, returnPath: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.note.update({ where: { id }, data: { body: reqStr(fd, "body", "Note").slice(0, 10_000) } });
    revalidatePath(back(returnPath));
    revalidatePath("/notes");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleNotePin(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const n = await db.note.findUniqueOrThrow({ where: { id } });
    await db.note.update({ where: { id }, data: { pinned: !n.pinned } });
    revalidatePath(back(returnPath));
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteNote(id: string, returnPath: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.note.delete({ where: { id } });
    revalidatePath(back(returnPath));
    revalidatePath("/notes");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
