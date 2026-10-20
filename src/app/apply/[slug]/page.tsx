import { notFound } from "next/navigation";
import { BedDouble, Bath, CalendarDays, Check } from "lucide-react";
import { db } from "@/lib/db";
import { ApplicationForm } from "@/components/application-form";
import { PublicShell } from "@/components/public-shell";
import { Card, CardBody } from "@/components/ui";
import { fmtDate, money, todayUTC } from "@/lib/utils";
import { applyForListing } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const l = await db.listing.findUnique({ where: { slug }, select: { headline: true, status: true } });
  return { title: l?.status === "PUBLISHED" ? l.headline : "Rental application" };
}

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const l = await db.listing.findUnique({
    where: { slug },
    include: { unit: { include: { property: true } }, documents: { where: { mimeType: { startsWith: "image/" } }, orderBy: { createdAt: "asc" }, take: 8 } },
  });
  if (!l || l.status !== "PUBLISHED") notFound();
  const p = l.unit.property;
  const today = todayUTC();

  return (
    <PublicShell>
      <a href="/rentals" className="text-xs text-muted hover:text-ink">← All homes</a>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{l.headline}</h1>
          <p className="mt-1 text-sm text-muted">{p.street}, {p.city}, {p.state} {p.zip}</p>
        </div>
        <div className="text-right">
          <div className="tabular text-2xl font-semibold">{money(l.rent)}<span className="text-sm font-normal text-muted">/mo</span></div>
          {l.deposit > 0 && <div className="text-xs text-muted">{money(l.deposit)} deposit</div>}
        </div>
      </div>

      {l.documents.length > 0 && (
        <div className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2">
          {l.documents.map((d) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={d.id} src={`/api/listing-photo/${d.id}`} alt="" className="h-56 shrink-0 snap-start rounded-lg object-cover" />
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5"><BedDouble size={16} /> {l.unit.bedrooms} bedroom{l.unit.bedrooms === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-1.5"><Bath size={16} /> {l.unit.bathrooms} bath</span>
        {l.unit.sqft && <span>{l.unit.sqft} sq ft</span>}
        <span className="flex items-center gap-1.5"><CalendarDays size={16} /> {!l.availableDate || l.availableDate <= today ? "Available now" : `Available ${fmtDate(l.availableDate)}`}</span>
        {l.acceptsVouchers && <span className="flex items-center gap-1.5 text-emerald-700"><Check size={16} /> Vouchers welcome, including HUD-VASH</span>}
      </div>
      {l.description && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{l.description}</p>}
      {(l.utilitiesIncluded || l.petPolicy) && (
        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {l.utilitiesIncluded && <div><dt className="text-xs text-muted">Utilities included</dt><dd>{l.utilitiesIncluded}</dd></div>}
          {l.petPolicy && <div><dt className="text-xs text-muted">Pets</dt><dd>{l.petPolicy}</dd></div>}
        </dl>
      )}

      <Card className="mt-8">
        <CardBody>
          <h2 className="mb-1 text-lg font-semibold">Apply for this home</h2>
          <p className="mb-5 text-sm text-muted">It takes about 5 minutes. There&apos;s no application fee.</p>
          <ApplicationForm action={applyForListing.bind(null, slug)} />
        </CardBody>
      </Card>
    </PublicShell>
  );
}
