import { UserButton } from "@clerk/nextjs";
import { requireTenant } from "@/lib/auth";
import { PortalNav } from "@/components/portal-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Resident Portal", template: "%s · Resident Portal" } };

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  await requireTenant();
  const phone = process.env.MANAGER_PHONE;
  const email = process.env.MANAGER_EMAIL;
  return (
    <div className="min-h-screen">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pt-4">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
            <div className="text-base font-semibold text-white">Resident Portal</div>
          </div>
          <UserButton />
        </div>
        <div className="mx-auto max-w-2xl px-3 py-2">
          <PortalNav />
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      {(phone || email) && (
        <footer className="mx-auto max-w-2xl px-4 pb-10 text-center text-xs text-muted">
          Questions? Contact your property manager
          {phone && <> · <a href={`tel:${phone}`} className="underline">{phone}</a></>}
          {email && <> · <a href={`mailto:${email}`} className="underline">{email}</a></>}
        </footer>
      )}
    </div>
  );
}
