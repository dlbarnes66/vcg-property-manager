import { db } from "./db";

export type LandlordDetails = { ownerName: string; managerName: string; address: string; phone: string; email: string };
const EMPTY: LandlordDetails = { ownerName: "", managerName: "", address: "", phone: "", email: "" };

/** Landlord/owner details used on forms (who the lease is with, where notices go). */
export async function getLandlord(): Promise<LandlordDetails> {
  const row = await db.appSetting.findUnique({ where: { key: "landlord" } });
  if (!row) return { ...EMPTY };
  try {
    return { ...EMPTY, ...(JSON.parse(row.value) as Partial<LandlordDetails>) };
  } catch {
    return { ...EMPTY };
  }
}

export async function setLandlord(v: LandlordDetails) {
  const clean = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "").trim().slice(0, 300)]));
  await db.appSetting.upsert({ where: { key: "landlord" }, update: { value: JSON.stringify(clean) }, create: { key: "landlord", value: JSON.stringify(clean) } });
}
