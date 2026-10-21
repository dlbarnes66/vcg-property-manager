"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { startBlank, startFromTemplate } from "@/app/(app)/forms/actions";
import { FormMarkdown } from "@/components/form-markdown";
import { Button, Card, CardBody, CardHeader, Field, Select, Textarea } from "@/components/ui";
import { CATEGORY_LABEL, CATEGORY_ORDER, FORM_TYPES, formType } from "@/lib/forms/catalog";
import { NOTES_MARKER } from "@/lib/forms/marker";
import { readDraftStream } from "@/lib/forms/stream-client";
import { STATES } from "@/lib/states";

type Opt = { id: string; label: string; state?: string | null };
type Tpl = { id: string; title: string; state: string; category: string; formType: string | null };

export function FormGenerator(p: {
  aiReady: boolean;
  leases: Opt[];
  tenants: Opt[];
  properties: Opt[];
  vendors: Opt[];
  templates: Tpl[];
  initial: { formType?: string; state?: string; leaseId?: string; tenantId?: string; propertyId?: string; vendorId?: string; templateId?: string };
}) {
  const router = useRouter();
  const [type, setType] = useState(p.initial.formType && formType(p.initial.formType) ? p.initial.formType : "residential-lease");
  const ft = formType(type)!;
  const [leaseId, setLeaseId] = useState(p.initial.leaseId ?? "");
  const [tenantId, setTenantId] = useState(p.initial.tenantId ?? "");
  const [propertyId, setPropertyId] = useState(p.initial.propertyId ?? "");
  const [vendorId, setVendorId] = useState(p.initial.vendorId ?? "");
  const subjectState = (ft.needs === "lease" ? p.leases.find((l) => l.id === leaseId)?.state : ft.needs === "property" || ft.needs === "vendor" ? p.properties.find((x) => x.id === propertyId)?.state : null) ?? null;
  const [stateChoice, setStateChoice] = useState(p.initial.state ?? "");
  const state = stateChoice || subjectState || "";
  const [templateId, setTemplateId] = useState(p.initial.templateId ?? "");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const templates = useMemo(() => p.templates.filter((t) => (t.state === state || t.state === "US") && (t.formType === type || t.category === ft.category)), [p.templates, state, type, ft.category]);
  const preview = text.split(NOTES_MARKER)[0];

  const subjectFd = () => {
    const fd = new FormData();
    fd.set("formType", type);
    fd.set("state", state);
    if (ft.needs === "lease" && leaseId) fd.set("leaseId", leaseId);
    if (ft.needs === "tenant" && tenantId) fd.set("tenantId", tenantId);
    if ((ft.needs === "property" || ft.needs === "vendor") && propertyId) fd.set("propertyId", propertyId);
    if (ft.needs === "vendor" && vendorId) fd.set("vendorId", vendorId);
    return fd;
  };

  async function generate() {
    setError(null);
    if (!state) return setError("Pick the state this form is for.");
    setBusy(true);
    setText("");
    try {
      const fd = subjectFd();
      const res = await fetch("/api/forms/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(fd), templateId: templateId || undefined, instructions }),
      });
      const id = await readDraftStream(res, (t) => setText((s) => s + t));
      router.push(`/forms/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  function manual(kind: "blank" | "template") {
    setError(null);
    if (!state) return setError("Pick the state this form is for.");
    const fd = subjectFd();
    if (kind === "template") fd.set("templateId", templateId);
    start(async () => {
      const r = await (kind === "blank" ? startBlank(null, fd) : startFromTemplate(null, fd));
      if (r?.error) setError(r.error);
    });
  }

  const pick = (label: string, value: string, set: (v: string) => void, opts: Opt[], blank: string) => (
    <Field label={label}>
      <Select value={value} onChange={(e) => set(e.target.value)} disabled={busy}>
        <option value="">{blank}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-2">
        <CardHeader title="What do you need?" />
        <CardBody className="flex flex-col gap-4">
          <Field label="Form">
            <Select value={type} onChange={(e) => { setType(e.target.value); setTemplateId(""); }} disabled={busy}>
              {CATEGORY_ORDER.filter((c) => FORM_TYPES.some((f) => f.category === c)).map((c) => (
                <optgroup key={c} label={CATEGORY_LABEL[c]}>
                  {FORM_TYPES.filter((f) => f.category === c).map((f) => <option key={f.key} value={f.key}>{f.title}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <p className="-mt-2 text-xs text-muted">{ft.description}</p>

          {ft.needs === "lease" && pick("Lease (fills in tenant, unit, rent, HAP)", leaseId, setLeaseId, p.leases, "None — leave blanks")}
          {ft.needs === "tenant" && pick("Tenant", tenantId, setTenantId, p.tenants, "None — leave blanks")}
          {(ft.needs === "property" || ft.needs === "vendor") && pick("Property", propertyId, setPropertyId, p.properties, "None")}
          {ft.needs === "vendor" && pick("Vendor", vendorId, setVendorId, p.vendors, "None — leave blanks")}

          <Field label="State">
            <Select value={state} onChange={(e) => setStateChoice(e.target.value)} disabled={busy}>
              <option value="">Pick a state…</option>
              {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </Select>
            <span className="text-xs text-muted">
              {subjectState && !stateChoice ? "From the property's address. " : ""}
              {state && <a href={`/resources/states/${state}`} target="_blank" rel="noreferrer" className="font-medium text-navy hover:underline">See {STATES.find((s) => s.code === state)?.name} rules ↗</a>}
            </span>
          </Field>

          {templates.length > 0 && (
            <Field label="Start from your library (optional)">
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
                <option value="">No — draft from scratch</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.state})</option>)}
              </Select>
            </Field>
          )}

          <Field label="Anything specific? (optional)">
            <Textarea rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} disabled={busy} maxLength={4000}
              placeholder="e.g. 12-month term starting Nov 1; tenant has one cat; no smoking anywhere on the property; water included." />
          </Field>

          {ft.highStakes && (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900">
              This form has legal consequences. Have an attorney licensed in {STATES.find((s) => s.code === state)?.name ?? "your state"} review the AI&apos;s draft before you use it the first time, then save the approved version to your library.
            </p>
          )}
          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={generate} disabled={busy || pending || !p.aiReady}>
              <Sparkles size={14} className="mr-1.5" /> {busy ? "Writing…" : "Draft with AI"}
            </Button>
            {templateId && <Button type="button" variant="secondary" onClick={() => manual("template")} disabled={busy || pending}>Use template as-is</Button>}
            <Button type="button" variant="ghost" onClick={() => manual("blank")} disabled={busy || pending}>Start blank</Button>
          </div>
          {!p.aiReady && <p className="text-xs text-muted">AI drafting needs ANTHROPIC_API_KEY in .env. You can still start from a template or a blank page.</p>}
        </CardBody>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader title={busy ? "Drafting…" : "Preview"} subtitle={busy ? "A full lease can take a minute or two. You'll be taken to the editor when it's done." : undefined} />
        <CardBody className="max-h-[75vh] overflow-y-auto">
          {preview ? <FormMarkdown text={preview} /> : <p className="py-16 text-center text-sm text-muted">The draft will appear here as it&apos;s written.</p>}
        </CardBody>
      </Card>
    </div>
  );
}
