import { Card, CardBody, PageHeader } from "@/components/ui";
import { TenantForm } from "../tenant-form";
import { createTenant } from "../actions";

export const metadata = { title: "New tenant" };

export default function NewTenantPage() {
  return (
    <>
      <PageHeader title="Add tenant" back={{ href: "/tenants", label: "Tenants" }} />
      <Card>
        <CardBody>
          <TenantForm action={createTenant} submitLabel="Create tenant" />
        </CardBody>
      </Card>
    </>
  );
}
