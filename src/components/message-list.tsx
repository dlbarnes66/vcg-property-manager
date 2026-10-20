import type { Message } from "@prisma/client";
import { ArrowDownLeft, ArrowUpRight, Mail, MessageSquare, Phone, StickyNote } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import { fmtLocal } from "@/lib/dates";
import { markRead } from "@/app/(app)/communications/actions";

const icon = { EMAIL: Mail, SMS: MessageSquare, CALL: Phone, OTHER: StickyNote };
const statusTone = { QUEUED: "gray", SENT: "blue", DELIVERED: "green", FAILED: "red", RECEIVED: "navy", LOGGED: "gray" } as const;
const statusLabel = { QUEUED: "Queued", SENT: "Sent", DELIVERED: "Delivered", FAILED: "Failed", RECEIVED: "Received", LOGGED: "Logged" };

type Row = Message & { who?: { href: string; label: string } | null };

export function MessageList({ messages, showWho = true }: { messages: Row[]; showWho?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {messages.map((m) => {
        const Icon = icon[m.channel];
        const unread = m.direction === "INBOUND" && !m.readAt;
        const at = m.sentAt ?? m.createdAt;
        return (
          <li key={m.id} className={cn("px-5 py-3 text-sm", unread && "bg-blue-50/60")}>
            <div className="flex items-start gap-3">
              <Icon size={16} className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {m.direction === "INBOUND" ? <ArrowDownLeft size={13} className="text-navy" /> : <ArrowUpRight size={13} className="text-muted" />}
                  {showWho && m.who ? <a href={m.who.href} className="font-medium hover:underline">{m.who.label}</a> : showWho ? <span className="font-medium">{m.direction === "INBOUND" ? m.fromAddress : m.toAddress}</span> : null}
                  {m.subject && <span className={cn(!showWho && "font-medium")}>{showWho ? `· ${m.subject}` : m.subject}</span>}
                  <Badge tone={statusTone[m.status]}>{statusLabel[m.status]}</Badge>
                  <span className="ml-auto text-xs whitespace-nowrap text-muted">{fmtLocal(at, true)}</span>
                </div>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted">{m.body}</p>
                {m.error && <p className="mt-1 text-xs text-red-700">{m.error}</p>}
                {unread && (
                  <div className="mt-2 flex gap-2">
                    <ActionForm action={markRead.bind(null, m.id)} submitLabel="Mark read" submitVariant="secondary" inline />
                    {m.tenantId && (
                      <a href={`/tenants/${m.tenantId}#messages`} className="inline-flex h-8 items-center rounded-md border border-line bg-white px-3 text-sm hover:bg-paper">
                        Reply
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
