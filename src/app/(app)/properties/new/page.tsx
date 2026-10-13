import { Card, CardBody, PageHeader } from "@/components/ui";
import { PropertyForm } from "../property-form";
import { createProperty } from "../actions";

export const metadata = { title: "New property" };

export default function NewPropertyPage() {
  return (
    <>
      <PageHeader title="Add property" back={{ href: "/properties", label: "Properties" }} />
      <Card>
        <CardBody>
          <PropertyForm action={createProperty} submitLabel="Create property" />
        </CardBody>
      </Card>
    </>
  );
}
