import { validTwilioSignature } from "./messaging-core";

/**
 * Reads a Twilio webhook (form-encoded) and checks its signature. Twilio signs the exact public URL
 * it called, so set NEXT_PUBLIC_APP_URL to your public address (behind proxies req.url can differ).
 */
export async function readTwilioRequest(req: Request): Promise<{ ok: boolean; params: Record<string, string> }> {
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  const u = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const url = base ? `${base}${u.pathname}${u.search}` : req.url;
  const ok = validTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? "", url, params, req.headers.get("x-twilio-signature"));
  return { ok, params };
}
