"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { declineToSign, submitSignature } from "@/app/sign-actions";
import { FormMarkdown } from "@/components/form-markdown";
import { Button, Card, CardBody, CardHeader, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Draw-with-finger signature box. Produces a trimmed PNG data URL. */
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1f4b";
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    ctx.lineTo(...pos(e));
    ctx.stroke();
    dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(dirty.current ? ref.current!.toDataURL("image/png") : null);
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null);
  };
  return (
    <div>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="h-36 w-full touch-none rounded-md border border-dashed border-gray-400 bg-white" aria-label="Draw your signature" />
      <div className="mt-1 flex justify-between text-xs text-muted"><span>Sign with your finger or mouse</span><button type="button" onClick={clear} className="hover:text-ink">Clear</button></div>
    </div>
  );
}

export function SignaturePanel(p: {
  title: string; body: string; pdfUrl: string; finalUrl?: string | null; signerName: string; message?: string | null;
  signerId?: string; token?: string; status: "PENDING" | "SIGNED" | "DECLINED"; requestStatus: string; others: { name: string; status: string }[];
}) {
  const [state, action, pending] = useActionState(submitSignature, null);
  const [dState, dAction, dPending] = useActionState(declineToSign, null);
  const [type, setType] = useState<"typed" | "drawn">("typed");
  const [name, setName] = useState(p.signerName);
  const [image, setImage] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const done = state?.ok || dState?.ok || p.status !== "PENDING" || p.requestStatus !== "PENDING";
  const hidden = (
    <>
      {p.signerId && <input type="hidden" name="signerId" value={p.signerId} />}
      {p.token && <input type="hidden" name="token" value={p.token} />}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      {p.message && <Card className="border-l-4 border-l-gold px-5 py-4 text-sm whitespace-pre-wrap">{p.message}</Card>}
      <Card>
        <CardHeader title="Review the document" action={<a href={p.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-navy hover:underline"><FileText size={13} /> Open PDF</a>} />
        <CardBody className="max-h-[60vh] overflow-y-auto bg-white px-6 py-5"><FormMarkdown text={p.body} /></CardBody>
      </Card>

      {done ? (
        <Card>
          <CardBody className="flex flex-col gap-2 text-sm">
            <p className={cn("font-medium", dState?.ok || p.status === "DECLINED" ? "text-red-700" : "text-emerald-700")}>
              {state?.message ?? dState?.message ?? (p.status === "SIGNED" ? "You signed this document." : p.status === "DECLINED" ? "You declined to sign this document." : p.requestStatus === "CANCELLED" ? "This request was cancelled." : p.requestStatus === "COMPLETED" ? "Everyone has signed." : "This request is closed.")}
            </p>
            {p.finalUrl && <a href={p.finalUrl} target="_blank" rel="noreferrer" className="font-medium text-navy hover:underline">Download the signed copy</a>}
            {!p.finalUrl && p.status === "SIGNED" && p.requestStatus === "PENDING" && (
              <p className="text-muted">Waiting for: {p.others.filter((o) => o.status === "PENDING").map((o) => o.name).join(", ") || "—"}</p>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Sign" />
          <CardBody>
            <form action={action} className="flex flex-col gap-4">
              {hidden}
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="image" value={type === "drawn" ? (image ?? "") : ""} />
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Your full name
                <Input name="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
              </label>
              <div className="flex gap-1">
                {(["typed", "drawn"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setType(t)} className={cn("rounded-md px-3 py-1.5 text-sm", type === t ? "bg-navy text-white" : "text-muted hover:bg-paper")}>
                    {t === "typed" ? "Type" : "Draw"}
                  </button>
                ))}
              </div>
              {type === "typed" ? (
                <div className="rounded-md border border-line bg-white px-4 py-3">
                  <div className="font-serif text-3xl text-navy italic">{name || "Your name"}</div>
                  <div className="mt-1 border-t border-gray-300 pt-1 text-xs text-muted">Signature</div>
                </div>
              ) : (
                <DrawPad onChange={setImage} />
              )}
              <div className="rounded-md bg-paper p-3 text-xs leading-relaxed text-muted">
                <b className="text-ink">Consent to sign electronically.</b> By checking the box below, you agree to use electronic records and signatures for this
                document, and that your electronic signature is as valid as signing on paper. You can download and print this document at any time. You can ask
                for a paper copy, or choose to sign on paper instead, by contacting the landlord before you sign. You need a device that can open PDF files.
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-navy" />
                <span>I have reviewed “{p.title}” and agree to sign it electronically.</span>
              </label>
              {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
              <Button type="submit" disabled={pending || !consent || !name.trim() || (type === "drawn" && !image)}>{pending ? "Signing…" : "Sign document"}</Button>
            </form>
            <details className="mt-5 text-sm">
              <summary className="cursor-pointer text-muted">I don&apos;t want to sign this</summary>
              <form action={dAction} className="mt-3 flex flex-col gap-2">
                {hidden}
                <Textarea name="reason" rows={2} maxLength={500} placeholder="Tell the landlord why (optional)" />
                {dState?.error && <p className="text-red-700">{dState.error}</p>}
                <Button type="submit" variant="secondary" disabled={dPending}>Decline to sign</Button>
              </form>
            </details>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
