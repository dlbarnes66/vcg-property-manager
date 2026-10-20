"use client";

import { Sparkles } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { approveAction, rejectActionForm } from "@/app/(app)/agent/actions";

export type ProposalView = { id: string; summary: string; status: "PROPOSED" | "EXECUTED" | "REJECTED" | "FAILED"; result?: string | null; error?: string | null; reason?: string | null; detail?: string | null };

const tone = { PROPOSED: "amber", EXECUTED: "green", REJECTED: "gray", FAILED: "red" } as const;
const label = { PROPOSED: "Needs your approval", EXECUTED: "Done", REJECTED: "Dismissed", FAILED: "Failed" };

export function ProposalCard({ p }: { p: ProposalView }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{p.summary}</div>
          {p.reason && <div className="mt-0.5 text-xs text-muted">{p.reason}</div>}
          {p.detail && <pre className="mt-2 max-h-48 overflow-auto rounded bg-white p-2 text-xs whitespace-pre-wrap text-ink">{p.detail}</pre>}
          {p.detail?.includes("{{") && <div className="mt-1 text-[11px] text-muted">Fill-ins like {"{{balance}}"} are completed with each recipient&apos;s details when it&apos;s sent.</div>}
          {p.result && <div className="mt-1 text-xs text-emerald-700">{p.result}</div>}
          {p.error && <div className="mt-1 text-xs text-red-700">{p.error}</div>}
        </div>
        <Badge tone={tone[p.status]}>{label[p.status]}</Badge>
      </div>
      {p.status === "PROPOSED" && (
        <div className="mt-2 flex flex-wrap gap-2 pl-6">
          <ActionForm action={approveAction.bind(null, p.id)} submitLabel="Approve" inline />
          <ActionForm action={rejectActionForm.bind(null, p.id)} submitLabel="Dismiss" submitVariant="ghost" inline />
        </div>
      )}
    </div>
  );
}
