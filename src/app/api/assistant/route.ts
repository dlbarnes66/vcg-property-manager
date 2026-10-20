import { getViewer } from "@/lib/auth";
import { aiConfigured, chatTurn, type AssistantEvent } from "@/lib/ai/assistant";

export const maxDuration = 60; // seconds (Vercel)

/**
 * POST { conversationId?, message } → streams newline-delimited JSON events:
 *   {type:"conversation",id} · {type:"tool",label} · {type:"proposal",actionId,summary} · {type:"text",text} · {type:"done"} | {type:"error",error}
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (viewer.kind !== "admin") return new Response("Forbidden", { status: viewer.userId ? 403 : 401 });
  if (!aiConfigured()) return Response.json({ error: "The AI assistant isn't set up yet. Add ANTHROPIC_API_KEY to .env (see README)." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; message?: string };
  const message = String(body.message ?? "").trim();
  if (!message) return Response.json({ error: "Type a question" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const out = await chatTurn({
          conversationId: body.conversationId || null,
          message,
          userEmail: viewer.email,
          onEvent: (e: AssistantEvent) => send(e),
        });
        send({ type: "conversation", id: out.conversationId });
        send({ type: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        send({ type: "error", error: /401|authentication|api[_ -]?key/i.test(msg) ? "Anthropic rejected the API key. Check ANTHROPIC_API_KEY." : msg.slice(0, 300) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
