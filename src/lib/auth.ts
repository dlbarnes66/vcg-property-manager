import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

function allowedEmails() {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Every page and server action calls this. Signed-in via Clerk AND (if ALLOWED_EMAILS is set)
 * one of the listed emails. Returns the Clerk user id.
 */
export async function requireAccess(): Promise<string> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const allow = allowedEmails();
  if (allow.length > 0) {
    const user = await currentUser();
    const emails = (user?.emailAddresses ?? []).map((e) => e.emailAddress.toLowerCase());
    if (!emails.some((e) => allow.includes(e))) redirect("/not-authorized");
  }
  return userId;
}
