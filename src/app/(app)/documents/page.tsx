import Link from "next/link";
import { FileText } from "lucide-react";
import { db } from "@/lib/db";
import { formatBytes } from "@/components/documents-panel";
import { ActionForm } from "@/components/action-form";
import { EnumSelect } from "@/components/enum-select";
import { Badge, Card, CardBody, CardHeader, Empty, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { DOC_CATEGORIES } from "@/lib/enums";
import { cn, fmtDate, titleCase } from "@/lib/utils";
import { deleteDocument, uploadDocuments } from "./actions";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ category?: string; q?: string }> }) {
  const { category, q } = await searchParams;
  const cat = DOC_CATEGORIES.find((c) => c === category);
  const docs = await db.document.findMany({
    where: { category: cat, name: q ? { contains: q, mode: "insensitive" } : undefined },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      property: true,
      unit: { include: { property: true } },
      tenant: true,
      lease: { include: { unit: { include: { property: true } } } },
      maintenance: true,
    },
  });

  const linkFor = (d: (typeof docs)[number]) => {
    if (d.lease) return { href: `/leases/${d.leaseId}`, label: `Lease · ${d.lease.unit.property.name} ${d.lease.unit.label}` };
    if (d.maintenance) return { href: `/maintenance/${d.maintenanceId}`, label: `WO · ${d.maintenance.title}` };
    if (d.tenant) return { href: `/tenants/${d.tenantId}`, label: `${d.tenant.firstName} ${d.tenant.lastName}` };
    if (d.unit) return { href: `/properties/${d.unit.propertyId}`, label: `${d.unit.property.name} · ${d.unit.label}` };
    if (d.property) return { href: `/properties/${d.propertyId}`, label: d.property.name };
    return null;
  };

  return (
    <>
      <PageHeader title="Documents" subtitle="Everything uploaded across properties, tenants, leases, and work orders" />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <Link href="/documents" className={cn("rounded-md px-3 py-1.5 text-sm", !cat ? "bg-navy text-white" : "text-muted hover:bg-white")}>All</Link>
        {DOC_CATEGORIES.map((c) => (
          <Link key={c} href={`/documents?category=${c}`} className={cn("rounded-md px-3 py-1.5 text-sm", cat === c ? "bg-navy text-white" : "text-muted hover:bg-white")}>
            {titleCase(c)}
          </Link>
        ))}
        <form className="ml-auto w-56">
          {cat && <input type="hidden" name="category" value={cat} />}
          <Input name="q" defaultValue={q} placeholder="Search file names…" />
        </form>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {docs.length === 0 ? (
            <Empty>No documents.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>File</Th><Th>Category</Th><Th>Attached to</Th><Th>Uploaded</Th><Th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const l = linkFor(d);
                  return (
                    <tr key={d.id}>
                      <Td>
                        <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                          <FileText size={14} className="shrink-0 text-muted" />
                          <span className="max-w-[16rem] truncate">{d.name}</span>
                        </a>
                        <div className="pl-6 text-xs text-muted">{formatBytes(d.size)}</div>
                      </Td>
                      <Td><Badge>{titleCase(d.category)}</Badge></Td>
                      <Td className="text-muted">{l ? <Link href={l.href} className="hover:underline">{l.label}</Link> : "—"}</Td>
                      <Td className="whitespace-nowrap text-muted">{fmtDate(d.createdAt)}</Td>
                      <Td className="text-right">
                        <ActionForm action={deleteDocument.bind(null, d.id, "/documents")} submitLabel="Delete" submitVariant="ghost" inline confirm={`Delete ${d.name}?`} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Upload" subtitle="To attach a file to a lease, tenant, or work order, upload it from that record's page." />
          <CardBody>
            <ActionForm action={uploadDocuments} submitLabel="Upload" resetOnSuccess>
              <input type="hidden" name="returnPath" value="/documents" />
              <Field label="Files">
                <Input type="file" name="files" multiple className="h-auto py-1.5" />
              </Field>
              <Field label="Category">
                <EnumSelect name="category" values={DOC_CATEGORIES} defaultValue="OTHER" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
