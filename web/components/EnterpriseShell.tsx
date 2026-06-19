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
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/Button";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { apiGet } from "@/api-client/client";
import type { OutletsResponse } from "@/api-client/types";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";
import { useAccountMode } from "@/lib/useAccountMode";

type NavKey =
  | "dashboard"
  | "register"
  | "inventory"
  | "purchasing"
  | "customers"
  | "orders"
  | "sales"
  | "accounting"
  | "shipping"
  | "discounts"
  | "ecommerce"
  | "reports"
  | "settings"
  | "operations"
  | "team"
  | "insights"
  | "finance"
  | "catalog"
  | "gift-cards"
  | "vendors"
  | "payments"
  | "returns"
  | "tax-compliance"
  | "integrations"
  | "imports-exports";

// editionFlag: if set, this nav item is hidden when the corresponding feature
// flag is false. Items with no editionFlag are always shown.
const NAV_ITEMS: Array<{
  key: NavKey;
  label: string;
  href: string;
  icon: NavKey;
  group: "Operate" | "Manage" | "Analyze" | "Platform";
  editionFlag?: "groupRetailPOS" | "groupWholesale" | "groupEnterprise";
}> = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "dashboard", group: "Operate" },
  { key: "register", label: "Register", href: "/terminal", icon: "register", group: "Operate", editionFlag: "groupRetailPOS" },
  { key: "sales", label: "Sales", href: "/sales", icon: "sales", group: "Operate" },
  { key: "orders", label: "Orders", href: "/orders", icon: "orders", group: "Operate" },
  { key: "returns", label: "Returns", href: "/returns", icon: "returns", group: "Operate", editionFlag: "groupRetailPOS" },
  { key: "payments", label: "Payments", href: "/payments", icon: "payments", group: "Operate" },
  { key: "catalog",   label: "Catalog",   href: "/catalog",   icon: "catalog",   group: "Manage" },
  { key: "inventory", label: "Inventory", href: "/inventory", icon: "inventory", group: "Manage" },
  { key: "operations", label: "Operations", href: "/operations", icon: "operations", group: "Manage" },
  { key: "purchasing", label: "Purchasing", href: "/purchasing", icon: "purchasing", group: "Manage", editionFlag: "groupWholesale" },
  { key: "vendors", label: "Vendors", href: "/vendors", icon: "vendors", group: "Manage", editionFlag: "groupWholesale" },
  { key: "shipping", label: "Shipping", href: "/shipping", icon: "shipping", group: "Manage", editionFlag: "groupWholesale" },
  { key: "customers", label: "Customers", href: "/customers", icon: "customers", group: "Manage", editionFlag: "groupRetailPOS" },
  { key: "discounts", label: "Discounts", href: "/discounts", icon: "discounts", group: "Manage", editionFlag: "groupRetailPOS" },
  { key: "gift-cards", label: "Gift Cards", href: "/gift-cards", icon: "gift-cards", group: "Manage", editionFlag: "groupRetailPOS" },
  { key: "team", label: "Team", href: "/team", icon: "team", group: "Manage" },
  { key: "finance", label: "Finance", href: "/finance", icon: "finance", group: "Analyze", editionFlag: "groupWholesale" },
  { key: "accounting", label: "Accounting", href: "/accounting", icon: "accounting", group: "Analyze", editionFlag: "groupWholesale" },
  { key: "tax-compliance", label: "Tax Compliance", href: "/tax-compliance", icon: "tax-compliance", group: "Analyze", editionFlag: "groupWholesale" },
  { key: "ecommerce", label: "Ecommerce", href: "/ecommerce", icon: "ecommerce", group: "Analyze", editionFlag: "groupEnterprise" },
  { key: "insights", label: "Insights", href: "/insights", icon: "insights", group: "Analyze" },
  { key: "reports", label: "Reports", href: "/reports", icon: "reports", group: "Analyze" },
  { key: "integrations", label: "Integrations", href: "/integrations", icon: "integrations", group: "Platform", editionFlag: "groupEnterprise" },
  { key: "imports-exports", label: "Imports/Exports", href: "/imports-exports", icon: "imports-exports", group: "Platform" },
  { key: "settings", label: "Settings", href: "/settings", icon: "settings", group: "Platform" },
];

