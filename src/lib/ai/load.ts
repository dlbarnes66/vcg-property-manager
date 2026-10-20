import type { AgentAction } from "@prisma/client";
import { db } from "../db";
import { detailOf } from "../agent-actions";
import { toolLabel } from "./tools";
import type { ChatMsg } from "@/components/assistant-chat";
import type { ProposalView } from "@/components/proposal-card";

export const toProposalView = (a: AgentAction): ProposalView => ({
  id: a.id, summary: a.summary, status: a.status, result: a.result, error: a.error, reason: a.reason, detail: detailOf(a.kind, a.payload),
});

/** A saved conversation as chat messages, with each proposal shown under the answer that made it. */
export async function loadConversation(id: string) {
  const c = await db.aiConversation.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } }, actions: { orderBy: { createdAt: "asc" } } } });
  if (!c) return null;
  const msgs: ChatMsg[] = [];
  let prev = new Date(0);
  for (const m of c.messages) {
    if (m.role === "USER") {
      msgs.push({ id: m.id, role: "user", content: m.content });
    } else {
      const calls = (Array.isArray(m.toolCalls) ? m.toolCalls : []) as { name: string; input: Record<string, unknown> }[];
      const proposals = c.actions.filter((a) => a.createdAt > prev && a.createdAt <= m.createdAt).map(toProposalView);
      msgs.push({ id: m.id, role: "assistant", content: m.content, tools: calls.map((t) => toolLabel(t.name, t.input ?? {})), proposals });
    }
    prev = m.createdAt;
  }
  return { conversation: c, msgs };
}
