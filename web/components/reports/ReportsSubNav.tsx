"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const REPORT_LINKS = [
  { label: "Overview", href: "/reporting" },
  { label: "Sales", href: "/reporting/sales" },
  { label: "End of Day", href: "/reporting/closing" },
  { label: "P&L", href: "/reporting/p-l" },
  { label: "By Rep", href: "/reporting/sales-by-rep" },
  { label: "By Vendor", href: "/reporting/sales-by-vendor" },
  { label: "Inventory", href: "/reporting/inventory" },
  { label: "AR Aging", href: "/reporting/ar-aging" },
  { label: "Expiry", href: "/reporting/expiry" },
] as const;

export function ReportsSubNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2">
      {REPORT_LINKS.map((link) => {
        const active = link.href === "/reporting" ? pathname === "/reporting" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
