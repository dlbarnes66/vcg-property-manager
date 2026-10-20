import { reviseForm } from "@/lib/forms/generate";
import { streamDraft } from "@/lib/forms/stream";

export const maxDuration = 300;

/** POST { request } → streams the revised form. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { request?: string };
  return streamDraft(({ onText }) => reviseForm(id, String(b.request ?? ""), { onText }));
}
