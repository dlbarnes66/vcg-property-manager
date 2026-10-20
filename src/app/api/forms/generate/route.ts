import { draftForm } from "@/lib/forms/generate";
import { streamDraft } from "@/lib/forms/stream";

export const maxDuration = 300; // long leases can take a couple of minutes to write

/** POST { formType, state, leaseId?, tenantId?, propertyId?, vendorId?, templateId?, instructions? } → streams the draft. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" && (b[k] as string).trim() ? (b[k] as string).trim() : null);
  return streamDraft(({ email, onText }) =>
    draftForm(
      { formType: s("formType") ?? "", state: s("state"), leaseId: s("leaseId"), tenantId: s("tenantId"), propertyId: s("propertyId"), vendorId: s("vendorId"), templateId: s("templateId"), instructions: s("instructions"), email },
      { onText },
    ),
  );
}
