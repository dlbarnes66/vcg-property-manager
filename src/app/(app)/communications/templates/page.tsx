import type { MessageTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { EditPopover } from "@/components/edit-popover";
import { Badge, Card, CardBody, CardHeader, Empty, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { MERGE_FIELDS } from "@/lib/messaging-core";
import { addStarterTemplates, deleteTemplate, saveTemplate } from "../actions";

export const metadata = { title: "Message templates" };

export default async function TemplatesPage() {
  const templates = await db.messageTemplate.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Message templates" back={{ href: "/communications", label: "Communications" }} subtitle={`Merge fields: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(" ")}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          {templates.length === 0 ? (
            <Empty action={<ActionForm action={addStarterTemplates} submitLabel="Add starter templates" inline />}>
              No templates yet. Start with rent reminders, a past-due notice, and an inspection notice.
            </Empty>
          ) : (
            <ul className="divide-y divide-line">
              {templates.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      {t.name} <Badge tone={t.channel === "SMS" ? "blue" : "gray"}>{t.channel === "SMS" ? "Text" : "Email"}</Badge>
                    </div>
                    {t.subject && <div className="mt-0.5 text-xs">Subject: {t.subject}</div>}
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-muted">{t.body}</p>
                  </div>
                  <EditPopover title="Edit template">
                    <ActionForm action={saveTemplate.bind(null, t.id)} submitLabel="Save template">
                      <TemplateFields t={t} />
                    </ActionForm>
                    <div className="mt-3 border-t border-line pt-3">
                      <ActionForm action={deleteTemplate.bind(null, t.id)} submitLabel="Delete template" submitVariant="danger" confirm="Delete this template?" />
                    </div>
                  </EditPopover>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="New template" />
          <CardBody>
            <ActionForm action={saveTemplate.bind(null, null)} submitLabel="Save template" resetOnSuccess>
              <TemplateFields />
            </ActionForm>
            {templates.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm action={addStarterTemplates} submitLabel="Add starter templates" submitVariant="ghost" inline />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function TemplateFields({ t }: { t?: MessageTemplate }) {
  return (
    <>
      <Field label="Name *">
        <Input name="name" defaultValue={t?.name} required maxLength={100} />
      </Field>
      <Field label="Type">
        <Select name="channel" defaultValue={t?.channel === "SMS" ? "SMS" : "EMAIL"}>
          <option value="EMAIL">Email</option>
          <option value="SMS">Text message</option>
        </Select>
      </Field>
      <Field label="Subject (email only)">
        <Input name="subject" defaultValue={t?.subject ?? ""} maxLength={200} />
      </Field>
      <Field label="Message *">
        <Textarea name="body" rows={6} defaultValue={t?.body} required />
      </Field>
    </>
  );
}
