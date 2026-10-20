import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { smsKeyword, toE164 } from "@/lib/messaging-core";
import { readTwilioRequest } from "@/lib/twilio-webhook";

const twiml = () => new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml" } });

/**
 * Texts people send to your Twilio number. Point the number's "A message comes in" webhook here.
 * Replies are matched to a tenant, vendor, or housing authority by phone number and land in the inbox.
 */
export async function POST(req: Request) {
  const { ok, params } = await readTwilioRequest(req);
  if (!ok) return new NextResponse("Invalid signature", { status: 403 });

  const from = toE164(params.From);
  const body = (params.Body ?? "").slice(0, 5000);
  if (!from || !params.MessageSid) return twiml();

  // Match by phone. Stored numbers are free-form, so compare normalized forms.
  const last10 = from.replace(/\D/g, "").slice(-10);
  const like = { contains: last10.slice(-4) };
  const [tenants, vendors, phas] = await Promise.all([
    db.tenant.findMany({ where: { phone: like }, select: { id: true, phone: true } }),
    db.vendor.findMany({ where: { phone: like }, select: { id: true, phone: true } }),
    db.housingAuthority.findMany({ where: { phone: like }, select: { id: true, phone: true } }),
  ]);
  const same = (p: string | null) => toE164(p) === from;
  const tenant = tenants.find((t) => same(t.phone));
  const vendor = !tenant ? vendors.find((v) => same(v.phone)) : undefined;
  const pha = !tenant && !vendor ? phas.find((h) => same(h.phone)) : undefined;

  const lease = tenant ? await db.lease.findFirst({ where: { tenantId: tenant.id, status: "ACTIVE" }, orderBy: { startDate: "desc" }, include: { unit: true } }) : null;

  await db.message.upsert({
    where: { providerMessageId: params.MessageSid }, // Twilio retries are ignored
    update: {},
    create: {
      channel: "SMS", direction: "INBOUND", status: "RECEIVED", fromAddress: from, toAddress: params.To ?? null, body,
      providerMessageId: params.MessageSid, tenantId: tenant?.id, vendorId: vendor?.id, housingAuthorityId: pha?.id,
      leaseId: lease?.id, propertyId: lease?.unit.propertyId, sentAt: new Date(),
    },
  });

  // Keep our consent flag in line with what the carrier enforces.
  const kw = smsKeyword(body);
  if (tenant && kw === "stop") await db.tenant.update({ where: { id: tenant.id }, data: { smsConsent: false } });
  if (tenant && kw === "start") await db.tenant.update({ where: { id: tenant.id }, data: { smsConsent: true, smsConsentAt: new Date() } });

  return twiml();
}
