"use client";

import { Select } from "@/components/ui";

/** A <select> that submits its form as soon as the choice changes (for GET filter forms). */
export function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
