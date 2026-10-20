import "server-only";
import Stripe from "stripe";
import { applyStripeOutcome } from "./online-payments";
import { db } from "./db";

export { applyStripeOutcome };

export const stripeEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);
/** Bank transfer (ACH) only by default: 0.8% capped at $5. Set STRIPE_ALLOW_CARDS=true to also accept cards (~2.9% + 30¢). */
export const allowCards = () => process.env.STRIPE_ALLOW_CARDS === "true";

let client: Stripe | null = null;
export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Online payments aren't set up yet (STRIPE_SECRET_KEY is missing).");
  client ??= new Stripe(key);
  return client;
}

/** Ask Stripe for the current truth about a checkout session, then apply it. */
export async function syncCheckoutSession(sessionId: string) {
  const s = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.payment_method"] });
  const pi = s.payment_intent && typeof s.payment_intent !== "string" ? s.payment_intent : null;
  const pm = pi?.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
  return applyStripeOutcome(s.id, {
    sessionStatus: s.status,
    paymentIntent: pi
      ? { id: pi.id, status: pi.status, amountReceived: pi.amount_received, methodType: pm?.type ?? pi.payment_method_types[0] ?? null, errorMessage: pi.last_payment_error?.message ?? null }
      : null,
  });
}

/**
 * Fallback if a webhook was missed (or isn't set up yet locally): re-check this lease's in-flight
 * payments with Stripe when someone views the page, at most every 15 minutes each.
 */
export async function refreshStaleOnlinePayments(leaseId: string) {
  if (!stripeEnabled()) return;
  const stale = await db.onlinePayment.findMany({
    where: { leaseId, status: { in: ["PENDING", "PROCESSING"] }, updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    take: 3,
  });
  for (const op of stale) {
    try {
      const before = op.status;
      const after = await syncCheckoutSession(op.checkoutSessionId);
      if (after && after.status === before) await db.onlinePayment.update({ where: { id: op.id }, data: { updatedAt: new Date() } });
    } catch (e) {
      console.error("Couldn't refresh online payment", op.id, e);
    }
  }
}
