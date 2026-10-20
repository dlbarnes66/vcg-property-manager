import { db } from "./db";
import { nextOccurrence } from "./dates";

/**
 * Marks a task done. For a repeating task, also creates the next one (once — completing,
 * reopening, and completing again won't create duplicates).
 */
export async function completeTask(id: string, now = new Date()) {
  return db.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id }, data: { status: "DONE", completedAt: now } });
    if (t.recurrence === "NONE" || !t.dueDate) return { task: t, next: null };

    const due = nextOccurrence(t.dueDate, t.recurrence);
    if (!due) return { task: t, next: null };
    const links = {
      propertyId: t.propertyId, unitId: t.unitId, tenantId: t.tenantId, leaseId: t.leaseId,
      maintenanceId: t.maintenanceId, vendorId: t.vendorId, housingAuthorityId: t.housingAuthorityId,
    };
    const existing = await tx.task.findFirst({ where: { title: t.title, dueDate: due, recurrence: t.recurrence, ...links } });
    if (existing) return { task: t, next: existing };
    const next = await tx.task.create({
      data: {
        title: t.title, description: t.description, priority: t.priority, dueDate: due, recurrence: t.recurrence,
        assigneeEmail: t.assigneeEmail, createdByEmail: t.createdByEmail, ...links,
      },
    });
    return { task: t, next };
  });
}
