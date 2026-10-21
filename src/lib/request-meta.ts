import "server-only";
import { headers } from "next/headers";

/** Caller's IP and device, for the signature audit trail. */
export async function requestMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  return { ip, userAgent: h.get("user-agent") };
}
