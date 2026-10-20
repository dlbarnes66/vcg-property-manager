"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";
import { smsSegments } from "@/lib/sms-count";

type Opt = { id: string; label: string };
export type ComposerTemplate = { id: string; name: string; channel: "EMAIL" | "SMS" | "CALL" | "OTHER"; subject: string | null; body: string };
type AudienceKind = "tenant" | "case-manager" | "property" | "all-tenants" | "vendor" | "pha";

const AUDIENCES: { kind: AudienceKind; label: string }[] = [
  { kind: "tenant", label: "A tenant" },
  { kind: "property", label: "All tenants at a property" },
  { kind: "all-tenants", label: "All current tenants" },
  { kind: "case-manager", label: "A tenant's case manager" },
  { kind: "vendor", label: "A vendor" },
  { kind: "pha", label: "A housing authority" },
];

export function Composer({
  action,
  templates,
  tenants,
  properties,
  vendors,
  phas,
  lockTo,
  defaultChannel = "EMAIL",
  returnPath,
  emailReady,
  smsReady,
  context,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  templates: ComposerTemplate[];
  tenants: Opt[];
  properties: Opt[];
  vendors: Opt[];
  phas: Opt[];
  /** Fixed recipient (e.g. on a tenant's page). */
  lockTo?: { kind: AudienceKind; id: string; label: string };
  defaultChannel?: "EMAIL" | "SMS";
  returnPath: string;
  emailReady: boolean;
  smsReady: boolean;
  context?: { leaseId?: string; maintenanceId?: string };
}) {
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(defaultChannel);
  const [kind, setKind] = useState<AudienceKind>(lockTo?.kind ?? "tenant");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const options: Record<string, Opt[]> = { tenant: tenants, "case-manager": tenants, property: properties, vendor: vendors, pha: phas };
  const usable = templates.filter((t) => t.channel === channel);
  const ready = channel === "EMAIL" ? emailReady : smsReady;
  const bulk = kind === "property" || kind === "all-tenants";

  return (
    <ActionForm
      action={action}
      submitLabel={channel === "EMAIL" ? "Send email" : "Send text"}
      resetOnSuccess
      confirm={bulk ? "Send this to every matching tenant?" : undefined}
      onSuccess={() => {
        setBody("");
        setSubject("");
      }}
    >
      <input type="hidden" name="returnPath" value={returnPath} />
      <input type="hidden" name="channel" value={channel} />
      {context?.leaseId && <input type="hidden" name="leaseId" value={context.leaseId} />}
      {context?.maintenanceId && <input type="hidden" name="maintenanceId" value={context.maintenanceId} />}

      <div className="flex gap-1 rounded-md bg-paper p-1 text-sm" role="tablist">
        {(["EMAIL", "SMS"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={channel === c}
            onClick={() => setChannel(c)}
            className={`flex-1 rounded px-3 py-1.5 ${channel === c ? "bg-white font-medium shadow-sm" : "text-muted"}`}
          >
            {c === "EMAIL" ? "Email" : "Text message"}
          </button>
        ))}
      </div>
      {!ready && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
          {channel === "EMAIL" ? "Email isn't set up yet (SendGrid)." : "Texting isn't set up yet (Twilio)."} See the README to connect it.
        </p>
      )}

      {lockTo ? (
        <>
          <input type="hidden" name="audience" value={lockTo.kind} />
          <input type="hidden" name={`${lockTo.kind}Id`} value={lockTo.id} />
          <p className="text-sm">
            <span className="text-muted">To:</span> {lockTo.label}
          </p>
        </>
      ) : (
        <>
          <Field label="To">
            <Select name="audience" value={kind} onChange={(e) => setKind(e.target.value as AudienceKind)}>
              {AUDIENCES.map((a) => (
                <option key={a.kind} value={a.kind}>{a.label}</option>
              ))}
            </Select>
          </Field>
          {kind !== "all-tenants" && (
            <Select name={`${kind}Id`} required defaultValue="" key={kind} aria-label="Recipient">
              <option value="" disabled>Choose…</option>
              {options[kind].map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </Select>
          )}
          {bulk && channel === "SMS" && <p className="text-xs text-muted">Only tenants marked "OK to text" will get it. "Reply STOP to opt out" is added automatically.</p>}
        </>
      )}

      {usable.length > 0 && (
        <Select
          aria-label="Use a template"
          defaultValue=""
          onChange={(e) => {
            const t = usable.find((x) => x.id === e.target.value);
            if (t) {
              setBody(t.body);
              setSubject(t.subject ?? "");
            }
          }}
        >
          <option value="">Start from a template…</option>
          {usable.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      )}
      {channel === "EMAIL" && (
        <Field label="Subject">
          <Input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} />
        </Field>
      )}
      <Field
        label="Message"
        hint={
          channel === "SMS"
            ? (() => { const n = body ? smsSegments(body) : 0; return `${body.length} characters · ${n} text segment${n === 1 ? "" : "s"}`; })()
            : "Merge fields: {{firstName}} {{property}} {{unit}} {{rent}} {{balance}} {{dueDate}}"
        }
      >
        <Textarea name="body" rows={channel === "SMS" ? 4 : 7} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={channel === "SMS" ? 1600 : 20000} />
      </Field>
    </ActionForm>
  );
}
