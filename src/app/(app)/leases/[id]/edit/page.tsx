import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { LeaseForm } from "../../lease-form";
import { deleteLease, updateLease } from "../../actions";

export default async function EditLeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lease = await db.lease.findUnique({ where: { id } });
  if (!lease) notFound();
  return (
    <>
      <PageHeader title="Edit lease" back={{ href: `/leases/${id}`, label: "Lease" }} />
      <Card>
        <CardBody>
          <LeaseForm action={updateLease.bind(null, id)} lease={lease} submitLabel="Save changes" />
        </CardBody>
      </Card>
      <p className="mt-6 mb-2 text-xs text-muted">
        Changing rent amounts affects future monthly charges only. Charges already posted stay as they are.
      </p>
      <ActionForm action={deleteLease.bind(null, id)} submitLabel="Delete lease" submitVariant="danger" confirm="Delete this lease and its charges?" />
    </>
  );
}
