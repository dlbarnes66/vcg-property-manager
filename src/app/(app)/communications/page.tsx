import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { composerData } from "@/lib/composer-data";
import { tenantName } from "@/lib/queries";
import { ActionForm } from "@/components/action-form";
import { Composer } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { Card, CardBody, CardHeader, Empty, Field, Input, LinkButton, PageHeader, Select, Textarea } from "@/components/ui";
import { cn, dateToInput, todayUTC } from "@/lib/utils";
import { logMessage, markAllRead, sendMessage } from "./actions";

export const metadata = { title: "Communications" };

const TABS = [
  { key: "all", label: "All" },
  { key: "inbox", label: "Replies" },
  { key: "sent", label: "Sent" },
  { key: "logged", label: "Calls & notes" },
  { key: "failed", label: "Failed" },
] as const;

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { tab = "all", q } = await searchParams;
  const term = q?.trim();
  const where: Prisma.MessageWhereInput = {
    ...(tab === "inbox" ? { direction: "INBOUND", status: "RECEIVED" } : {}),
    ...(tab === "sent" ? { direction: "OUTBOUND", status: { in: ["SENT", "DELIVERED", "QUEUED"] } } : {}),
    ...(tab === "logged" ? { status: "LOGGED" } : {}),
    ...(tab === "failed" ? { status: "FAILED" } : {}),
    ...(term
      ? {
          OR: [
            { body: { contains: term, mode: "insensitive" } },
            { subject: { contains: term, mode: "insensitive" } },
            { tenant: { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] } },
            { vendor: { name: { contains: term, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [messages, unread, data] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: 150,
      include: { tenant: { select: { id: true, firstName: true, lastName: true } }, vendor: { select: { name: true } }, housingAuthority: { select: { name: true } } },
    }),
    db.message.count({ where: { direction: "INBOUND", readAt: null } }),
    composerData(),
  ]);

  const rows = messages.map((m) => ({
    ...m,
    who: m.tenant
      ? { href: `/tenants/${m.tenant.id}#messages`, label: tenantName(m.tenant) }
      : m.vendor
        ? { href: "/vendors", label: m.vendor.name }
        : m.housingAuthority
          ? { href: "/housing-authorities", label: m.housingAuthority.name }
          : null,
  }));

  return (
    <>
      <PageHeader
        title="Communications"
        subtitle="Emails and texts to tenants, case managers, vendors, and housing authorities"
        actions={<LinkButton href="/communications/templates" variant="secondary">Templates</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/communications?tab=${t.key}`} className={cn("rounded-md px-3 py-1.5 text-sm", tab === t.key ? "bg-navy text-white" : "text-muted hover:bg-white")}>
            {t.label}
            {t.key === "inbox" && unread > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 text-[11px] text-white">{unread}</span>}
          </Link>
        ))}
        <form className="ml-auto w-56">
          <input type="hidden" name="tab" value={tab} />
          <Input name="q" defaultValue={term} placeholder="Search messages…" />
        </form>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            {tab === "inbox" && unread > 0 && (
              <div className="flex items-center justify-between border-b border-line px-5 py-2.5 text-sm">
                <span className="text-muted">{unread} unread</span>
                <ActionForm action={markAllRead} submitLabel="Mark all read" submitVariant="ghost" inline />
              </div>
            )}
            {rows.length === 0 ? (
              <Empty>{tab === "inbox" ? "No text replies yet. Replies to your Twilio number show up here." : "No messages yet."}</Empty>
            ) : (
              <MessageList messages={rows} />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="New message" />
            <CardBody>
              <Composer action={sendMessage} {...data} returnPath="/communications" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Log a call or visit" subtitle="Keeps a record. Nothing is sent." />
            <CardBody>
              <ActionForm action={logMessage} submitLabel="Save to history" resetOnSuccess>
                <Field label="With *">
                  <Select name="who" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    <optgroup label="Tenants">{data.tenants.map((t) => <option key={t.id} value={`tenant:${t.id}`}>{t.label}</option>)}</optgroup>
                    <optgroup label="Vendors">{data.vendors.map((v) => <option key={v.id} value={`vendor:${v.id}`}>{v.label}</option>)}</optgroup>
                    <optgroup label="Housing authorities">{data.phas.map((h) => <option key={h.id} value={`pha:${h.id}`}>{h.label}</option>)}</optgroup>
                  </Select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Type">
                    <Select name="channel" defaultValue="CALL">
                      <option value="CALL">Call</option>
                      <option value="OTHER">Visit / other</option>
                      <option value="EMAIL">Email</option>
                      <option value="SMS">Text</option>
                    </Select>
                  </Field>
                  <Field label="Direction">
                    <Select name="direction" defaultValue="OUTBOUND">
                      <option value="OUTBOUND">I contacted them</option>
                      <option value="INBOUND">They contacted me</option>
                    </Select>
                  </Field>
                  <Field label="Date">
                    <Input name="date" type="date" defaultValue={dateToInput(todayUTC())} />
                  </Field>
                </div>
                <Field label="Summary *">
                  <Textarea name="body" rows={3} required placeholder="Talked about the October balance; will pay Friday." />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
