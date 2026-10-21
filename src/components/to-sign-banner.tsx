import Link from "next/link";
import { PenLine } from "lucide-react";

/** "Waiting for your signature" list (portal and admin). */
export function ToSignBanner({ items, hrefFor }: { items: { id: string; title: string; sentAt: Date }[]; hrefFor: (id: string) => string }) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-900"><PenLine size={15} /> Waiting for your signature</div>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-blue-950">{i.title}</span>
            <Link href={hrefFor(i.id)} className="shrink-0 rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white">Review &amp; sign</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
