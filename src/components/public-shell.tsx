export function PublicShell({ children }: { children: React.ReactNode }) {
  const phone = process.env.MANAGER_PHONE;
  return (
    <div className="min-h-screen">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <a href="/rentals">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
            <div className="text-base font-semibold text-white">Homes for Rent</div>
          </a>
          {phone && <a href={`tel:${phone}`} className="text-sm text-white/80 hover:text-white">{phone}</a>}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-muted">
        <p className="font-semibold">Equal Housing Opportunity.</p>
        <p className="mt-1">
          We do not discriminate on the basis of race, color, religion, sex, national origin, disability, familial status, or any other protected
          characteristic. Housing vouchers, including HUD-VASH, are welcome. Reasonable accommodations are available on request.
        </p>
      </footer>
    </div>
  );
}
