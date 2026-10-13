import { headers } from "next/headers";
import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Card, CardHeader, Empty, Input } from "@/components/ui";
import { DOC_CATEGORIES } from "@/lib/enums";
import { fmtDate, titleCase } from "@/lib/utils";
import { deleteDocument, uploadDocuments } from "@/app/(app)/documents/actions";

type Link = Partial<Record<"propertyId" | "unitId" | "tenantId" | "leaseId" | "maintenanceId" | "inspectionId", string>>;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Drop-in documents list + upload box for any record (property, tenant, lease, work order, inspection). */
export async function DocumentsPanel({ link, defaultCategory = "OTHER" }: { link: Link; defaultCategory?: string }) {
  const docs = await db.document.findMany({ where: link, orderBy: { createdAt: "desc" } });
  const h = await headers();
  const returnPath = h.get("x-pathname") ?? "/documents";

  return (
    <Card>
      <CardHeader title="Documents" subtitle={`${docs.length} file${docs.length === 1 ? "" : "s"}`} />
      {docs.length === 0 ? (
        <Empty>No documents yet.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <FileText size={16} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate hover:underline">
                  {d.name}
                </a>
                <div className="text-xs text-muted">
                  {fmtDate(d.createdAt)} · {formatBytes(d.size)}
                </div>
              </div>
              <Badge>{titleCase(d.category)}</Badge>
              <ActionForm action={deleteDocument.bind(null, d.id, returnPath)} submitLabel="Delete" submitVariant="ghost" confirm={`Delete ${d.name}?`} inline />
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line p-4">
        <ActionForm action={uploadDocuments} submitLabel="Upload" resetOnSuccess>
          {Object.entries(link).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <input type="hidden" name="returnPath" value={returnPath} />
          <Input type="file" name="files" multiple className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-paper file:px-2 file:py-1 file:text-xs" />
          <EnumSelect name="category" values={DOC_CATEGORIES} defaultValue={defaultCategory} />
        </ActionForm>
      </div>
    </Card>
  );
}
