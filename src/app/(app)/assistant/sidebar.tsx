import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { fmtLocal } from "@/lib/dates";

export async function ConversationList({ activeId }: { activeId?: string }) {
  const convos = await db.aiConversation.findMany({ orderBy: { updatedAt: "desc" }, take: 40, select: { id: true, title: true, updatedAt: true } });
  return (
    <div className="flex flex-col gap-1">
      <Link href="/assistant" className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium hover:bg-paper">
        <Plus size={14} /> New chat
      </Link>
      {convos.map((c) => (
        <Link key={c.id} href={`/assistant/${c.id}`} className={cn("rounded-md px-3 py-2 text-sm", c.id === activeId ? "bg-white font-medium shadow-sm" : "text-muted hover:bg-white/60")}>
          <div className="truncate">{c.title}</div>
          <div className="text-[11px] text-muted">{fmtLocal(c.updatedAt)}</div>
        </Link>
      ))}
    </div>
  );
}
