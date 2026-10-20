import "server-only";
import { db } from "./db";
import { reportByKey } from "./report-defs";
import { readParams, type SearchParams } from "./report-kit";

/** Resolve a report and its parameters from URL search params (property name looked up for titles). */
export async function resolveReport(key: string, sp: SearchParams) {
  const def = reportByKey(key);
  if (!def) return null;
  const property = sp.propertyId ? await db.property.findUnique({ where: { id: sp.propertyId }, select: { id: true, name: true } }) : null;
  const params = readParams({ ...sp, propertyId: property?.id }, def.defaultRange, () => property?.name ?? null);
  if (def.mode === "asOf" && !sp.preset) params.from = params.to;
  return { def, params };
}
