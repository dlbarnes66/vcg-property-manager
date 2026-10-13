"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireAccess } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/actions-util";
import { reqStr, optStr, optMoney, optDate, optInt, optFloat, oneOf } from "@/lib/form";
import { PROPERTY_TYPES } from "@/lib/enums";

function propertyData(fd: FormData) {
  return {
    name: reqStr(fd, "name", "Property name"),
    type: oneOf(fd, "type", PROPERTY_TYPES, "MULTIFAMILY"),
    street: reqStr(fd, "street", "Street"),
    city: reqStr(fd, "city", "City"),
    state: reqStr(fd, "state", "State").toUpperCase(),
    zip: reqStr(fd, "zip", "ZIP"),
    purchasePrice: optMoney(fd, "purchasePrice", "Purchase price"),
    purchaseDate: optDate(fd, "purchaseDate"),
    notes: optStr(fd, "notes"),
  };
}

export async function createProperty(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const p = await db.property.create({ data: propertyData(fd) });
    // Optional quick-start: create N units named "Unit 1..N"
    const n = optInt(fd, "unitCount", "Number of units") ?? 0;
    if (n > 0) {
      if (n > 500) throw new Error("That's a lot of units — add them in batches of 500 or fewer");
      await db.unit.createMany({ data: Array.from({ length: n }, (_, i) => ({ propertyId: p.id, label: n === 1 ? "Main" : `Unit ${i + 1}` })) });
    }
    revalidatePath("/properties");
    redirect(`/properties/${p.id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProperty(id: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    await db.property.update({ where: { id }, data: propertyData(fd) });
    revalidatePath(`/properties/${id}`);
    redirect(`/properties/${id}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteProperty(id: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const leases = await db.lease.count({ where: { unit: { propertyId: id } } });
    if (leases > 0) throw new Error("This property has leases on file. End and delete those leases first.");
    await db.property.delete({ where: { id } });
    revalidatePath("/properties");
    redirect("/properties");
  } catch (e) {
    return toActionError(e);
  }
}

function unitData(fd: FormData) {
  return {
    label: reqStr(fd, "label", "Unit label"),
    bedrooms: optInt(fd, "bedrooms", "Bedrooms") ?? 1,
    bathrooms: optFloat(fd, "bathrooms", "Bathrooms") ?? 1,
    sqft: optInt(fd, "sqft", "Square feet"),
    marketRent: optMoney(fd, "marketRent", "Market rent"),
    notes: optStr(fd, "notes"),
  };
}

export async function createUnit(propertyId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const data = unitData(fd);
    await db.unit.create({ data: { ...data, propertyId } });
    revalidatePath(`/properties/${propertyId}`);
    return { ok: true, message: `Added ${data.label}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUnit(unitId: string, _: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await requireAccess();
    const u = await db.unit.update({ where: { id: unitId }, data: unitData(fd) });
    revalidatePath(`/properties/${u.propertyId}`);
    return { ok: true, message: "Saved" };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteUnit(unitId: string, _: ActionResult): Promise<ActionResult> {
  try {
    await requireAccess();
    const leases = await db.lease.count({ where: { unitId } });
    if (leases > 0) throw new Error("This unit has leases on file and can't be deleted.");
    const u = await db.unit.delete({ where: { id: unitId } });
    revalidatePath(`/properties/${u.propertyId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
