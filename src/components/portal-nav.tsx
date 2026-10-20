"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Home, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/portal/documents", label: "Documents", icon: FolderOpen },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/portal" ? pathname === "/portal" || pathname.startsWith("/portal/pay") : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm",
              active ? "bg-white/15 font-medium text-white" : "text-white/70 hover:text-white",
            )}
          >
            <Icon size={16} strokeWidth={1.8} />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label === "Maintenance" ? "Repairs" : label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
