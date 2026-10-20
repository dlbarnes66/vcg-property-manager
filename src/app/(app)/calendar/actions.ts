"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { bool, oneOf, optStr, reqDate, reqStr } from "@/lib/form";
import { EVENT_TYPES } from "@/lib/enums";
import { zonedToUtc } from "@/lib/dates";
import { periodOf } from "@/lib/utils";

function eventFields(fd: FormData) {
  const date = reqDate(fd, "date", "Date");
  const allDay = bool(fd, "allDay");
  const ymd = date.toISOString().slice(0, 10);
  let start = date;
  let end: Date | null = null;
  if (!allDay) {
    const st = optStr(fd, "startTime");
    if (!st) throw new Error("Add a start time, or tick All day");
    start = zonedToUtc(`${ymd}T${st}`);
    const et = optStr(fd, "endTime");
    if (et) {
      end = zonedToUtc(`${ymd}T${et}`);
      if (end <= start) throw new Error("End time must be after the start time");
    }
  }
  return {
    title: reqStr(fd, "title", "Title").slice(0, 200),
    type: oneOf(fd, "type", EVENT_TYPES, "OTHER"),
    allDay,
    start,
    end,
    location: optStr(fd, "location"),
    description: optStr(fd, "description"),
    propertyId: optStr(fd, "propertyId"),
    tenantId: optStr(fd, "tenantId"),
  };
}

export async function createEvent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    const data = eventFields(fd);
    await db.calendarEvent.create({ data });
    revalidatePath("/calendar");
    revalidatePath("/");
    return { ok: true, message: "Event added" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateEvent(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAdmin();
    await db.calendarEvent.update({ where: { id }, data: eventFields(fd) });
    revalidatePath("/calendar");
    revalidatePath("/");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteEvent(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAdmin();
    const e = await db.calendarEvent.delete({ where: { id } });
    revalidatePath("/calendar");
    revalidatePath("/");
    redirect(`/calendar?month=${periodOf(e.start)}`);
  } catch (e) {
    return toActionError(e);
  }
}
