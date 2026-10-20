"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/accounting", label: "Overview" },
  { href: "/accounting/bills", label: "Bills" },
  { href: "/accounting/banking", label: "Banking" },
  { href: "/accounting/journal", label: "Journal" },
  { href: "/accounting/accounts", label: "Chart of accounts" },
  { href: "/accounting/reports", label: "Financial reports" },
];

export function AccountingNav() {
  const path = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = t.href === "/accounting" ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active ? "border-navy font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
