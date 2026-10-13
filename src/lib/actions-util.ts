import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";

export type ActionResult = { ok?: boolean; error?: string; message?: string } | null;

/** Turn thrown errors into a friendly message for ActionForm. Re-throws Next.js redirects. */
export function toActionError(e: unknown): ActionResult {
  unstable_rethrow(e); // let redirect()/notFound() through
  if (e instanceof ZodError) return { error: e.issues.map((i) => `${i.path.join(".") || "Field"}: ${i.message}`).join(" · ") };
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return { error: "That already exists (duplicate)." };
    if (e.code === "P2003" || e.code === "P2014")
      return { error: "Can't delete this because other records depend on it (e.g. leases or payments)." };
  }
  if (e instanceof Error) return { error: e.message };
  return { error: "Something went wrong." };
}