const APP_SWITCHER = [
  { label: "POS", href: "/terminal", activeKeys: ["register"] },
  { label: "Admin", href: "/dashboard", activeKeys: ["dashboard", "sales", "orders", "catalog", "customers", "reports", "settings"] },
  { label: "Warehouse", href: "/operations", activeKeys: ["operations", "inventory", "shipping", "purchasing", "vendors"] },
  { label: "B2B", href: "/ecommerce", activeKeys: ["ecommerce", "finance", "accounting", "payments"] },
  { label: "Kiosk", href: "/terminal", activeKeys: [] },
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
  const { editionFlags: flags } = useAccountMode();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K global shortcut
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      <EnterpriseRail active={active} pathname={pathname} flags={flags} />

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {banner}

        <header className="z-10 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
          <div className="border-b border-slate-100 px-3 py-2 sm:px-5">
            <div className="flex gap-1 overflow-x-auto" aria-label="Application areas">
              {APP_SWITCHER.map((app) => {
                const selected = app.activeKeys.includes(active);
                return (
                  <Link
                    key={app.label}
                    href={app.href}
                    aria-current={selected ? "page" : undefined}
                    className={clsx(
                      "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                      selected
                        ? "bg-slate-950 text-white"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-950"
                    )}
                  >
                    {app.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-sm font-bold text-white md:hidden"
              >
                F
              </div>
              <div className="min-w-0">
                <span className="block truncate text-base font-semibold text-slate-950 sm:text-lg">
                  {title}
                </span>
                <span className="block truncate text-xs font-medium text-slate-500">
                  {subtitle}
                </span>
                <nav className="mt-1 hidden text-[11px] font-medium text-slate-400 sm:block" aria-label="Breadcrumb">
                  Finder / {activeLabel(active)} / {title}
                </nav>
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
              {/* ⌘K search trigger */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden min-h-[40px] items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white sm:flex"
                aria-label="Open search (⌘K)"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span className="text-slate-400">Search</span>
                <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-400">⌘K</kbd>
              </button>
              <StoreSwitcher />
              <NotificationBell />
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
          className={clsx("flex-1 overflow-hidden bg-slate-100", contentClassName)}
          aria-label={title}
        >
          {children}
        </main>
      </div>

      <MobileNav active={active} flags={flags} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function EnterpriseRail({
  active,
  pathname,
  flags,
}: {
  active: NavKey;
  pathname: string;
  flags: Record<string, boolean>;
}) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.editionFlag || flags[item.editionFlag] !== false,
  );

  return (
    <aside className="hidden w-20 shrink-0 flex-col border-r border-slate-200 bg-white text-slate-900 md:flex xl:w-64">
      <div className="flex h-[65px] items-center gap-3 border-b border-slate-200 px-4">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-950 text-base font-bold text-white"
        >
          F
        </div>
        <div className="hidden min-w-0 xl:block">
          <p className="truncate text-sm font-semibold text-slate-950">Finder POS</p>
          <p className="truncate text-xs text-slate-500">Enterprise retail suite</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        {(["Operate", "Manage", "Analyze", "Platform"] as const).map((group) => (
          <div key={group} className="space-y-1">
            <p className="hidden px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 xl:block">
              {group}
            </p>
            {visibleItems.filter((item) => item.group === group).map((item) => {
              const selected = active === item.key || pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={selected ? "page" : undefined}
                  className={clsx(
                    "flex min-h-[42px] items-center justify-center gap-3 rounded-md border px-3 text-sm font-medium transition-colors xl:justify-start",
                    selected
                      ? "border-slate-300 bg-slate-950 text-white shadow-sm"
                      : "border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-950"
                  )}
                >
                  <NavIcon name={item.icon} />
                  <span className="hidden xl:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-600 xl:block">Register health</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-success-700">
            <span className="h-2 w-2 rounded-full bg-success-500" aria-hidden="true" />
            <span className="hidden xl:inline">Ready for sales</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ active, flags }: { active: NavKey; flags: Record<string, boolean> }) {
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.editionFlag || flags[item.editionFlag] !== false,
  );
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.08)] md:hidden"
    >
      {visibleItems.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={clsx(
            "flex min-h-[56px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium",
            active === item.key ? "text-slate-950" : "text-slate-500"
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
      className="hidden items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm md:flex"
      aria-busy={loading}
    >
      <StoreIcon />
      <span className="sr-only">Current store</span>
      <select
        className="bg-transparent text-sm font-medium text-slate-800 outline-none"
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
        "inline-flex min-h-[40px] items-center gap-2 rounded-md border px-3 text-sm font-medium",
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
      className="hidden min-h-[40px] items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-left transition-colors hover:bg-slate-50 sm:flex"
    >
      <UserIcon />
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-sm font-medium text-slate-900">
          {name}
        </span>
        <span className="block text-xs capitalize text-slate-500">{role}</span>
      </span>
    </button>
  );
}

function NavIcon({ name }: { name: NavKey }) {
  switch (name) {
    case "dashboard":
      return <DashboardIcon />;
    case "register":
      return <RegisterIcon />;
    case "sales":
      return <SalesIcon />;
    case "orders":
      return <OrdersIcon />;
    case "inventory":
      return <InventoryIcon />;
    case "operations":
      return <OperationsIcon />;
    case "purchasing":
      return <PurchasingIcon />;
    case "shipping":
      return <ShippingIcon />;
    case "customers":
      return <CustomersIcon />;
    case "discounts":
      return <DiscountsIcon />;
    case "accounting":
      return <AccountingIcon />;
    case "ecommerce":
      return <EcommerceIcon />;
    case "reports":
      return <ReportsIcon />;
    case "settings":
      return <SettingsIcon />;
    case "team":
      return <TeamIcon />;
    case "insights":
      return <InsightsIcon />;
    case "finance":
      return <FinanceIcon />;
    case "catalog":
      return <CatalogIcon />;
    case "gift-cards":
      return <GiftCardIcon />;
    case "vendors":
      return <PurchasingIcon />;
    case "payments":
      return <FinanceIcon />;
    case "returns":
      return <RegisterIcon />;
    case "tax-compliance":
      return <AccountingIcon />;
    case "integrations":
      return <OperationsIcon />;
    case "imports-exports":
      return <ReportsIcon />;
    default:
      return <ReportsIcon />;
  }
}

function activeLabel(active: NavKey) {
  return NAV_ITEMS.find((item) => item.key === active)?.label ?? "Workspace";
}

function GiftCardIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 3c0 2-4 4-4 4S8 5 8 3a4 4 0 0 1 8 0z" />
      <line x1="12" y1="7" x2="12" y2="21" />
    </svg>
  );
}

function FinanceIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M7 15h.01" />
      <path d="M11 15h2" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function InsightsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20" />
      <path d="M6 20V10" />
      <path d="M10 20V4" />
      <path d="M14 20V14" />
      <path d="M18 20V8" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
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

function OperationsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4" />
      <path d="M9 14v7" />
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

function SalesIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
      <path d="M7 6v12" />
      <path d="M17 6v12" />
    </svg>
  );
}

function OrdersIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function PurchasingIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function ShippingIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 17h1V9h4l3 4v4h-2" />
      <circle cx="7.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function DiscountsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function AccountingIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8" />
      <path d="M8 11h2" />
      <path d="M14 11h2" />
      <path d="M8 15h2" />
      <path d="M14 15h2" />
    </svg>
  );
}

function EcommerceIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
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

function CatalogIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18" />
      <path d="M3 9h18" />
      <rect x="3" y="13" width="7" height="7" rx="1" />
      <path d="M14 13h7" />
      <path d="M14 17h7" />
      <path d="M14 20h4" />
    </svg>
  );
}
