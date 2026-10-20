import { CheckCircle2 } from "lucide-react";
import { PublicShell } from "@/components/public-shell";

export const metadata = { title: "Application received" };

export default function Thanks() {
  return (
    <PublicShell>
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <CheckCircle2 size={44} className="text-emerald-600" />
        <h1 className="text-xl font-semibold">Application received</h1>
        <p className="max-w-md text-sm text-muted">
          Thank you. We review applications in the order we receive them and will contact you by phone or email, usually within two business days.
          If you have a housing voucher, it helps to let your case manager know you applied.
        </p>
        <a href="/rentals" className="mt-2 text-sm text-navy underline">See other homes</a>
      </div>
    </PublicShell>
  );
}
