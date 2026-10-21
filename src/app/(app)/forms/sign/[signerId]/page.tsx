import { notFound } from "next/navigation";
import { SignaturePanel } from "@/components/signature-panel";
import { PageHeader } from "@/components/ui";
import { requireAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordView } from "@/lib/esign";
import { requestMeta } from "@/lib/request-meta";

export const metadata = { title: "Sign" };

export default async function OwnerSign({ params }: { params: Promise<{ signerId: string }> }) {
  await requireAccess();
  const { signerId } = await params;
  const s = await db.signer.findUnique({ where: { id: signerId }, include: { request: { include: { signers: true } } } });
  if (!s || !s.isOwner) notFound();
  await recordView(s.id, await requestMeta());
  return (
    <>
      <PageHeader back={{ href: `/forms/${s.request.formDocId}`, label: "Back to the form" }} title={`Sign: ${s.request.title}`} subtitle={`Signing as ${s.name} (landlord)`} />
      <div className="max-w-3xl">
        <SignaturePanel
          title={s.request.title} body={s.request.bodySnapshot} pdfUrl={`/api/sign/${s.id}/pdf`} finalUrl={s.request.signedDocumentId ? `/api/sign/${s.id}/pdf?final=1` : null}
          signerName={s.name} signerId={s.id} status={s.status} requestStatus={s.request.status}
          others={s.request.signers.filter((o) => o.id !== s.id).map((o) => ({ name: o.name, status: o.status }))}
        />
      </div>
    </>
  );
}
