import { BedDouble, Bath, CalendarDays } from "lucide-react";
import { db } from "@/lib/db";
import { PublicShell } from "@/components/public-shell";
import { fmtDate, money, todayUTC } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Homes for rent" };

export default async function RentalsPage() {
  const listings = await db.listing.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include: { unit: { include: { property: true } }, documents: { where: { mimeType: { startsWith: "image/" } }, take: 1, orderBy: { createdAt: "asc" } } },
  });
  const today = todayUTC();
  return (
    <PublicShell>
      <h1 className="text-2xl font-semibold">Available homes</h1>
      <p className="mt-1 text-sm text-muted">Veterans and housing voucher holders welcome.</p>
      {listings.length === 0 ? (
        <p className="mt-10 text-center text-muted">No homes are available right now. Please check back soon.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {listings.map((l) => (
            <a key={l.id} href={`/apply/${l.slug}`} className="overflow-hidden rounded-lg border border-line bg-white transition-shadow hover:shadow-md">
              {l.documents[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/listing-photo/${l.documents[0].id}`} alt="" className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-paper text-sm text-muted">Photos coming soon</div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold">{l.headline}</h2>
                  <span className="tabular shrink-0 font-semibold">{money(l.rent)}<span className="text-xs font-normal text-muted">/mo</span></span>
                </div>
                <p className="mt-0.5 text-sm text-muted">{l.unit.property.city}, {l.unit.property.state}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                  <span className="flex items-center gap-1"><BedDouble size={14} /> {l.unit.bedrooms} bd</span>
                  <span className="flex items-center gap-1"><Bath size={14} /> {l.unit.bathrooms} ba</span>
                  <span className="flex items-center gap-1"><CalendarDays size={14} /> {!l.availableDate || l.availableDate <= today ? "Available now" : `Available ${fmtDate(l.availableDate)}`}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
