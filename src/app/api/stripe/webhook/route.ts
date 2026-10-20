import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, syncCheckoutSession } from "@/lib/stripe";

// Configure in Stripe → Developers → Webhooks with these events:
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.async_payment_failed, checkout.session.expired
const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse("STRIPE_WEBHOOK_SECRET is not set", { status: 500 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new NextResponse("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  if (HANDLED.has(event.type)) {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      // Re-read the session from Stripe rather than trusting event order.
      await syncCheckoutSession(session.id);
    } catch (e) {
      console.error("Stripe webhook failed", event.id, e);
      return new NextResponse("Processing failed", { status: 500 }); // Stripe retries
    }
  }
  return NextResponse.json({ received: true });
}
