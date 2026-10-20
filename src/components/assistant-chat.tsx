"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Bot, Search } from "lucide-react";
import { MiniMarkdown } from "@/components/mini-markdown";
import { ProposalCard, type ProposalView } from "@/components/proposal-card";
import { cn } from "@/lib/utils";

export type ChatMsg = { id: string; role: "user" | "assistant"; content: string; tools?: string[]; proposals?: ProposalView[] };

const SUGGESTIONS = [
  "Who's behind on rent, and which housing authorities owe HAP?",
  "What needs my attention this week?",
  "Summarize Denise Carter's account",
  "How did we do last month? Profit and loss by property",
  "Draft a friendly text reminder to tenants who are past due",
];

export function AssistantChat({ conversationId, initial, configured }: { conversationId?: string; initial: ChatMsg[]; configured: boolean }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    setBusy(true);
    setInput("");
    const live: ChatMsg = { id: `a${Date.now()}`, role: "assistant", content: "", tools: [], proposals: [] };
    setMsgs((m) => [...m, { id: `u${Date.now()}`, role: "user", content: q }, live]);
    const patch = (f: (m: ChatMsg) => ChatMsg) => setMsgs((all) => all.map((m) => (m.id === live.id ? f(m) : m)));
    let newId: string | null = null;
    try {
      const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, message: q }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "tool") patch((m) => ({ ...m, tools: [...(m.tools ?? []), ev.label] }));
          else if (ev.type === "proposal") patch((m) => ({ ...m, proposals: [...(m.proposals ?? []), { id: ev.actionId, summary: ev.summary, status: "PROPOSED", detail: ev.detail, reason: ev.reason }] }));
          else if (ev.type === "text") patch((m) => ({ ...m, content: ev.text }));
          else if (ev.type === "conversation") newId = ev.id;
          else if (ev.type === "error") throw new Error(ev.error);
        }
      }
      if (newId && newId !== conversationId) router.replace(`/assistant/${newId}`);
      router.refresh(); // update sidebar badges (approvals) too
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setMsgs((all) => all.filter((m) => m.id !== live.id || m.content || (m.tools?.length ?? 0) > 0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-5 pb-4">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Bot size={36} className="text-navy" />
            <div>
              <h2 className="text-lg font-semibold">Ask about your portfolio</h2>
              <p className="mt-1 max-w-md text-sm text-muted">It can look up tenants, balances, work orders, applications, and your books, and draft messages or tasks for you to approve. It never acts on its own.</p>
            </div>
            {configured && (
              <div className="flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs hover:bg-paper">{s}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-navy px-4 py-2.5 text-sm whitespace-pre-wrap text-white">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="flex gap-3">
              <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-gold/20"><Bot size={15} className="text-navy" /></div>
              <div className="min-w-0 flex-1 space-y-2 text-sm leading-relaxed">
                {(m.tools?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {[...new Set(m.tools)].map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-paper px-2 py-0.5 text-[11px] text-muted"><Search size={10} /> {t}</span>
                    ))}
                  </div>
                )}
                {m.content ? <MiniMarkdown text={m.content} /> : busy && <span className="inline-block animate-pulse text-muted">Thinking…</span>}
                {m.proposals?.map((p) => <ProposalCard key={p.id} p={p} />)}
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="mb-2 rounded-md bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      <form
        className="sticky bottom-0 flex items-end gap-2 border-t border-line bg-paper pt-3 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          disabled={!configured || busy}
          placeholder={configured ? "Ask anything about your properties… (Enter to send)" : "Add ANTHROPIC_API_KEY to .env to turn on the assistant"}
          className="flex-1 resize-none rounded-lg border border-line bg-white px-3 py-2 text-sm focus:border-navy focus:ring-2 focus:ring-navy/30 focus:outline-none"
        />
        <button type="submit" disabled={!configured || busy || !input.trim()} aria-label="Send" className={cn("flex size-10 items-center justify-center rounded-full bg-navy text-white disabled:opacity-40")}>
          <ArrowUp size={18} />
        </button>
      </form>
    </div>
  );
}
