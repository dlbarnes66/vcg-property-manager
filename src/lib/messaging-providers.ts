import { textToHtml } from "./messaging-core";

// Thin REST clients (no SDKs). Configuration comes from env at call time.

export const emailConfigured = () => Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
export const smsConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER));

export type SendResult = { ok: true; providerId: string | null; from: string } | { ok: false; error: string };

export async function sendEmail(m: { to: string; toName?: string; subject: string; text: string; messageId: string }): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "Email isn't set up (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL)." };
  const from = process.env.SENDGRID_FROM_EMAIL!;
  const replyTo = process.env.MANAGER_EMAIL;
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: m.to, ...(m.toName ? { name: m.toName } : {}) }] }],
        from: { email: from, name: process.env.SENDGRID_FROM_NAME || "Property Management" },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        subject: m.subject,
        content: [
          { type: "text/plain", value: m.text },
          { type: "text/html", value: textToHtml(m.text) },
        ],
        custom_args: { vcg_message_id: m.messageId },
      }),
    });
    if (res.status === 202 || res.ok) return { ok: true, providerId: res.headers.get("x-message-id"), from };
    const body = await res.text();
    let detail = body.slice(0, 300);
    try {
      detail = (JSON.parse(body).errors ?? []).map((e: { message: string }) => e.message).join("; ") || detail;
    } catch {}
    return { ok: false, error: `SendGrid ${res.status}: ${detail}` };
  } catch (e) {
    return { ok: false, error: `SendGrid unreachable: ${(e as Error).message}` };
  }
}

export async function sendSms(m: { to: string; body: string; statusCallback?: string }): Promise<SendResult> {
  if (!smsConfigured()) return { ok: false, error: "Texting isn't set up (TWILIO_* settings)." };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const form = new URLSearchParams({ To: m.to, Body: m.body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set("From", process.env.TWILIO_FROM_NUMBER!);
  if (m.statusCallback) form.set("StatusCallback", m.statusCallback);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; from?: string; message?: string; code?: number };
    if (res.ok && json.sid) return { ok: true, providerId: json.sid, from: json.from ?? process.env.TWILIO_FROM_NUMBER ?? "" };
    return { ok: false, error: `Twilio ${res.status}${json.code ? ` (${json.code})` : ""}: ${json.message ?? "send failed"}` };
  } catch (e) {
    return { ok: false, error: `Twilio unreachable: ${(e as Error).message}` };
  }
}
