import { Prisma } from "@prisma/client";
import { db } from "./db";
import { todayUTC } from "./utils";

export type StripeOutcome = {
  sessionStatus: "open" | "complete" | "expired" | null;
  paymentIntent: null | {
    id: string;
    status: string; // succeeded | processing | requires_payment_method | canceled | ...
    amountReceived: number;
    methodType: string | null; // us_bank_account | card
    errorMessage: string | null;
  };
};

/**
 * Applies what Stripe says about a checkout session to our records. Idempotent: safe to call from
 * the webhook, the return page, and retries in any order. Only a SUCCEEDED payment touches the ledger.
 */
export async function applyStripeOutcome(checkoutSessionId: string, o: StripeOutcome) {
  const op = await db.onlinePayment.findUnique({ where: { checkoutSessionId } });
  if (!op || op.status === "SUCCEEDED") return op;

  const pi = o.paymentIntent;
  if (!pi) {
    if (o.sessionStatus === "expired") return db.onlinePayment.update({ where: { id: op.id }, data: { status: "EXPIRED" } });
    return op;
  }

  if (pi.status === "succeeded") {
    try {
      return await db.$transaction(async (tx) => {
        const existing = await tx.payment.findUnique({ where: { stripePaymentIntentId: pi.id } });
        const payment =
          existing ??
          (await tx.payment.create({
            data: {
              leaseId: op.leaseId,
              party: "TENANT",
              amount: pi.amountReceived || op.amount,
              paidOn: todayUTC(),
              method: pi.methodType === "card" ? "CARD" : "ACH",
              reference: pi.id,
              notes: "Paid online (tenant portal)",
              stripePaymentIntentId: pi.id,
            },
          }));
        return tx.onlinePayment.update({ where: { id: op.id }, data: { status: "SUCCEEDED", paymentId: payment.id, paymentIntentId: pi.id, failureReason: null } });
      });
    } catch (e) {
      // A concurrent call already posted it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return db.onlinePayment.findUnique({ where: { id: op.id } });
      throw e;
    }
  }

  if (pi.status === "processing")
    return db.onlinePayment.update({ where: { id: op.id }, data: { status: "PROCESSING", paymentIntentId: pi.id } });

  if (o.sessionStatus === "complete" && (pi.status === "requires_payment_method" || pi.status === "canceled"))
    return db.onlinePayment.update({
      where: { id: op.id },
      data: { status: "FAILED", paymentIntentId: pi.id, failureReason: pi.errorMessage ?? "The bank transfer didn't go through." },
    });

  if (o.sessionStatus === "expired") return db.onlinePayment.update({ where: { id: op.id }, data: { status: "EXPIRED" } });
  return op;
}
