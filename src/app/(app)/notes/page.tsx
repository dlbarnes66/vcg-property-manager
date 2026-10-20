import { Pin } from "lucide-react";
import { db } from "@/lib/db";
import { linkInclude, linkLabel } from "@/lib/links";
import { Card, Empty, Input, PageHeader } from "@/components/ui";
import { fmtLocal } from "@/lib/dates";

export const metadata = { title: "Notes" };

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const term = q?.trim();
  const notes = await db.note.findMany({
    where: term ? { body: { contains: term, mode: "insensitive" } } : undefined,
    include: linkInclude,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });

  return (
    <>
      <PageHeader title="Notes" subtitle="Every internal note across properties, tenants, leases, and work orders" />
      <form className="mb-4 max-w-md">
        <Input name="q" defaultValue={term} placeholder="Search notes…" />
      </form>
      <Card>
        {notes.length === 0 ? (
          <Empty>{term ? "No notes match." : "No notes yet. Add them from a property, tenant, lease, or work order page."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {notes.map((n) => {
              const l = linkLabel(n);
              return (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                    {n.pinned && <Pin size={12} className="text-gold" />}
                    {l && <a href={l.href} className="font-medium text-ink hover:underline">{l.label}</a>}
                    <span>· {fmtLocal(n.createdAt)}{n.authorEmail ? ` · ${n.authorEmail.split("@")[0]}` : ""}</span>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap">{n.body}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
