import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { PropertyForm } from "../../property-form";
import { deleteProperty, updateProperty } from "../../actions";

export default async function EditPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const property = await db.property.findUnique({ where: { id } });
  if (!property) notFound();
  return (
    <>
      <PageHeader title={`Edit ${property.name}`} back={{ href: `/properties/${id}`, label: property.name }} />
      <Card>
        <CardBody>
          <PropertyForm action={updateProperty.bind(null, id)} property={property} submitLabel="Save changes" />
        </CardBody>
      </Card>
      <div className="mt-6">
        <ActionForm
          action={deleteProperty.bind(null, id)}
          submitLabel="Delete property"
          submitVariant="danger"
          confirm={`Delete ${property.name} and all its units? This can't be undone.`}
        />
      </div>
    </>
  );
}
