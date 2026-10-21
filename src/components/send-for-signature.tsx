"use client";

import { useActionState, useState } from "react";
import { Copy, Check } from "lucide-react";
import { sendForSignature, newSigningLink, cancelSignatureRequest, retryCompletion, type SendResult } from "@/app/(app)/forms/sign-actions";
import { Button, Input, Select, Textarea } from "@/components/ui";

function CopyLink({ name, url }: { name: string; url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md bg-paper p-2 text-xs">
      <span className="shrink-0 font-medium">{name}</span>
      <input readOnly value={url} className="min-w-0 flex-1 bg-transparent font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => setDone(true))} className="inline-flex items-center gap-1 font-medium text-navy">
        {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ResultNote({ r }: { r: SendResult }) {
  if (!r) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className={r.error ? "text-sm text-red-700" : "text-sm text-emerald-700"}>{r.error ?? r.message}</p>
      {r.links?.map((l) => <CopyLink key={l.url} name={l.name} url={l.url} />)}
    </div>
  );
}

export function SendForSignature(p: {
  formId: string; tenant: { name: string; email: string | null; portal: boolean } | null; vendor: { name: string; email: string | null } | null;
  ownerName: string; isNotice: boolean; hideForm: boolean; alreadySigned?: boolean;
}) {
  const [state, action, pending] = useActionState(sendForSignature.bind(null, p.formId), null);
  const [rows, setRows] = useState(p.vendor ? 1 : 0);
  const [open, setOpen] = useState(!p.alreadySigned);
  if (state?.ok) return <ResultNote r={state} />;
  if (p.hideForm) return null;
  if (!open)
    return <button type="button" onClick={() => setOpen(true)} className="self-start text-xs font-medium text-navy hover:underline">Send for signature again (for example, after changes)</button>;
  return (
    <form action={action} className="flex flex-col gap-3 text-sm">
      {p.isNotice && (
        <p className="rounded-md bg-amber-50 p-2.5 text-xs text-amber-900">E-signing doesn&apos;t count as legally delivering a notice. Still serve it the way your state requires (for example, hand delivery or posting and mailing).</p>
      )}
      {p.tenant && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="tenant" defaultChecked className="mt-0.5 size-4 accent-navy" />
          <span>
            <b>{p.tenant.name}</b> (tenant)
            <span className="block text-xs text-muted">{p.tenant.portal ? "Signs in their resident portal" : p.tenant.email ? `Gets a private link at ${p.tenant.email}` : "No portal or email. Add an email below or invite them to the portal."}</span>
            {!p.tenant.portal && !p.tenant.email && <Input name="tenantEmail" type="email" placeholder="tenant@email.com" className="mt-1" />}
          </span>
        </label>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" name="owner" defaultChecked className="mt-0.5 size-4 accent-navy" />
        <span className="flex-1">
          <b>You</b> (landlord), signing here in the app as
          <Input name="ownerName" defaultValue={p.ownerName} placeholder="Your name and title" className="mt-1" required={false} />
        </span>
      </label>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-line p-2 sm:grid-cols-3">
          <Input name={`name${i}`} placeholder="Name" defaultValue={i === 0 && p.vendor ? p.vendor.name : ""} />
          <Input name={`email${i}`} type="email" placeholder="Email" defaultValue={i === 0 && p.vendor ? (p.vendor.email ?? "") : ""} />
          <Select name={`role${i}`} defaultValue={i === 0 && p.vendor ? "VENDOR" : "COSIGNER"}>
            <option value="COSIGNER">Co-signer / guarantor</option>
            <option value="TENANT">Another tenant</option>
            <option value="VENDOR">Vendor</option>
            <option value="OTHER">Other</option>
          </Select>
        </div>
      ))}
      {rows < 3 && <button type="button" onClick={() => setRows(rows + 1)} className="self-start text-xs font-medium text-navy hover:underline">+ Add another signer (gets a private link by email)</button>}
      <Textarea name="message" rows={2} maxLength={1000} placeholder="Message to signers (optional)" />
      {state?.error && <p className="text-red-700">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send for signature"}</Button>
    </form>
  );
}

export function NewLinkButton({ signerId }: { signerId: string }) {
  const [state, action, pending] = useActionState(newSigningLink.bind(null, signerId), null);
  return (
    <form action={action} className="flex flex-col gap-1">
      <button type="submit" disabled={pending} className="self-start text-xs font-medium text-navy hover:underline">{pending ? "…" : "New link"}</button>
      <ResultNote r={state} />
    </form>
  );
}

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelSignatureRequest.bind(null, requestId), null);
  return (
    <form action={action} onSubmit={(e) => { if (!confirm("Cancel this signature request? Signers' links will stop working.")) e.preventDefault(); }}>
      <button type="submit" disabled={pending} className="text-xs font-medium text-red-700 hover:underline">Cancel request</button>
      <ResultNote r={state} />
    </form>
  );
}

export function RetryButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(retryCompletion.bind(null, requestId), null);
  return (
    <form action={action}>
      <Button type="submit" variant="secondary" disabled={pending}>Create the signed PDF</Button>
      <ResultNote r={state} />
    </form>
  );
}
