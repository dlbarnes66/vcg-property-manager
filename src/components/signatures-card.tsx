import Link from "next/link";
import { CancelRequestButton, NewLinkButton, RetryButton, SendForSignature } from "@/components/send-for-signature";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { fmtLocal } from "@/lib/dates";
import { db } from "@/lib/db";
import { getLandlord } from "@/lib/settings";

const tone = { PENDING: "amber", SIGNED: "green", DECLINED: "red", COMPLETED: "green", CANCELLED: "gray" } as const;
const label = { PENDING: "Waiting", SIGNED: "Signed", DECLINED: "Declined", COMPLETED: "Completed", CANCELLED: "Cancelled" } as const;

/** "Get it signed" on a form: send, track each signer, audit trail, signed copy. */
export async function SignaturesCard({ formId }: { formId: string }) {
  const [form, requests, landlord] = await Promise.all([
    db.formDoc.findUniqueOrThrow({ where: { id: formId }, include: { tenant: true, vendor: true } }),
    db.signatureRequest.findMany({ where: { formDocId: formId }, orderBy: { createdAt: "desc" }, include: { signers: { orderBy: { createdAt: "asc" } }, events: { orderBy: { at: "asc" }, include: { signer: true } } } }),
    getLandlord(),
  ]);
  const open = requests.find((r) => r.status === "PENDING");
  return (
    <Card>
      <CardHeader title="Signatures" subtitle={form.status === "FINAL" ? "Free built-in e-signing with a signature certificate and audit trail." : "Finish the form (save the PDF) first, then send it for signature."} />
      <CardBody className="flex flex-col gap-5">
        {form.status === "FINAL" && (
          // Stays mounted after sending so any links to copy remain on screen.
          <SendForSignature
            hideForm={!!open}
            alreadySigned={requests.some((r) => r.status === "COMPLETED")}
            formId={form.id}
            tenant={form.tenant ? { name: `${form.tenant.firstName} ${form.tenant.lastName}`, email: form.tenant.email, portal: form.tenant.portalEnabled } : null}
            vendor={form.vendor ? { name: form.vendor.name, email: form.vendor.email } : null}
            ownerName={landlord.managerName || landlord.ownerName}
            isNotice={form.category === "NOTICE"}
          />
        )}
        {requests.map((r) => {
          const allSigned = r.signers.every((s) => s.status === "SIGNED");
          return (
            <div key={r.id} className="flex flex-col gap-2 border-t border-line pt-4 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Sent {fmtLocal(r.createdAt, true)}</span>
                <Badge tone={tone[r.status]}>{label[r.status]}</Badge>
              </div>
              <ul className="flex flex-col gap-2">
                {r.signers.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <span>
                      <b>{s.name}</b> <span className="text-xs text-muted">({s.role.toLowerCase()}{s.isOwner ? ", you" : s.tokenHash ? `, link · ${s.email}` : ", portal"})</span>
                      {s.signedAt && <span className="block text-xs text-muted">Signed {fmtLocal(s.signedAt, true)}</span>}
                      {s.declinedReason && <span className="block text-xs text-red-700">Declined: {s.declinedReason}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={tone[s.status]}>{label[s.status]}</Badge>
                      {r.status === "PENDING" && s.status === "PENDING" && s.isOwner && <Link href={`/forms/sign/${s.id}`} className="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white">Sign now</Link>}
                      {r.status === "PENDING" && s.status === "PENDING" && s.tokenHash && <NewLinkButton signerId={s.id} />}
                    </span>
                  </li>
                ))}
              </ul>
              {r.signedDocumentId && <a href={`/api/documents/${r.signedDocumentId}`} target="_blank" rel="noreferrer" className="text-sm font-medium text-navy hover:underline">Download the signed PDF (with certificate)</a>}
              {r.status === "PENDING" && allSigned && !r.signedDocumentId && <RetryButton requestId={r.id} />}
              {r.status === "PENDING" && <CancelRequestButton requestId={r.id} />}
              <details className="text-xs text-muted">
                <summary className="cursor-pointer">Audit trail ({r.events.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {r.events.map((e) => (
                    <li key={e.id}>{fmtLocal(e.at, true)} · {e.type.replace(/_/g, " ")}{e.signer ? ` · ${e.signer.name}` : ""}{e.ip ? ` · ${e.ip}` : ""}</li>
                  ))}
                </ul>
              </details>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
