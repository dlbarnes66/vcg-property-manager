import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Download, FileText } from "lucide-react";
import { deleteForm, saveAsTemplate, toggleShare } from "../actions";
import { ActionForm } from "@/components/action-form";
import { FormEditor } from "@/components/form-editor";
import { MiniMarkdown } from "@/components/mini-markdown";
import { Badge, Card, CardBody, CardHeader, DetailList, Field, Input, PageHeader, Select } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/assistant";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, formType } from "@/lib/forms/catalog";
import { tenantName } from "@/lib/queries";
import { STATES, stateName } from "@/lib/states";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Form" };

export default async function FormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await db.formDoc.findUnique({ where: { id }, include: { tenant: true, lease: true, property: true, unit: true, vendor: true, document: true, template: true } });
  if (!f) notFound();
  const ft = formType(f.formType);

  return (
    <>
      <PageHeader
        back={{ href: `/forms?state=${f.state}`, label: `${stateName(f.state)} forms` }}
        title={f.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone="navy">{stateName(f.state)}</Badge>{ft?.title ?? CATEGORY_LABEL[f.category]}{f.status === "FINAL" ? <Badge tone="green">Finished</Badge> : <Badge tone="amber">Draft</Badge>}</span>}
        actions={<a href={`/api/forms/${f.id}/pdf`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-paper"><Download size={14} /> Preview PDF</a>}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <FormEditor id={f.id} title={f.title} body={f.body} status={f.status} canShare={Boolean(f.tenantId)} shared={Boolean(f.document?.sharedWithTenant)} aiReady={aiConfigured()} />
        </div>
        <div className="flex flex-col gap-6">
          {f.reviewNotes && (
            <Card className="border-amber-200 bg-amber-50/60">
              <CardHeader title="Check before using" subtitle="From the AI. Not printed on the form." />
              <CardBody className="text-sm text-amber-950">
                <MiniMarkdown text={f.reviewNotes} />
                <p className="mt-3 flex gap-1.5 text-xs text-amber-900"><AlertTriangle size={14} className="shrink-0" /> AI drafts are a starting point, not legal advice. Laws change and vary by city and county.</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                items={[
                  ["State", stateName(f.state)],
                  ["Tenant", f.tenant ? <Link href={`/tenants/${f.tenant.id}`} className="hover:underline">{tenantName(f.tenant)}</Link> : "—"],
                  ["Lease", f.lease ? <Link href={`/leases/${f.lease.id}`} className="hover:underline">{f.property?.name}{f.unit ? ` · ${f.unit.label}` : ""}</Link> : (f.property?.name ?? "—")],
                  ...(f.vendor ? [["Vendor", f.vendor.name] as [string, React.ReactNode]] : []),
                  ["Started from", f.template ? f.template.title : f.model ? "AI draft" : "Blank"],
                  ["Saved PDF", f.document ? <a href={`/api/documents/${f.document.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><FileText size={13} /> {f.document.name}</a> : "Not yet"],
                  ["Last updated", fmtDate(f.updatedAt)],
                ]}
              />
              {f.document && f.tenantId && (
                <div className="mt-4 flex items-center justify-between gap-3 rounded-md bg-paper px-3 py-2 text-sm">
                  <span>{f.document.sharedWithTenant ? "Visible in the tenant's portal" : "Not shared with the tenant"}</span>
                  <ActionForm action={toggleShare.bind(null, f.id, !f.document.sharedWithTenant)} submitLabel={f.document.sharedWithTenant ? "Stop sharing" : "Share"} submitVariant="secondary" inline />
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Save to library" subtitle="Reuse this wording for other tenants in the same state." />
            <CardBody>
              <ActionForm action={saveAsTemplate.bind(null, f.id)} submitLabel="Save to library" submitVariant="secondary">
                <div className="flex flex-col gap-3">
                  <Field label="Name"><Input name="title" defaultValue={f.title} maxLength={200} required /></Field>
                  <Field label="State">
                    <Select name="state" defaultValue={f.state}>
                      <option value="US">Federal (all states)</option>
                      {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                    </Select>
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <ActionForm action={deleteForm.bind(null, f.id)} submitLabel="Delete this form" submitVariant="ghost" confirm="Delete this form? A PDF already saved to Documents stays there." />
        </div>
      </div>
    </>
  );
}
