import { Card, CardBody, PageHeader } from "@/components/ui";
import { LeaseForm } from "../lease-form";
import { createLease } from "../actions";

export const metadata = { title: "New lease" };

export default async function NewLeasePage({ searchParams }: { searchParams: Promise<{ unitId?: string; tenantId?: string }> }) {
  const preset = await searchParams;
  return (
    <>
      <PageHeader title="New lease" back={{ href: "/leases", label: "Leases" }} />
      <Card>
        <CardBody>
          <LeaseForm action={createLease} submitLabel="Create lease" preset={preset} />
        </CardBody>
      </Card>
    </>
  );
}
