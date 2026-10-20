import { headers } from "next/headers";
import { db } from "@/lib/db";
import { composerData } from "@/lib/composer-data";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { Card, CardBody, CardHeader, Empty } from "@/components/ui";
import { sendMessage } from "@/app/(app)/communications/actions";

/** Message history with one tenant plus a composer locked to them. */
export async function TenantMessagesPanel({ tenant }: { tenant: { id: string; firstName: string; lastName: string; smsConsent: boolean; email: string | null; phone: string | null } }) {
  const returnPath = (await headers()).get("x-pathname") ?? "/communications";
  const [messages, data] = await Promise.all([
    db.message.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    composerData(),
  ]);
  const canText = tenant.smsConsent && !!tenant.phone;
  return (
    <Card>
      <div id="messages" />
      <CardHeader
        title="Messages"
        subtitle={[tenant.email ? "Email" : "No email", canText ? "OK to text" : tenant.phone ? "Hasn't agreed to texts" : "No phone"].join(" · ")}
      />
      <CardBody className="border-b border-line">
        <Composer
          action={sendMessage}
          {...data}
          lockTo={{ kind: "tenant", id: tenant.id, label: `${tenant.firstName} ${tenant.lastName}` }}
          defaultChannel={canText ? "SMS" : "EMAIL"}
          returnPath={returnPath}
        />
      </CardBody>
      {messages.length === 0 ? <Empty>No messages yet.</Empty> : <MessageList messages={messages} showWho={false} />}
    </Card>
  );
}
