import { FormGenerator } from "@/components/form-generator";
import { PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/assistant";
import { db } from "@/lib/db";
import { tenantName } from "@/lib/queries";
import { toStateCode } from "@/lib/states";

export const metadata = { title: "New form" };

type SP = { formType?: string; state?: string; leaseId?: string; tenantId?: string; propertyId?: string; vendorId?: string; templateId?: string };

export default async function NewFormPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [leases, tenants, properties, vendors, templates] = await Promise.all([
    db.lease.findMany({ where: { status: { in: ["ACTIVE", "DRAFT", "ENDED"] } }, orderBy: [{ status: "asc" }, { startDate: "desc" }], take: 300, include: { tenant: true, unit: { include: { property: true } } } }),
    db.tenant.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }),
    db.property.findMany({ orderBy: { name: "asc" } }),
    db.vendor.findMany({ orderBy: { name: "asc" } }),
    db.formTemplate.findMany({ where: { body: { not: null } }, orderBy: { title: "asc" }, select: { id: true, title: true, state: true, category: true, formType: true } }),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/forms", label: "Forms" }} title="New form" subtitle="The AI drafts it for the property's state using your records. You review and edit before anything is saved as a PDF or shared." />
      <FormGenerator
        aiReady={aiConfigured()}
        leases={leases.map((l) => ({ id: l.id, label: `${tenantName(l.tenant)} — ${l.unit.property.name} · ${l.unit.label}${l.status !== "ACTIVE" ? ` (${l.status.toLowerCase()})` : ""}`, state: toStateCode(l.unit.property.state) }))}
        tenants={tenants.map((t) => ({ id: t.id, label: tenantName(t) }))}
        properties={properties.map((p) => ({ id: p.id, label: p.name, state: toStateCode(p.state) }))}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        templates={templates}
        initial={sp}
      />
    </>
  );
}
