/** Reads the NDJSON stream from /api/forms/* and calls back with text as it arrives. */
export async function readDraftStream(res: Response, onText: (t: string) => void): Promise<string> {
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? (res.status === 401 || res.status === 403 ? "Please sign in again." : `Request failed (${res.status})`));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let id: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as { type: string; text?: string; id?: string; error?: string };
      if (ev.type === "text" && ev.text) onText(ev.text);
      else if (ev.type === "done" && ev.id) id = ev.id;
      else if (ev.type === "error") throw new Error(ev.error ?? "Something went wrong");
    }
  }
  if (!id) throw new Error("The connection dropped before the draft finished. Check Forms in a minute — it may still have been saved.");
  return id;
}
