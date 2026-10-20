import Link from "next/link";
import type { ApplicationStatus } from "@prisma/client";
import { appLabel, appTone } from "@/lib/leasing-labels";
import { db } from "@/lib/db";
import { inForceLeaseWhere } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, Empty, Field, FormGrid, Input, PageHeader, Select, Table, Td, Th, Textarea } from "@/components/ui";
import { cn, fmtDate, money } from "@/lib/utils";
import { createListing } from "./actions";

export const metadata = { title: "Leasing" };

export default async function LeasingPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "applications" ? "applications" : "listings";
  const statusFilter = (["NEW", "SCREENING", "APPROVED", "DENIED", "WITHDRAWN", "CONVERTED"] as const).find((s) => s === sp.status);
  const [listings, apps, units, newCount] = await Promise.all([
    db.listing.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], include: { unit: { include: { property: true } }, _count: { select: { applications: true } } } }),
    db.application.findMany({
      where: statusFilter ? { status: statusFilter } : { status: { in: ["NEW", "SCREENING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { listing: { include: { unit: { include: { property: true } } } } },
    }),
    db.unit.findMany({ orderBy: [{ property: { name: "asc" } }, { label: "asc" }], include: { property: true, leases: { where: inForceLeaseWhere(), select: { id: true } } } }),
    db.application.count({ where: { status: "NEW" } }),
  ]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <>
      <PageHeader
        title="Leasing"
        subtitle={<>Public rentals page: <a href="/rentals" target="_blank" className="underline">{appUrl}/rentals</a></>}
      />
      <div className="mb-4 flex gap-1">
        <Link href="/leasing" className={cn("rounded-md px-3 py-1.5 text-sm", tab === "listings" ? "bg-navy text-white" : "text-muted hover:bg-white")}>Listings</Link>
        <Link href="/leasing?tab=applications" className={cn("rounded-md px-3 py-1.5 text-sm", tab === "applications" ? "bg-navy text-white" : "text-muted hover:bg-white")}>
          Applications {newCount > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[11px] text-white">{newCount}</span>}
        </Link>
      </div>

      {tab === "listings" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            {listings.length === 0 ? (
              <Empty>No listings yet. Create one for a vacant unit to start taking applications.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Unit</Th><Th>Headline</Th><Th className="text-right">Rent</Th><Th>Status</Th><Th className="text-right">Applications</Th></tr></thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-medium"><Link href={`/leasing/listings/${l.id}`} className="hover:underline">{l.unit.property.name} · {l.unit.label}</Link></Td>
                      <Td className="text-muted">{l.headline}</Td>
                      <Td className="tabular text-right">{money(l.rent)}</Td>
                      <Td><Badge tone={l.status === "PUBLISHED" ? "green" : l.status === "DRAFT" ? "amber" : "gray"}>{l.status === "PUBLISHED" ? "Live" : l.status === "DRAFT" ? "Draft" : "Closed"}</Badge></Td>
                      <Td className="tabular text-right"><Link href={`/leasing?tab=applications`} className="hover:underline">{l._count.applications}</Link></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card className="h-fit">
            <CardHeader title="New listing" />
            <CardBody>
              <ActionForm action={createListing} submitLabel="Create listing">
                <Field label="Unit *">
                  <Select name="unitId" required defaultValue="">
                    <option value="" disabled>Choose a unit…</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.property.name} · {u.label}{u.leases.length ? " (occupied)" : ""}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Headline *"><Input name="headline" placeholder="Bright 1BR near downtown, voucher welcome" required maxLength={120} /></Field>
                <FormGrid>
                  <Field label="Rent *"><Input name="rent" inputMode="decimal" required /></Field>
                  <Field label="Deposit"><Input name="deposit" inputMode="decimal" /></Field>
                </FormGrid>
                <Field label="Available"><Input type="date" name="availableDate" /></Field>
                <Field label="Description"><Textarea name="description" rows={4} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="acceptsVouchers" defaultChecked className="size-4 accent-navy" /> Housing vouchers welcome (HUD-VASH, HCV)</label>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">Listings start as drafts. Add photos and publish from the listing page.</p>
            </CardBody>
          </Card>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1 text-sm">
            <Link href="/leasing?tab=applications" className={cn("rounded-md px-2.5 py-1", !statusFilter ? "bg-white font-medium shadow-sm" : "text-muted")}>Active</Link>
            {(Object.keys(appLabel) as ApplicationStatus[]).map((s) => (
              <Link key={s} href={`/leasing?tab=applications&status=${s}`} className={cn("rounded-md px-2.5 py-1", statusFilter === s ? "bg-white font-medium shadow-sm" : "text-muted")}>{appLabel[s]}</Link>
            ))}
          </div>
          <Card>
            {apps.length === 0 ? (
              <Empty>No applications here.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Applicant</Th><Th>For</Th><Th>Received</Th><Th>Voucher</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {apps.map((a) => (
                    <tr key={a.id} className={a.status === "NEW" ? "bg-blue-50/40" : ""}>
                      <Td className="font-medium">
                        <Link href={`/leasing/applications/${a.id}`} className="hover:underline">{a.firstName} {a.lastName}</Link>
                        {a.isVeteran && <span className="ml-2"><Badge tone="navy">Veteran</Badge></span>}
                      </Td>
                      <Td className="text-muted">{a.listing.unit.property.name} · {a.listing.unit.label}</Td>
                      <Td className="whitespace-nowrap text-muted">{fmtDate(a.createdAt)}</Td>
                      <Td>{a.hasVoucher ? <Badge tone="blue">{a.voucherType ?? "Yes"}</Badge> : <span className="text-muted">—</span>}</Td>
                      <Td><Badge tone={appTone(a.status)}>{appLabel[a.status]}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
