import { SignUp } from "@clerk/nextjs";

// Tenants land here from their invitation email. Sign-up is invite-only (Clerk "Restricted" mode).
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-navy p-6">
      <div className="text-center text-white">
        <div className="text-xs font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
        <h1 className="mt-1 text-2xl font-semibold">Resident Portal</h1>
        <p className="mt-2 max-w-xs text-sm text-white/70">Create your account with the email address your invitation was sent to.</p>
      </div>
      <SignUp signInUrl="/sign-in" fallbackRedirectUrl="/portal" />
    </main>
  );
}
