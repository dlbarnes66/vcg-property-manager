import { db } from "./db";
import { emailConfigured, smsConfigured } from "./messaging-providers";

/** Everything the message composer's dropdowns need. */
export async function composerData() {
  const [templates, tenants, properties, vendors, phas] = await Promise.all([
    db.messageTemplate.findMany({ orderBy: { name: "asc" } }),
    db.tenant.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, firstName: true, lastName: true } }),
    db.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.housingAuthority.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    templates,
    tenants: tenants.map((t) => ({ id: t.id, label: `${t.lastName}, ${t.firstName}` })),
    properties: properties.map((p) => ({ id: p.id, label: p.name })),
    vendors: vendors.map((v) => ({ id: v.id, label: v.name })),
    phas: phas.map((h) => ({ id: h.id, label: h.name })),
    emailReady: emailConfigured(),
    smsReady: smsConfigured(),
  };
}
