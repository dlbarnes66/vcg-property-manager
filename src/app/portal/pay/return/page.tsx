import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/auth";
import { stripeEnabled, syncCheckoutSession } from "@/lib/stripe";
import { Card, CardBody, LinkButton } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata = { title: "Payment" };

export default async function PaymentReturn({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { tenant } = await requireTenant();
  const { session_id } = await searchParams;

  let op = session_id ? await db.onlinePayment.findUnique({ where: { checkoutSessionId: session_id } }) : null;
  if (op && op.tenantId !== tenant.id) op = null; // never show someone else's payment
  if (op && stripeEnabled()) {
    try {
      op = (await syncCheckoutSession(op.checkoutSessionId)) ?? op;
    } catch (e) {
      console.error("Couldn't confirm checkout session", e); // the webhook will catch up
    }
  }

  const view = !op
    ? { icon: <XCircle className="text-muted" size={40} />, title: "We couldn't find that payment", body: "If you completed a payment, it will appear on your home page shortly." }
    : op.status === "SUCCEEDED"
      ? { icon: <CheckCircle2 className="text-emerald-600" size={40} />, title: `Payment of ${money(op.amount)} received`, body: "Thank you! Your balance has been updated." }
      : op.status === "PROCESSING" || op.status === "PENDING"
        ? {
            icon: <Clock className="text-blue-600" size={40} />,
            title: `Bank transfer of ${money(op.amount)} submitted`,
            body: "Bank transfers usually take about 4 business days to clear. It shows as processing on your home page until then. You don't need to pay again.",
          }
        : op.status === "FAILED"
          ? { icon: <XCircle className="text-red-600" size={40} />, title: "The payment didn't go through", body: op.failureReason ?? "Please try again or contact your property manager." }
          : { icon: <XCircle className="text-muted" size={40} />, title: "Payment not completed", body: "No money was taken. You can start a new payment from your home page." };

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
        {view.icon}
        <h1 className="text-lg font-semibold">{view.title}</h1>
        <p className="max-w-sm text-sm text-muted">{view.body}</p>
        <LinkButton href="/portal" className="mt-2">Back to home</LinkButton>
      </CardBody>
    </Card>
  );
}
