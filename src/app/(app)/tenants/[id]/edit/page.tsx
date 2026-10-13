import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { tenantName } from "@/lib/queries";
import { TenantForm } from "../../tenant-form";
import { deleteTenant, updateTenant } from "../../actions";

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await db.tenant.findUnique({ where: { id } });
  if (!tenant) notFound();
  return (
    <>
      <PageHeader title={`Edit ${tenantName(tenant)}`} back={{ href: `/tenants/${id}`, label: tenantName(tenant) }} />
      <Card>
        <CardBody>
          <TenantForm action={updateTenant.bind(null, id)} tenant={tenant} submitLabel="Save changes" />
        </CardBody>
      </Card>
      <div className="mt-6">
        <ActionForm action={deleteTenant.bind(null, id)} submitLabel="Delete tenant" submitVariant="danger" confirm="Delete this tenant?" />
      </div>
    </>
  );
}
