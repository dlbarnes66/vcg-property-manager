"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { finishForm, saveForm } from "@/app/(app)/forms/actions";
import { FormMarkdown } from "@/components/form-markdown";
import { Button, Card, CardBody, Input, Textarea } from "@/components/ui";
import { NOTES_MARKER } from "@/lib/forms/marker";
import { readDraftStream } from "@/lib/forms/stream-client";
import { cn } from "@/lib/utils";

export function FormEditor(p: { id: string; title: string; body: string; status: "DRAFT" | "FINAL"; canShare: boolean; shared: boolean; aiReady: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(p.title);
  const [body, setBody] = useState(p.body);
  const [saved, setSaved] = useState({ title: p.title, body: p.body });
  const [tab, setTab] = useState<"edit" | "preview">("preview");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [share, setShare] = useState(p.shared);
  const [ask, setAsk] = useState("");
  const [revising, setRevising] = useState(false);
  const [pending, start] = useTransition();
  const dirty = title !== saved.title || body !== saved.body;

  const fd = () => {
    const f = new FormData();
    f.set("title", title);
    f.set("body", body);
    return f;
  };
  const save = () =>
    start(async () => {
      const r = await saveForm(p.id, null, fd());
      setMsg(r?.error ? { ok: false, text: r.error } : { ok: true, text: r?.message ?? "Saved" });
      if (!r?.error) setSaved({ title, body });
    });
  const finish = () =>
    start(async () => {
      const f = fd();
      if (share) f.set("share", "on");
      const r = await finishForm(p.id, null, f);
      setMsg(r?.error ? { ok: false, text: r.error } : { ok: true, text: r?.message ?? "Saved" });
      if (!r?.error) {
        setSaved({ title, body });
        router.refresh();
      }
    });

  async function revise() {
    if (!ask.trim()) return;
    setMsg(null);
    setRevising(true);
    try {
      if (dirty) {
        const r = await saveForm(p.id, null, fd());
        if (r?.error) throw new Error(r.error);
      }
      let streamed = "";
      setTab("preview");
      const res = await fetch(`/api/forms/${p.id}/revise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: ask }) });
      await readDraftStream(res, (t) => {
        streamed += t;
        setBody(streamed.split(NOTES_MARKER)[0]);
      });
      setAsk("");
      setMsg({ ok: true, text: "Revised. Review the changes, then save or update the PDF." });
      router.refresh();
      // The server saved the cleaned-up version; reload it so the editor matches exactly.
      setSaved({ title, body: streamed.split(NOTES_MARKER)[0].trim() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
      setBody(saved.body);
    } finally {
      setRevising(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="text-base font-semibold" aria-label="Title" disabled={revising} />
          <div className="flex items-center gap-1">
            {(["preview", "edit"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-md px-3 py-1 text-sm", tab === t ? "bg-navy text-white" : "text-muted hover:bg-paper")}>
                {t === "edit" ? "Edit text" : "Preview"}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted">{dirty ? "Unsaved changes" : p.status === "FINAL" ? "Saved · PDF in Documents" : "Saved draft"}</span>
          </div>
          {tab === "edit" ? (
            <>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={28} className="font-mono text-[13px] leading-relaxed" disabled={revising} spellCheck />
              <p className="text-xs text-muted"># Title · ## Section · **bold** · - list · 1. numbered · | table | rows · ________ for blanks</p>
            </>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto rounded-md border border-line bg-white px-8 py-6"><FormMarkdown text={body} /></div>
          )}
        </CardBody>
      </Card>

      {p.aiReady && (
        <Card>
          <CardBody className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ask">Ask the AI to change it</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Textarea id="ask" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={4000} disabled={revising}
                placeholder="e.g. Make the term 6 months. Add that the tenant handles yard care. Shorten section 12." className="flex-1" />
              <Button type="button" variant="secondary" onClick={revise} disabled={revising || pending || !ask.trim()} className="sm:self-end">
                <Sparkles size={14} className="mr-1.5" /> {revising ? "Revising…" : "Revise"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={save} disabled={pending || revising || !dirty}>Save draft</Button>
          {p.canShare && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="size-4 accent-navy" /> Share with the tenant in their portal
            </label>
          )}
          <Button type="button" onClick={finish} disabled={pending || revising || !body.trim()} className="ml-auto">
            {p.status === "FINAL" ? "Update PDF" : "Finish & save PDF"}
          </Button>
          {msg && <p className={cn("w-full text-sm", msg.ok ? "text-emerald-700" : "text-red-700")}>{msg.text}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
