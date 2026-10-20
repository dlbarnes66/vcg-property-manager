import { createHmac, timingSafeEqual } from "crypto";

/** US-centric phone normalization to E.164. Returns null if it can't be a valid number. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const MERGE_FIELDS = ["firstName", "lastName", "property", "unit", "balance", "rent", "dueDate"] as const;
export type MergeVars = Partial<Record<(typeof MERGE_FIELDS)[number], string>>;

/** Fills {{field}} placeholders. Unknown or empty fields become "" and are reported so nothing half-filled goes out silently. */
export function renderTemplate(text: string, vars: MergeVars): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key];
    if (v == null || v === "") {
      missing.add(key);
      return "";
    }
    return v;
  });
  return { text: out, missing: [...missing] };
}

export { smsSegments } from "./sms-count";

/** Twilio's request signature: base64(HMAC-SHA1(authToken, url + sorted params concatenated)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | null) {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
/** Carrier-standard opt-out / opt-in keywords (the whole message, case-insensitive). */
export function smsKeyword(body: string): "stop" | "start" | null {
  const w = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  return STOP_WORDS.has(w) ? "stop" : START_WORDS.has(w) ? "start" : null;
}

export function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f1b2d">${esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
