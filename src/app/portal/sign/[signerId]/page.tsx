import { notFound } from "next/navigation";
import { SignaturePanel } from "@/components/signature-panel";
import { requireTenant } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordView } from "@/lib/esign";
import { requestMeta } from "@/lib/request-meta";

export const metadata = { title: "Sign" };

export default async function PortalSign({ params }: { params: Promise<{ signerId: string }> }) {
  const { tenant } = await requireTenant();
  const { signerId } = await params;
  const s = await db.signer.findUnique({ where: { id: signerId }, include: { request: { include: { signers: true } } } });
  if (!s || s.tenantId !== tenant.id || s.tokenHash || s.request.status === "CANCELLED") notFound();
  await recordView(s.id, await requestMeta());
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{s.request.title}</h1>
      <SignaturePanel
        title={s.request.title} body={s.request.bodySnapshot} pdfUrl={`/api/sign/${s.id}/pdf`} finalUrl={s.request.signedDocumentId ? `/api/sign/${s.id}/pdf?final=1` : null}
        signerName={s.name} message={s.request.message} signerId={s.id} status={s.status} requestStatus={s.request.status}
        others={s.request.signers.filter((o) => o.id !== s.id).map((o) => ({ name: o.name, status: o.status }))}
      />
    </div>
  );
}
