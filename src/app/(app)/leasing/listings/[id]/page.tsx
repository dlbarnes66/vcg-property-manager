import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Textarea } from "@/components/ui";
import { appLabel, appTone } from "@/lib/leasing-labels";
import { centsToInput, dateToInput, fmtDate } from "@/lib/utils";
import { setListingStatus, updateListing } from "../../actions";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await db.listing.findUnique({
    where: { id },
    include: { unit: { include: { property: true } }, applications: { orderBy: { createdAt: "desc" } } },
  });
  if (!l) notFound();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const link = `${appUrl}/apply/${l.slug}`;

  return (
    <>
      <PageHeader
        title={`${l.unit.property.name} · ${l.unit.label}`}
        subtitle={<Badge tone={l.status === "PUBLISHED" ? "green" : l.status === "DRAFT" ? "amber" : "gray"}>{l.status === "PUBLISHED" ? "Live" : l.status === "DRAFT" ? "Draft" : "Closed"}</Badge>}
        back={{ href: "/leasing", label: "Leasing" }}
        actions={
          <>
            {l.status !== "PUBLISHED" && <ActionForm action={setListingStatus.bind(null, id, "PUBLISHED")} submitLabel="Publish" inline />}
            {l.status === "PUBLISHED" && <ActionForm action={setListingStatus.bind(null, id, "DRAFT")} submitLabel="Unpublish" submitVariant="secondary" inline />}
            {l.status !== "CLOSED" && <ActionForm action={setListingStatus.bind(null, id, "CLOSED")} submitLabel="Close" submitVariant="ghost" inline confirm="Close this listing? It stops taking applications." />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Public application link" subtitle={l.status === "PUBLISHED" ? "Share it anywhere: Zillow, Facebook, the VA, your HUD-VASH contacts." : "Publish the listing to start taking applications."} />
            <CardBody className="flex flex-wrap items-center gap-3 text-sm">
              <Input readOnly value={link} className="flex-1 font-mono text-xs" aria-label="Application link" />
              {l.status === "PUBLISHED" && <a href={`/apply/${l.slug}`} target="_blank" rel="noreferrer" className="text-navy underline">Preview</a>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Listing details" />
            <CardBody>
              <ActionForm action={updateListing.bind(null, id)} submitLabel="Save">
                <Field label="Headline *"><Input name="headline" defaultValue={l.headline} required maxLength={120} /></Field>
                <FormGrid>
                  <Field label="Rent *"><Input name="rent" inputMode="decimal" defaultValue={centsToInput(l.rent)} required /></Field>
                  <Field label="Deposit"><Input name="deposit" inputMode="decimal" defaultValue={centsToInput(l.deposit)} /></Field>
                  <Field label="Available"><Input type="date" name="availableDate" defaultValue={dateToInput(l.availableDate)} /></Field>
                  <Field label="Utilities included"><Input name="utilitiesIncluded" defaultValue={l.utilitiesIncluded ?? ""} placeholder="Water, trash" /></Field>
                  <Field label="Pets" className="sm:col-span-2"><Input name="petPolicy" defaultValue={l.petPolicy ?? ""} placeholder="Cats OK; service and support animals always welcome" /></Field>
                </FormGrid>
                <Field label="Description"><Textarea name="description" rows={6} defaultValue={l.description ?? ""} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acceptsVouchers" defaultChecked={l.acceptsVouchers} className="size-4 accent-navy" /> Housing vouchers welcome (HUD-VASH, HCV)</label>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title={`Applications (${l.applications.length})`} />
            {l.applications.length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {l.applications.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <Link href={`/leasing/applications/${a.id}`} className="hover:underline">{a.firstName} {a.lastName}</Link>
                    <span className="flex items-center gap-2 text-xs text-muted">{fmtDate(a.createdAt)} <Badge tone={appTone(a.status)}>{appLabel[a.status]}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <DocumentsPanel link={{ listingId: id }} defaultCategory="PHOTO" />
          <p className="text-xs text-muted">Photos (JPG, PNG, WebP) attached here appear on the public listing while it&apos;s live. Other files stay private.</p>
        </div>
      </div>
    </>
  );
}
