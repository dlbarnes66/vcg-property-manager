import { getViewer } from "../auth";
import { aiConfigured } from "../ai/assistant";

/**
 * Shared plumbing for the streaming form endpoints: admin check, then newline-delimited JSON
 *   {type:"text",text} … {type:"done",id} | {type:"error",error}
 */
export async function streamDraft(run: (ctx: { email: string; onText: (t: string) => void }) => Promise<{ id: string }>) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new Response("Forbidden", { status: viewer.userId ? 403 : 401 });
  if (!aiConfigured()) return Response.json({ error: "The AI isn't set up yet. Add ANTHROPIC_API_KEY to .env (see README)." }, { status: 400 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          /* the browser went away; keep going so the draft is still saved */
        }
      };
      try {
        const out = await run({ email: viewer.email, onText: (text) => send({ type: "text", text }) });
        send({ type: "done", id: out.id });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "Something went wrong" });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
