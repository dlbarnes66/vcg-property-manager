import { SignaturePanel } from "@/components/signature-panel";
import { recordView, signerByToken } from "@/lib/esign";
import { requestMeta } from "@/lib/request-meta";

// Private signing links: keep them out of search engines and don't leak the URL to other sites.
export const metadata = { title: "Review and sign", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function LinkSign({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const s = await signerByToken(token);
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen">
      <header className="bg-navy">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="text-[10px] font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
          <div className="text-base font-semibold text-white">Document signing</div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
  if (!s || s.request.status === "CANCELLED")
    return shell(<p className="rounded-lg border border-line bg-white p-6 text-sm">This signing link has expired or is no longer valid. Please ask the sender for a new link.</p>);
  await recordView(s.id, await requestMeta());
  return shell(
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{s.request.title}</h1>
        <p className="text-sm text-muted">For {s.name}{s.email ? ` (${s.email})` : ""}. This link is only for you; please don&apos;t forward it.</p>
      </div>
      <SignaturePanel
        title={s.request.title} body={s.request.bodySnapshot} pdfUrl={`/api/sign/${s.id}/pdf?token=${encodeURIComponent(token)}`}
        finalUrl={s.request.signedDocumentId ? `/api/sign/${s.id}/pdf?token=${encodeURIComponent(token)}&final=1` : null}
        signerName={s.name} message={s.request.message} token={token} status={s.status} requestStatus={s.request.status}
        others={s.request.signers.filter((o) => o.id !== s.id).map((o) => ({ name: o.name, status: o.status }))}
      />
    </div>,
  );
}
