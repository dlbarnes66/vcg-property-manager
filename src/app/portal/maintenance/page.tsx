import { db } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardBody, CardHeader, Empty, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { submitMaintenanceRequest } from "../actions";

export const metadata = { title: "Maintenance" };

const statusLabel: Record<string, string> = {
  OPEN: "Received", SCHEDULED: "Scheduled", IN_PROGRESS: "In progress", COMPLETED: "Completed", CANCELLED: "Closed",
};
const statusTone = (s: string) => ({ OPEN: "blue", SCHEDULED: "blue", IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "gray" })[s] as "blue" | "amber" | "green" | "gray";
const AREAS = ["Plumbing", "Electrical", "Heating / AC", "Appliance", "Doors / locks / windows", "Pests", "Smoke / CO detector", "Other"];

export default async function PortalMaintenance() {
  const { tenant } = await requireTenant();
  const [active, requests] = await Promise.all([
    db.lease.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" } }),
    db.maintenanceRequest.findMany({
      where: { submittedByTenantId: tenant.id },
      orderBy: { reportedOn: "desc" },
      take: 50,
      include: { documents: { where: { sharedWithTenant: true }, select: { id: true, name: true } } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Maintenance</h1>

      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <b>Emergency?</b> For fire, a gas smell, or anyone in danger, call <a href="tel:911" className="font-semibold underline">911</a> first. Then
        submit an emergency request below.
      </div>

      {active ? (
        <Card>
          <CardHeader title="Request a repair" />
          <CardBody>
            <ActionForm action={submitMaintenanceRequest} submitLabel="Send request" resetOnSuccess>
              <Field label="Area">
                <Select name="area" defaultValue="Plumbing">
                  {AREAS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </Field>
              <Field label="What needs fixing? *">
                <Input name="title" maxLength={120} placeholder="Kitchen sink is leaking" required />
              </Field>
              <Field label="Details">
                <Textarea name="description" rows={4} maxLength={4000} placeholder="When did it start? Where exactly? Anything you've tried?" />
              </Field>
              <Field label="Photos (up to 5)">
                <Input type="file" name="photos" accept="image/*" multiple className="h-auto py-1.5" />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="permissionToEnter" className="mt-0.5 size-4 accent-navy" />
                It&apos;s OK to enter my home to make this repair if I&apos;m not there
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="emergency" className="mt-0.5 size-4 accent-red-700" />
                <span>
                  <b>This is an emergency</b> <span className="text-muted">(no heat or water, flooding, no power, door won&apos;t lock)</span>
                </span>
              </label>
            </ActionForm>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <Empty>You don&apos;t have an active lease, so new requests are turned off. Please contact your property manager.</Empty>
        </Card>
      )}

      <Card>
        <CardHeader title="Your requests" />
        {requests.length === 0 ? (
          <Empty>No requests yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium">{r.title}</span>
                  <Badge tone={statusTone(r.status)}>{statusLabel[r.status]}</Badge>
                </div>
                <div className="text-xs text-muted">
                  Sent {fmtDate(r.reportedOn)}
                  {r.priority === "EMERGENCY" && " · Emergency"}
                  {r.status === "SCHEDULED" && r.scheduledOn && ` · Scheduled for ${fmtDate(r.scheduledOn)}`}
                  {r.status === "COMPLETED" && r.completedOn && ` · Completed ${fmtDate(r.completedOn)}`}
                </div>
                {r.documents.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.documents.map((d) => (
                      <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="text-navy underline">
                        {d.name}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
