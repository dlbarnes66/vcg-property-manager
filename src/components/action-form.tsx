"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/actions-util";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * Wraps a server action so validation errors show inline instead of crashing the page.
 * Successful actions either redirect (from the server) or return { ok: true, message }.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className,
  resetOnSuccess = false,
  confirm,
  inline = false,
  submitVariant = "primary",
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  inline?: boolean;
  submitVariant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <div className={inline ? "flex flex-wrap items-end gap-3" : "flex flex-col gap-4"}>
        {children}
        <div className={inline ? "" : "flex items-center gap-3"}>
          <Submit label={submitLabel} variant={submitVariant} size={inline ? "md" : "md"} />
          {!inline && <Status state={state} />}
        </div>
      </div>
      {inline && <Status state={state} className="mt-2" />}
    </form>
  );
}

function Status({ state, className }: { state: ActionResult; className?: string }) {
  if (!state) return null;
  if (state.error) return <p className={`text-sm text-red-700 ${className ?? ""}`}>{state.error}</p>;
  if (state.message) return <p className={`text-sm text-emerald-700 ${className ?? ""}`}>{state.message}</p>;
  return null;
}

function Submit({ label, variant, size }: { label: string; variant: "primary" | "secondary" | "danger" | "ghost"; size: "md" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}
