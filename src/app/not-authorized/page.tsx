import { SignOutButton } from "@clerk/nextjs";

export default function NotAuthorized() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">This account doesn&apos;t have access</h1>
      <p className="max-w-sm text-sm text-muted">
        Residents: sign up from the invitation email, using the same email address it was sent to. If your access was turned off or your email
        changed, contact your property manager for a new invitation.
      </p>
      <p className="max-w-sm text-xs text-muted">Owners: add your email to ALLOWED_EMAILS.</p>
      <SignOutButton redirectUrl="/sign-in">
        <button className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white">Sign out</button>
      </SignOutButton>
    </main>
  );
}
