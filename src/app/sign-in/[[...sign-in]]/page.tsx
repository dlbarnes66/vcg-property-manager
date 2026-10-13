import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-navy p-6">
      <div className="text-center text-white">
        <div className="text-xs font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
        <h1 className="mt-1 text-2xl font-semibold">Property Manager</h1>
      </div>
      <SignIn />
    </main>
  );
}
