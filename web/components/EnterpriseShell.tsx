"use client";

/**
 * EnterpriseShell — shared retail operations frame.
 *
 * Benchmark: Lightspeed Retail X-Series patterns, adapted for Finder:
 * register-first workflow, persistent module navigation, store/register
 * context, user context, and device connectivity status.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/Button";
import { apiGet } from "@/api-client/client";
import type { OutletsResponse } from "@/api-client/types";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";

type NavKey =
  | "register"
  | "inventory"
  | "customers"
  | "sales"
  | "accounting"
  | "shipping"
  | "discounts"
  | "ecommerce"
  | "reports"
  | "settings";

const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  href: string;
  icon: NavKey;
}> = [
  { key: "register", label: "Register", href: "/terminal", icon: "register" },
  { key: "sales", label: "Sales", href: "/sales", icon: "sales" },
  { key: "inventory", label: "Inventory", href: "/inventory", icon: "inventory" },
  { key: "shipping", label: "Shipping", href: "/shipping", icon: "shipping" },
  { key: "customers", label: "Customers", href: "/customers", icon: "customers" },
  { key: "discounts", label: "Discounts", href: "/discounts", icon: "discounts" },
  { key: "accounting", label: "Accounting", href: "/accounting", icon: "accounting" },
  { key: "ecommerce", label: "Ecommerce", href: "/ecommerce", icon: "ecommerce" },
  { key: "reports", label: "Reports", href: "/reports", icon: "reports" },
  { key: "settings", label: "Settings", href: "/settings", icon: "settings" },
];

interface EnterpriseShellProps {
  active: NavKey;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  banner?: React.ReactNode;
  contentClassName?: string;
}

export function EnterpriseShell({
  active,
  title,
  subtitle,
  children,
  banner,
  contentClassName,
}: EnterpriseShellProps) {
  const { user, logout } = useAuth();
  const { isOffline } = useOffline();
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-100">
      <EnterpriseRail active={active} pathname={pathname} />

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {banner}

        <header className="z-10 border-b border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white md:hidden"
              >
                F
              </div>
              <div className="min-w-0">
                <span className="block truncate text-base font-semibold text-gray-900 sm:text-lg">
                  {title}
                </span>
                <span className="block truncate text-xs font-medium text-gray-500">
                  {subtitle}
                </span>
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              <StoreSwitcher />
              <DeviceStatus isOffline={isOffline} />
              {user && <UserContext name={user.name} role={user.role} />}
              <Button variant="ghost" size="sm" onClick={() => void logout()}>
                Sign out
              </Button>
            </div>
          </div>
        </header>

        <main
          id="terminal-content"
          className={clsx("flex-1 overflow-hidden", contentClassName)}
          aria-label={title}
        >
          {children}
        </main>
      </div>

      <MobileNav active={active} />
    </div>
  );
}

function EnterpriseRail({
  active,
  pathname,
}: {
  active: NavKey;
  pathname: string;
}) {
  return (
    <aside className="hidden w-20 shrink-0 flex-col border-r border-slate-800 bg-slate-950 text-white md:flex xl:w-64">
      <div className="flex h-[65px] items-center gap-3 border-b border-slate-800 px-4">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-base font-bold"
        >
          F
        </div>
        <div className="hidden min-w-0 xl:block">
          <p className="truncate text-sm font-semibold">Finder POS</p>
          <p className="truncate text-xs text-slate-400">Retail operations</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const selected = active === item.key || pathname === item.href;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={selected ? "page" : undefined}
              className={clsx(
                "flex min-h-[48px] items-center justify-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors xl:justify-start",
                selected
                  ? "bg-white text-slate-950"
                  : "text-slate-300 hover:bg-slate-900 hover:text-white"
              )}
            >
              <NavIcon name={item.icon} />
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-800 p-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <p className="text-xs font-medium text-slate-300 xl:block">Register health</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-success-500">
            <span className="h-2 w-2 rounded-full bg-success-500" aria-hidden="true" />
            <span className="hidden xl:inline">Ready for sales</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ active }: { active: NavKey }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-gray-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:hidden"
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={clsx(
            "flex min-h-[56px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            active === item.key ? "text-brand-700" : "text-gray-500"
          )}
        >
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function StoreSwitcher() {
  const fallbackOptions = useMemo(
    () => [{ value: "demo-store:register-01", label: "Demo Store / Register 01" }],
    []
  );
  const [options, setOptions] = useState(fallbackOptions);
  const [selected, setSelected] = useState(fallbackOptions[0]!.value);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiGet<OutletsResponse>("/api/v1/outlets", { signal: controller.signal })
      .then((data) => {
        const nextOptions = data.items.flatMap((outlet) => {
          if (outlet.registers.length === 0) {
            return [{ value: `${outlet.id}:none`, label: `${outlet.name} / No register` }];
          }
          return outlet.registers.map((register) => ({
            value: `${outlet.id}:${register.id}`,
            label: `${outlet.name} / ${register.name}${register.status === "closed" ? " (closed)" : ""}`,
          }));
        });
        const normalized = nextOptions.length > 0 ? nextOptions : fallbackOptions;
        setOptions(normalized);
        setSelected((current) =>
          normalized.some((option) => option.value === current) ? current : normalized[0]!.value
        );
      })
      .catch(() => {
        setOptions(fallbackOptions);
        setSelected(fallbackOptions[0]!.value);
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
    };
  }, [fallbackOptions]);

  return (
    <label
      className="hidden items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm md:flex"
      aria-busy={loading}
    >
      <StoreIcon />
      <span className="sr-only">Current store</span>
      <select
        className="bg-transparent text-sm font-medium text-gray-800 outline-none"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        aria-label="Current store and register"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeviceStatus({ isOffline }: { isOffline: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        "inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm font-medium",
        isOffline
          ? "border-warning-200 bg-warning-50 text-warning-700"
          : "border-success-200 bg-success-50 text-success-700"
      )}
    >
      {isOffline ? <OfflineIcon /> : <OnlineIcon />}
      <span>{isOffline ? "Offline queue" : "Online"}</span>
    </div>
  );
}

function UserContext({ name, role }: { name: string; role: string }) {
  return (
    <button
      type="button"
      title="User switching coming soon"
      className="hidden min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-left transition-colors hover:bg-gray-50 sm:flex"
    >
      <UserIcon />
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-sm font-medium text-gray-900">
          {name}
        </span>
        <span className="block text-xs capitalize text-gray-500">{role}</span>
      </span>
    </button>
  );
}

function NavIcon({ name }: { name: NavKey }) {
  switch (name) {
    case "register":
      return <RegisterIcon />;
    case "inventory":
      return <InventoryIcon />;
    case "customers":
      return <CustomersIcon />;
    case "reports":
      return <ReportsIcon />;
    case "settings":
      return <SettingsIcon />;
    default:
      return <ReportsIcon />;
  }
}

function OfflineIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l22 22" />
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
    </svg>
  );
}

function OnlineIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg aria-hidden="true" className="text-gray-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9h18l-2-5H5L3 9Z" />
      <path d="M5 9v11h14V9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg aria-hidden="true" className="text-gray-500" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function RegisterIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h2" />
      <path d="M14 15h2" />
    </svg>
  );
}

function InventoryIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}

function CustomersIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16v-5" />
      <path d="M12 16V8" />
      <path d="M16 16v-3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.21.39.6.6 1 .6H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.4Z" />
    </svg>
  );
}
