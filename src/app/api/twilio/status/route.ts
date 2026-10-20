import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readTwilioRequest } from "@/lib/twilio-webhook";

// Delivery updates for texts we sent (set automatically as each message's StatusCallback).
export async function POST(req: Request) {
  const { ok, params } = await readTwilioRequest(req);
  if (!ok) return new NextResponse("Invalid signature", { status: 403 });

  const sid = params.MessageSid;
  const s = params.MessageStatus;
  if (sid && s) {
    const status = s === "delivered" ? "DELIVERED" : s === "failed" || s === "undelivered" ? "FAILED" : s === "sent" ? "SENT" : null;
    if (status) {
      const error = status === "FAILED" ? `Carrier reported ${s}${params.ErrorCode ? ` (error ${params.ErrorCode})` : ""}` : null;
      // Never move a message backwards (e.g. a late "sent" after "delivered").
      await db.message.updateMany({
        where: { providerMessageId: sid, status: status === "SENT" ? { in: ["QUEUED", "SENT"] } : { not: "DELIVERED" } },
        data: { status, ...(error ? { error } : {}) },
      });
    }
  }
  return new NextResponse(null, { status: 204 });
}
