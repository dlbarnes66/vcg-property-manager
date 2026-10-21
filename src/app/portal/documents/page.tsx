import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { ToSignBanner } from "@/components/to-sign-banner";
import { pendingForTenant } from "@/lib/esign";
import { tenantDocumentWhere } from "@/lib/portal-data";
import { Badge, Card, Empty } from "@/components/ui";
import { fmtDate, formatBytes, titleCase } from "@/lib/utils";

export const metadata = { title: "Documents" };

export default async function PortalDocuments() {
  const { tenant } = await requireTenant();
  const docs = await db.document.findMany({ where: await tenantDocumentWhere(tenant.id), orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Documents</h1>
      <ToSignBanner items={(await pendingForTenant(tenant.id)).map((s) => ({ id: s.id, title: s.request.title, sentAt: s.request.createdAt }))} hrefFor={(id) => `/portal/sign/${id}`} />
      <Card>
        {docs.length === 0 ? (
          <Empty>No documents have been shared with you yet. Your lease and notices will show up here.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id}>
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-paper/50">
                  <FileText size={18} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.name}</span>
                    <span className="text-xs text-muted">{fmtDate(d.createdAt)} · {formatBytes(d.size)}</span>
                  </span>
                  <Badge>{titleCase(d.category)}</Badge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
