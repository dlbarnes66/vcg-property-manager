"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard, Building2, Users, FileSignature, Wallet, Wrench, ClipboardCheck, FolderOpen,
  BarChart3, Landmark, HardHat, Menu, X, CalendarDays, ListChecks, MessagesSquare, NotebookPen,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; badge?: "tasks" | "messages" };

const sections: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      { href: "/tasks", label: "Tasks", icon: ListChecks, badge: "tasks" },
      { href: "/communications", label: "Communications", icon: MessagesSquare, badge: "messages" },
    ],
  },
  {
    title: "PORTFOLIO",
    items: [
      { href: "/properties", label: "Properties", icon: Building2 },
      { href: "/tenants", label: "Tenants", icon: Users },
      { href: "/leases", label: "Leases", icon: FileSignature },
      { href: "/payments", label: "Rent & Payments", icon: Wallet },
      { href: "/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/inspections", label: "Inspections", icon: ClipboardCheck },
    ],
  },
  {
    title: "RECORDS",
    items: [
      { href: "/documents", label: "Documents", icon: FolderOpen },
      { href: "/notes", label: "Notes", icon: NotebookPen },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "DIRECTORY",
    items: [
      { href: "/housing-authorities", label: "Housing Authorities", icon: Landmark },
      { href: "/vendors", label: "Vendors", icon: HardHat },
    ],
  },
];

export function Sidebar({ counts = {} }: { counts?: { tasks?: number; messages?: number } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const links = (items: NavItem[]) =>
    items.map(({ href, label, icon: Icon, badge }) => (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
          isActive(href) ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white",
        )}
      >
        <Icon size={16} strokeWidth={1.8} />
        {label}
        {badge && (counts[badge] ?? 0) > 0 && (
          <span className={cn("ml-auto rounded-full px-1.5 text-[11px] font-semibold", badge === "messages" ? "bg-red-500 text-white" : "bg-gold text-navy")}>
            {counts[badge]}
          </span>
        )}
      </Link>
    ));

  return (
    <>
      {/* mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 lg:hidden">
        <span className="text-sm font-semibold text-white">VCG Property Manager</span>
        <button onClick={() => setOpen(!open)} className="text-white" aria-label="Toggle menu">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col overflow-y-auto bg-navy px-3 py-5 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-3 pb-5">
          <div className="text-[10px] font-semibold tracking-[0.2em] text-gold">VENTURE COLLECTIVE GROUP</div>
          <div className="mt-0.5 text-base font-semibold text-white">Property Manager</div>
        </div>
        {sections.map((sec, i) => (
          <div key={i} className={i > 0 ? "mt-5" : ""}>
            {sec.title && <div className="px-3 pb-1.5 text-[10px] font-semibold tracking-wider text-white/40">{sec.title}</div>}
            <nav className="flex flex-col gap-0.5">{links(sec.items)}</nav>
          </div>
        ))}
        <div className="mt-auto flex items-center gap-2 px-3 pt-4">
          <UserButton />
          <span className="text-xs text-white/60">Account</span>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
