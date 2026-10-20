import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-navy p-6">
      <div className="text-center text-white">
        <div className="text-xs font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
        <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-white/70">Property Manager &amp; Resident Portal</p>
      </div>
      {/* "/" sends admins to the dashboard and residents on to /portal */}
      <SignIn signUpUrl="/sign-up" fallbackRedirectUrl="/" />
    </main>
  );
}
