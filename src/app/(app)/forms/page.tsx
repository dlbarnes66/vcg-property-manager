import Link from "next/link";
import type { FormCategory, Prisma } from "@prisma/client";
import { FileText, Plus, Upload } from "lucide-react";
import { deleteTemplate, saveLandlordDetails, uploadTemplate } from "./actions";
import { ActionForm } from "@/components/action-form";
import { FilterSelect } from "@/components/filter-select";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, CATEGORY_ORDER, formType } from "@/lib/forms/catalog";
import { getLandlord } from "@/lib/settings";
import { STATES, isStateCode, stateName } from "@/lib/states";
import { cn, fmtDate } from "@/lib/utils";

export const metadata = { title: "Forms" };

type SP = { state?: string; cat?: string };

export default async function FormsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const state = isStateCode(sp.state) ? sp.state : null;
  const cat = CATEGORY_ORDER.includes(sp.cat as FormCategory) ? (sp.cat as FormCategory) : null;
  const where = { ...(state ? { state: state === "US" ? "US" : state } : {}), ...(cat ? { category: cat } : {}) };
  const tplWhere: Prisma.FormTemplateWhereInput = { ...(state ? { state: { in: [state, "US"] } } : {}), ...(cat ? { category: cat } : {}) };

  const [forms, templates, landlord, counts, tplCounts] = await Promise.all([
    db.formDoc.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200, include: { tenant: true, property: true, vendor: true, unit: true, document: { select: { sharedWithTenant: true } } } }),
    db.formTemplate.findMany({ where: tplWhere, orderBy: [{ state: "asc" }, { category: "asc" }, { title: "asc" }], include: { document: { select: { id: true, name: true } } } }),
    getLandlord(),
    db.formDoc.groupBy({ by: ["state"], _count: true }),
    db.formTemplate.groupBy({ by: ["state"], _count: true }),
  ]);
  const used = new Map<string, number>();
  for (const c of [...counts, ...tplCounts]) used.set(c.state, (used.get(c.state) ?? 0) + c._count);
  const usedStates = [...used.keys()].filter((s) => s !== "US").sort();
  const q = (o: SP) => {
    const u = new URLSearchParams(Object.entries({ state: state ?? undefined, cat: cat ?? undefined, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/forms${u.size ? `?${u}` : ""}`;
  };
  const landlordSet = Boolean(landlord.ownerName);

  return (
    <>
      <PageHeader
        title="Forms"
        subtitle="Leases, addenda, notices, and checklists for every state. Draft with AI, edit, save as PDF, and share to a tenant's portal."
        actions={<Link href={`/forms/new${state && state !== "US" ? `?state=${state}` : ""}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-navy px-4 text-sm font-medium text-white hover:bg-navy-600"><Plus size={14} /> New form</Link>}
      />

      {!landlordSet && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Add your <b>landlord details</b> at the bottom of this page (owner's legal name and notice address) so every form names the right owner.
        </div>
      )}

      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-end gap-4">
          <form className="flex items-end gap-2">
            {cat && <input type="hidden" name="cat" value={cat} />}
            <Field label="State">
              <FilterSelect name="state" defaultValue={state ?? ""} className="min-w-56">
                <option value="">All states</option>
                {usedStates.length > 0 && (
                  <optgroup label="States you use">
                    {usedStates.map((s) => <option key={s} value={s}>{stateName(s)} ({used.get(s)})</option>)}
                  </optgroup>
                )}
                <option value="US">Federal forms (all states)</option>
                <optgroup label="All states">
                  {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                </optgroup>
              </FilterSelect>
            </Field>
            <noscript><button className="h-9 rounded-md border border-line px-3 text-sm">Go</button></noscript>
          </form>
          <div className="flex flex-wrap gap-1">
            <Link href={q({ cat: "" })} className={cn("rounded-md px-3 py-1.5 text-sm", !cat ? "bg-navy text-white" : "text-muted hover:bg-paper")}>All types</Link>
            {CATEGORY_ORDER.filter((c) => c !== "OTHER").map((c) => (
              <Link key={c} href={q({ cat: c })} className={cn("rounded-md px-3 py-1.5 text-sm", cat === c ? "bg-navy text-white" : "text-muted hover:bg-paper")}>{CATEGORY_LABEL[c]}</Link>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title={state ? `${stateName(state)} forms` : "Your forms"} subtitle="Drafts and finished forms. Finished forms are also saved as PDFs in Documents." />
        {forms.length === 0 ? (
          <Empty action={<Link href={`/forms/new${state && state !== "US" ? `?state=${state}` : ""}`} className="text-sm font-medium text-navy hover:underline">Create one →</Link>}>
            No forms {state ? `for ${stateName(state)} ` : ""}yet.
          </Empty>
        ) : (
          <Table>
            <thead><tr><Th>Form</Th><Th>State</Th><Th>For</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id}>
                  <Td>
                    <Link href={`/forms/${f.id}`} className="font-medium hover:underline">{f.title}</Link>
                    <div className="text-xs text-muted">{formType(f.formType)?.title ?? CATEGORY_LABEL[f.category]}</div>
                  </Td>
                  <Td><Badge tone="navy">{f.state}</Badge></Td>
                  <Td className="text-muted">
                    {[f.tenant && `${f.tenant.firstName} ${f.tenant.lastName}`, f.unit && f.property ? `${f.property.name} · ${f.unit.label}` : f.property?.name, f.vendor?.name].filter(Boolean).join(" · ") || "—"}
                  </Td>
                  <Td>
                    {f.status === "FINAL" ? <Badge tone="green">Finished</Badge> : <Badge tone="amber">Draft</Badge>}
                    {f.document?.sharedWithTenant && <span className="ml-1"><Badge tone="blue">In portal</Badge></span>}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{fmtDate(f.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={state ? `${stateName(state)} library` : "Library"} subtitle="Reusable templates and forms you've uploaded (for example, attorney-approved versions), filed by state." />
          {templates.length === 0 ? (
            <Empty>Nothing in the library{state ? ` for ${stateName(state)}` : ""} yet. Finish a form and click “Save to library,” or upload one.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Title</Th><Th>State</Th><Th>Type</Th><Th></Th></tr></thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <div className="flex items-center gap-1.5 font-medium">
                        <FileText size={14} className="shrink-0 text-muted" />
                        {t.document ? <a href={`/api/documents/${t.document.id}`} target="_blank" rel="noreferrer" className="hover:underline">{t.title}</a> : <span>{t.title}</span>}
                      </div>
                      <div className="text-xs text-muted">{t.document ? `Uploaded file · ${t.document.name}` : "Text template · the AI can start from it"}{t.description ? ` · ${t.description}` : ""}</div>
                    </Td>
                    <Td><Badge tone="navy">{t.state}</Badge></Td>
                    <Td className="text-muted">{CATEGORY_LABEL[t.category]}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        {t.body && <Link href={`/forms/new?templateId=${t.id}${t.formType ? `&formType=${t.formType}` : ""}${t.state !== "US" ? `&state=${t.state}` : ""}`} className="text-sm font-medium text-navy hover:underline">Use</Link>}
                        <ActionForm action={deleteTemplate.bind(null, t.id)} submitLabel="Remove" submitVariant="ghost" inline confirm={`Remove “${t.title}” from the library?`} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Upload to a state's library" />
          <CardBody>
            <ActionForm action={uploadTemplate} submitLabel="Upload" resetOnSuccess>
              <div className="flex flex-col gap-3">
                <Field label="File (PDF, Word, or text)"><Input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.md" required className="h-auto py-1.5" /></Field>
                <Field label="Title"><Input name="title" placeholder="e.g. Alabama lease (attorney approved 2026)" maxLength={200} /></Field>
                <Field label="State">
                  <Select name="state" defaultValue={state ?? ""} required>
                    <option value="" disabled>Pick…</option>
                    <option value="US">Federal (all states)</option>
                    {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Type">
                  <Select name="category" defaultValue={cat ?? "LEASE"}>
                    {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </Select>
                </Field>
                <p className="text-xs text-muted"><Upload size={12} className="inline" /> Text files become editable templates the AI can start from. PDFs and Word files are stored for reference.</p>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Landlord details" subtitle="Printed on every new form: who the agreement is with and where notices go." />
        <CardBody>
          <ActionForm action={saveLandlordDetails} submitLabel="Save details">
            <FormGrid>
              <Field label="Owner (legal name)"><Input name="ownerName" defaultValue={landlord.ownerName} placeholder="VCG Veterans Housing Fund I, LLC" /></Field>
              <Field label="Property manager (if different)"><Input name="managerName" defaultValue={landlord.managerName} placeholder="Venture Collective Group" /></Field>
              <Field label="Notice address"><Input name="address" defaultValue={landlord.address} placeholder="Street, City, State ZIP" /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={landlord.phone} /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={landlord.email} /></Field>
            </FormGrid>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
