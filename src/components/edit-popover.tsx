"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** Small modal used for inline edits inside tables (a dropdown would be clipped by the table's scroll container). */
export function EditPopover({ label = "Edit", title, children }: { label?: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-ink">
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16" onClick={() => setOpen(false)}>
          <div role="dialog" aria-label={title} className="w-full max-w-md rounded-lg border border-line bg-white text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h3 className="text-sm font-semibold">{title}</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
