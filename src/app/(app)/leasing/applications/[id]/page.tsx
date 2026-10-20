import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { Badge, Card, CardBody, CardHeader, DetailList, Field, PageHeader, Select, Textarea } from "@/components/ui";
import { appLabel, appTone } from "@/lib/leasing-labels";
import { fmtDate, money } from "@/lib/utils";
import { fmtLocal } from "@/lib/dates";
import { convertToTenant, decideApplication, deleteApplication, saveScreening } from "../../actions";

const CHECKS = [
  ["idVerified", "Photo ID verified"],
  ["incomeVerified", "Income verified (pay stubs, benefits letter)"],
  ["voucherVerified", "Voucher verified with the housing authority"],
  ["referenceChecked", "Landlord reference checked"],
  ["backgroundReviewed", "Background reviewed per your written criteria"],
] as const;

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await db.application.findUnique({ where: { id }, include: { listing: { include: { unit: { include: { property: true } } } }, tenant: true } });
  if (!a) notFound();
  const rentToIncome = a.monthlyIncome && a.listing.rent ? a.listing.rent / a.monthlyIncome : null;

  return (
    <>
      <PageHeader
        title={`${a.firstName} ${a.lastName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={appTone(a.status)}>{appLabel[a.status]}</Badge>
            {a.isVeteran && <Badge tone="navy">Veteran</Badge>}
            {a.hasVoucher && <Badge tone="blue">{a.voucherType ?? "Voucher"}</Badge>}
            <span>for <Link href={`/leasing/listings/${a.listingId}`} className="underline">{a.listing.unit.property.name} · {a.listing.unit.label}</Link> · received {fmtLocal(a.createdAt, true)}</span>
          </span>
        }
        back={{ href: "/leasing?tab=applications", label: "Applications" }}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Applicant" />
            <CardBody className="flex flex-col gap-5">
              <DetailList
                items={[
                  ["Email", <a key="e" href={`mailto:${a.email}`} className="underline">{a.email}</a>],
                  ["Phone", <a key="p" href={`tel:${a.phone}`} className="underline">{a.phone}</a>],
                  ["Household size", a.householdSize],
                  ["Desired move-in", fmtDate(a.desiredMoveIn)],
                  ["Current address", a.currentAddress],
                  ["Current landlord", [a.currentLandlord, a.currentLandlordPhone].filter(Boolean).join(" · ") || null],
                  ["Monthly income", a.monthlyIncome != null ? `${money(a.monthlyIncome)}${rentToIncome ? ` (rent is ${Math.round(rentToIncome * 100)}% of income)` : ""}` : null],
                  ["Income source", [a.incomeSource, a.employer].filter(Boolean).join(" · ") || null],
                  ["Pets", a.pets],
                ]}
              />
              {a.hasVoucher && (
                <div>
                  <div className="mb-2 text-xs font-semibold text-muted">VOUCHER &amp; CASE MANAGER</div>
                  <DetailList
                    items={[
                      ["Voucher", a.voucherType ?? "Yes"],
                      ["Housing authority", a.housingAuthorityName],
                      ["Case manager", a.caseManagerName],
                      ["Case manager contact", [a.caseManagerPhone, a.caseManagerEmail].filter(Boolean).join(" · ") || null],
                    ]}
                  />
                  {a.listing.rent && <p className="mt-2 text-xs text-muted">With a voucher, the applicant usually pays about 30% of adjusted income; the housing authority pays the rest once the unit passes inspection.</p>}
                </div>
              )}
              {a.additionalInfo && <p className="text-sm whitespace-pre-wrap"><span className="text-xs font-semibold text-muted">ANYTHING ELSE: </span>{a.additionalInfo}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Screening checklist" subtitle="Apply the same written criteria to every applicant. Source of income, including vouchers, isn't a reason to deny." />
            <CardBody>
              <ActionForm action={saveScreening.bind(null, id)} submitLabel="Save checklist">
                <div className="flex flex-col gap-2">
                  {CHECKS.map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name={k} defaultChecked={a[k]} className="size-4 accent-navy" /> {label}
                    </label>
                  ))}
                </div>
                <Field label="Screening notes"><Textarea name="screeningNotes" rows={3} defaultValue={a.screeningNotes ?? ""} /></Field>
              </ActionForm>
            </CardBody>
          </Card>
          <DocumentsPanel link={{ applicationId: id }} defaultCategory="ID" />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Decision" />
            <CardBody className="flex flex-col gap-4">
              {a.status === "CONVERTED" && a.tenant ? (
                <p className="text-sm">Now a tenant: <Link href={`/tenants/${a.tenant.id}`} className="underline">{a.tenant.firstName} {a.tenant.lastName}</Link></p>
              ) : (
                <>
                  {a.decidedAt && <p className="text-xs text-muted">{appLabel[a.status]} {fmtDate(a.decidedAt)}{a.decidedByEmail ? ` by ${a.decidedByEmail.split("@")[0]}` : ""}{a.decisionReason ? `: ${a.decisionReason}` : ""}</p>}
                  <ActionForm action={decideApplication.bind(null, id)} submitLabel="Save decision">
                    <Field label="Decision">
                      <Select name="decision" defaultValue={a.status === "NEW" ? "APPROVED" : a.status}>
                        <option value="SCREENING">Still screening</option>
                        <option value="APPROVED">Approve</option>
                        <option value="DENIED">Deny</option>
                        <option value="WITHDRAWN">Applicant withdrew</option>
                      </Select>
                    </Field>
                    <Field label="Reason (required to deny)" hint="If you deny based on a background or credit report, the applicant is entitled to an adverse action notice.">
                      <Textarea name="decisionReason" rows={2} defaultValue={a.decisionReason ?? ""} />
                    </Field>
                  </ActionForm>
                  {a.status === "APPROVED" && (
                    <div className="border-t border-line pt-4">
                      <p className="mb-2 text-sm">Create the tenant record (with their case manager) and go to the lease form with this unit and rent filled in.</p>
                      <ActionForm action={convertToTenant.bind(null, id)} submitLabel="Create tenant & lease" />
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
          {a.status !== "CONVERTED" && (
            <ActionForm action={deleteApplication.bind(null, id)} submitLabel="Delete application & files" submitVariant="danger" confirm="Permanently delete this application and its uploaded files?" />
          )}
        </div>
      </div>
    </>
  );
}
