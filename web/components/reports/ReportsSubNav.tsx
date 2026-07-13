"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// One entry per report — every report page is reachable from this sub-nav
// (no URL-only dead ends). Hrefs are the canonical /reports tree; the legacy
// /reporting/* aliases still serve the same pages and highlight correctly.
const REPORT_LINKS = [
  { label: "Overview", href: "/reports" },
  { label: "Sales", href: "/reports/sales" },
  { label: "End of Day", href: "/reports/end-of-day" },
  { label: "P&L", href: "/reports/p-l" },
  { label: "Purchases", href: "/reports/purchases" },
  { label: "By Rep", href: "/reports/sales-by-rep" },
  { label: "By Vendor", href: "/reports/sales-by-vendor" },
  { label: "Inventory", href: "/reports/inventory" },
  { label: "AR Aging", href: "/reports/ar-aging" },
  { label: "Expiry", href: "/reports/expiry" },
  { label: "Cash Movement", href: "/reports/cash-movement" },
  { label: "Register Closures", href: "/reports/register-closures" },
  { label: "Time Cards", href: "/reports/time-cards" },
] as const;

/** Map any legacy /reporting URL onto its canonical /reports twin for matching. */
function canonical(pathname: string): string {
  return pathname
    .replace(/^\/reporting\/closing/, "/reports/end-of-day")
    .replace(/^\/reporting/, "/reports");
}

export function ReportsSubNav() {
  const pathname = canonical(usePathname());
  return (
    <div className="flex flex-wrap gap-2">
      {REPORT_LINKS.map((link) => {
        const active = link.href === "/reports" ? pathname === "/reports" : pathname.startsWith(link.href);
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
