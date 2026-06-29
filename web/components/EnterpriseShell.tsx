"use client";

/**
 * EnterpriseShell — shared retail operations frame.
 *
 * Register-first workflow, persistent module navigation, store/register
 * context, user context, and device connectivity status.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { apiGet } from "@/api-client/client";
import type { OutletsResponse } from "@/api-client/types";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";
import { useFinderContext } from "@/lib/useFinderContext";
import { useModuleFlags } from "@/hooks/useModuleFlags";

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
  | "imports-exports"
  | "workflows"
  | "quotes"
  | "loyalty"
  | "notifications"
  | "audit-log"
  | "service-orders"
  | "inventory-locations"
  | "inventory-expiry"
  | "invoicing"
  | "inventory-serials"
  | "inventory-reorder"
  | "inventory-counts"
  | "workforce"
  | "restaurant-floor-plan"
  | "restaurant-kitchen"
  | "restaurant-tabs"
  | "hospitality-rooms"
  | "appointments"
  | "healthcare-patients"
  | "manufacturing-orders"
  | "automotive-vehicles"
  | "automotive-work-orders"
  | "rental-assets"
  | "rental-contracts"
  | "entertainment-tickets"
  | "education-students"
  | "setup-modules";

/** Full nav item definition — module key gates visibility. */
interface NavItemDef {
  key: NavKey;
  label: string;
  href: string;
  icon: NavKey;
  group: "Operate" | "Manage" | "Analyze" | "Platform";
  /** Module key that must be enabled to show this item. Omit = always visible. */
  module?: string;
}

/** All possible nav items across all verticals.
 *  Filtered at render time by useModuleFlags(). */
const ALL_NAV_ITEMS: NavItemDef[] = [
  // ── Always visible ───────────────────────────────────────────────────────
  { key: "dashboard",  label: "Dashboard",     href: "/dashboard",    icon: "dashboard",  group: "Operate" },
  { key: "settings",   label: "Setup",         href: "/setup",        icon: "settings",   group: "Platform" },

  // ── Retail / POS ─────────────────────────────────────────────────────────
  { key: "register",   label: "Sell",          href: "/sell",         icon: "register",   group: "Operate",  module: "pos_terminal" },
  { key: "discounts",  label: "Discounts",     href: "/discounts",    icon: "discounts",  group: "Manage",   module: "discounts" },
  { key: "loyalty",    label: "Loyalty",       href: "/loyalty",      icon: "loyalty",    group: "Manage",   module: "loyalty" },
  { key: "gift-cards", label: "Gift Cards",    href: "/gift-cards",   icon: "gift-cards", group: "Manage",   module: "gift_cards" },
  { key: "ecommerce",  label: "Ecommerce",     href: "/ecommerce",    icon: "ecommerce",  group: "Platform", module: "ecommerce" },

  // ── Core always-on modules ────────────────────────────────────────────────
  { key: "catalog",    label: "Catalog",       href: "/catalog",      icon: "catalog",    group: "Manage" },
  { key: "inventory",  label: "Inventory",     href: "/inventory",    icon: "inventory",  group: "Manage" },
  { key: "customers",  label: "Customers",     href: "/customers",    icon: "customers",  group: "Manage" },
  { key: "reports",    label: "Reporting",     href: "/reporting",    icon: "reports",    group: "Analyze" },

  // ── B2B / Wholesale ───────────────────────────────────────────────────────
  { key: "quotes",      label: "Quotes",       href: "/quotes",       icon: "quotes",      group: "Operate", module: "quotes" },
  { key: "sales",       label: "Sales Orders", href: "/sales",        icon: "sales",       group: "Operate", module: "sales_orders" },
  { key: "purchasing",  label: "Purchasing",   href: "/purchasing",   icon: "purchasing",  group: "Manage",  module: "purchasing" },
  { key: "vendors",     label: "Vendors",      href: "/vendors",      icon: "vendors",     group: "Manage",  module: "purchasing" },
  { key: "accounting",  label: "Accounting",   href: "/accounting",   icon: "accounting",  group: "Analyze", module: "accounting" },
  { key: "finance",     label: "Finance",      href: "/finance",      icon: "finance",     group: "Analyze", module: "billing" },

  // ── Restaurant ────────────────────────────────────────────────────────────
  { key: "restaurant-floor-plan", label: "Floor Plan",    href: "/restaurant/floor-plan", icon: "orders",   group: "Operate", module: "tables" },
  { key: "restaurant-kitchen",    label: "Kitchen (KDS)", href: "/restaurant/kitchen",    icon: "operations",group: "Operate", module: "kitchen" },
  { key: "restaurant-tabs",       label: "Bar Tabs",      href: "/restaurant/tabs",       icon: "finance",  group: "Operate", module: "bar_tabs" },

  // ── Hospitality ───────────────────────────────────────────────────────────
  { key: "hospitality-rooms",     label: "Rooms",         href: "/hospitality/rooms",     icon: "inventory",group: "Operate", module: "room_billing" },

  // ── Services ──────────────────────────────────────────────────────────────
  { key: "appointments",          label: "Appointments",  href: "/appointments",          icon: "team",     group: "Operate", module: "appointments" },

  // ── Healthcare ────────────────────────────────────────────────────────────
  { key: "healthcare-patients",   label: "Patients",      href: "/healthcare/patients",   icon: "customers",group: "Manage", module: "patient_records" },

  // ── Manufacturing ─────────────────────────────────────────────────────────
  { key: "manufacturing-orders",  label: "Production",    href: "/manufacturing/orders",  icon: "purchasing",group: "Manage", module: "production_orders" },

  // ── Automotive ────────────────────────────────────────────────────────────
  { key: "automotive-vehicles",   label: "Vehicles",      href: "/automotive/vehicles",   icon: "inventory",group: "Manage", module: "vehicle_history" },
  { key: "automotive-work-orders",label: "Work Orders",   href: "/automotive/work-orders",icon: "operations",group: "Operate",module: "work_orders" },

  // ── Rental ────────────────────────────────────────────────────────────────
  { key: "rental-assets",         label: "Rental Assets", href: "/rental/assets",         icon: "inventory",group: "Manage", module: "asset_tracking" },
  { key: "rental-contracts",      label: "Contracts",     href: "/rental/contracts",      icon: "sales",    group: "Operate", module: "rental_contracts" },

  // ── Entertainment ─────────────────────────────────────────────────────────
  { key: "entertainment-tickets", label: "Tickets",       href: "/entertainment/tickets", icon: "discounts",group: "Operate", module: "tickets" },

  // ── Education ─────────────────────────────────────────────────────────────
  { key: "education-students",    label: "Students",      href: "/education/students",    icon: "customers",group: "Manage", module: "student_accounts" },

  // ── Setup: Module Marketplace ─────────────────────────────────────────────
  { key: "setup-modules",         label: "Modules",       href: "/setup/modules",         icon: "settings", group: "Platform" },

  // ── Workforce & Operations ─────────────────────────────────────────────────
  { key: "workforce",   label: "Workforce",    href: "/workforce",    icon: "workforce",  group: "Manage",   module: "workforce" },
  { key: "operations",  label: "Operations",   href: "/operations",   icon: "operations", group: "Manage",   module: "wms" },
  { key: "shipping",    label: "Shipping",     href: "/shipping",     icon: "shipping",   group: "Manage",   module: "shipping_mgmt" },

  // ── Platform ──────────────────────────────────────────────────────────────
  { key: "team",             label: "Team",         href: "/team",              icon: "team",             group: "Platform" },
  { key: "workflows",        label: "Workflows",    href: "/workflows",         icon: "workflows",        group: "Platform" },
  { key: "integrations",     label: "Integrations", href: "/integrations",      icon: "integrations",     group: "Platform", module: "webhooks" },
  { key: "notifications",    label: "Notifications",href: "/notifications",     icon: "notifications",    group: "Platform" },
  { key: "audit-log",        label: "Audit Log",    href: "/audit-log",         icon: "audit-log",        group: "Platform" },
  { key: "imports-exports",  label: "Import/Export",href: "/imports-exports",   icon: "imports-exports",  group: "Platform" },
];

const MODULE_BY_ACTIVE: Record<NavKey, NavKey> = {
  dashboard: "dashboard", register: "register", sales: "register", orders: "register",
  quotes: "register", returns: "register", "service-orders": "register", invoicing: "register",
  payments: "finance", reports: "reports", insights: "reports", "tax-compliance": "reports",
  catalog: "catalog", discounts: "catalog", "gift-cards": "catalog", vendors: "catalog",
  inventory: "inventory", operations: "inventory", purchasing: "inventory", shipping: "inventory",
  "inventory-locations": "inventory", "inventory-expiry": "inventory", "inventory-serials": "inventory",
  "inventory-reorder": "inventory", "inventory-counts": "inventory", workforce: "settings",
  customers: "customers", loyalty: "customers", finance: "finance", accounting: "finance",
  ecommerce: "ecommerce", settings: "settings", team: "settings", workflows: "settings",
  integrations: "settings", "imports-exports": "settings", notifications: "settings", "audit-log": "settings",
  // Restaurant
  "restaurant-floor-plan": "restaurant-floor-plan",
  "restaurant-kitchen": "restaurant-floor-plan",
  "restaurant-tabs": "restaurant-floor-plan",
  // Hospitality
  "hospitality-rooms": "hospitality-rooms",
  // Services
  appointments: "appointments",
  // Healthcare
  "healthcare-patients": "healthcare-patients",
  // Manufacturing
  "manufacturing-orders": "manufacturing-orders",
  // Automotive
  "automotive-vehicles": "automotive-vehicles",
  "automotive-work-orders": "automotive-vehicles",
  // Rental
  "rental-assets": "rental-assets",
  "rental-contracts": "rental-assets",
  // Entertainment
  "entertainment-tickets": "entertainment-tickets",
  // Education
  "education-students": "education-students",
  // Setup
  "setup-modules": "settings",
};

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
  const { enabled: enabledModules } = useModuleFlags();
  const { isOffline } = useOffline();
  const pathname = usePathname();
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
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--color-page-bg)" }}>
      <EnterpriseRail active={active} pathname={pathname} />

      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        {banner}

        {/* ── Top header (SalesGent spec: #F7F7F7 bg, 77px total) ──────── */}
        <header
          className="z-10 sticky top-0"
          style={{
            backgroundColor: "var(--color-header-bg)",
            borderBottom: "1px solid var(--color-header-border)",
          }}
        >
          {/* Row 1 — app switcher + search + store + utilities */}
          <div
            className="flex items-center justify-between gap-3 px-4 py-2"
            style={{ borderBottom: "1px solid var(--color-header-border)" }}
          >
            {/* Global search */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden max-w-xl flex-1 items-center gap-2 rounded border border-[#D9D9D9] bg-white px-3 h-8 text-[13px] text-[rgba(0,0,0,0.45)] transition-colors hover:border-brand-600 sm:flex"
              aria-label="Open search (⌘K)"
            >
              <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="flex-1 text-left">Search in All</span>
              <kbd className="rounded border border-[#D9D9D9] bg-[#F7F7F7] px-1.5 py-0.5 text-[11px] text-[rgba(0,0,0,0.45)]">⌘K</kbd>
            </button>

            {/* Right: store + notifications + user */}
            <div className="flex items-center gap-2">
              <StoreSwitcher />
              <NotificationBell />
              <DeviceStatus isOffline={isOffline} />
              {user && <UserContext name={user.name} role={user.role} onLogout={() => void logout()} />}
            </div>
          </div>

          {/* Row 2 — breadcrumb + page title */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              {/* Mobile logo */}
              <div
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold text-white md:hidden"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                F
              </div>
              {/* Breadcrumb: 🏠 > Parent > Current */}
              <nav className="flex items-center gap-1 text-[13px]" aria-label="Breadcrumb">
                <Link href="/dashboard" className="text-[rgba(0,0,0,0.45)] hover:text-brand-600 transition-colors" aria-label="Home">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </Link>
                <ChevronRight />
                <Link
                  href={ALL_NAV_ITEMS.find((i) => i.key === MODULE_BY_ACTIVE[active])?.href ?? "/"}
                  className="transition-colors hover:text-brand-600"
                  style={{ color: "var(--color-link)" }}
                >
                  {activeLabel(active)}
                </Link>
                <ChevronRight />
                <span className="font-medium text-[rgba(0,0,0,0.88)] truncate max-w-[200px]">{title}</span>
              </nav>
            </div>
            <span className="hidden text-[12px] text-[rgba(0,0,0,0.45)] sm:block">{subtitle}</span>
          </div>
        </header>

        <main
          id="terminal-content"
          className={clsx("flex-1 overflow-hidden", contentClassName)}
          style={{ backgroundColor: "var(--color-page-bg)" }}
          aria-label={title}
        >
          {children}
        </main>
      </div>

      <MobileNav active={active} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
  const { enabled: enabledModules } = useModuleFlags();
  const selectedModule = MODULE_BY_ACTIVE[active];

  return (
    <aside
      className="hidden w-20 shrink-0 flex-col md:flex xl:w-64"
      style={{ backgroundColor: "var(--color-sidebar-bg)", borderRight: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Logo area */}
      <div
        className="flex h-[65px] items-center gap-3 px-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-bold text-white"
          style={{ backgroundColor: "var(--color-sidebar-active)" }}
        >
          F
        </div>
        <div className="hidden min-w-0 xl:block">
          <p className="truncate text-sm font-semibold text-white">Finder POS</p>
          <p className="truncate text-xs text-white/50">Enterprise retail suite</p>
        </div>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30 xl:block">
            Modules
          </p>
          {ALL_NAV_ITEMS.filter(item => !item.module || enabledModules.has(item.module) || enabledModules.has("*")).map((item) => {
            const selected = selectedModule === item.key || pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={selected ? "page" : undefined}
                className={clsx(
                  "flex min-h-[40px] items-center justify-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors xl:justify-start",
                  selected ? "text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
                style={selected ? { backgroundColor: "var(--color-sidebar-active)" } : undefined}
              >
                <NavIcon name={item.icon} />
                <span className="hidden xl:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Footer — register health indicator */}
      <div className="p-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="rounded-md p-3" style={{ backgroundColor: "rgba(255,255,255,0.06)" }}>
          <p className="hidden text-[11px] font-semibold text-white/50 xl:block">Register health</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="hidden xl:inline">Ready for sales</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function MobileNav({ active }: { active: NavKey }) {
  const { enabled: enabledModules } = useModuleFlags();
  const selectedModule = MODULE_BY_ACTIVE[active];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-white/10 md:hidden"
      style={{ backgroundColor: "var(--color-sidebar-bg)", boxShadow: "0 -4px 16px rgba(0,0,0,0.3)" }}
    >
      {ALL_NAV_ITEMS.filter(item => !item.module || enabledModules.has(item.module) || enabledModules.has("*")).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={selectedModule === item.key ? "page" : undefined}
          className={clsx(
            "flex min-h-[56px] min-w-[72px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
            selectedModule === item.key ? "text-white" : "text-white/50 hover:text-white"
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
  const { outletId, registerId, setLocation } = useFinderContext();
  const fallbackOptions = useMemo(
    () => [{ value: "demo-store:register-01", label: "Demo Store / Register 01" }],
    []
  );
  const [options, setOptions] = useState(fallbackOptions);
  const [loading, setLoading] = useState(false);
  const selected = `${outletId}:${registerId}`;

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
        if (!normalized.some((option) => option.value === selected)) {
          const [nextOutlet, nextRegister] = normalized[0]!.value.split(":");
          setLocation(nextOutlet!, nextRegister!);
        }
      })
      .catch(() => {
        setOptions(fallbackOptions);
        if (selected !== fallbackOptions[0]!.value) {
          setLocation("demo-store", "register-01");
        }
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
    };
  }, [fallbackOptions, selected, setLocation]);

  return (
    <label
      className="hidden items-center gap-2 rounded border border-[#D9D9D9] bg-white px-3 h-8 text-[13px] md:flex"
      aria-busy={loading}
    >
      <StoreIcon />
      <span className="sr-only">Current store</span>
      <select
        className="bg-transparent text-[13px] font-medium text-[rgba(0,0,0,0.88)] outline-none"
        value={selected}
        onChange={(event) => {
          const [nextOutlet, nextRegister] = event.target.value.split(":");
          setLocation(nextOutlet!, nextRegister!);
        }}
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
        "inline-flex h-8 items-center gap-2 rounded border px-3 text-[13px] font-medium",
        isOffline
          ? "border-orange-200 bg-orange-50 text-orange-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      )}
    >
      {isOffline ? <OfflineIcon /> : <OnlineIcon />}
      <span className="hidden sm:inline">{isOffline ? "Offline" : "Online"}</span>
    </div>
  );
}

function UserContext({
  name,
  role,
  onLogout,
}: {
  name: string;
  role: string;
  onLogout?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLogout}
      title={onLogout ? "Sign out" : "Current user"}
      className="hidden h-8 items-center gap-2 rounded border border-[#D9D9D9] bg-white px-3 text-left transition-colors hover:border-brand-600 hover:bg-gray-50 sm:flex"
    >
      <UserIcon />
      <span className="min-w-0">
        <span className="block max-w-[9rem] truncate text-[13px] font-medium text-[rgba(0,0,0,0.88)]">
          {name}
        </span>
        <span className="block text-[11px] capitalize text-[rgba(0,0,0,0.45)]">{role}</span>
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
    case "workflows":
      return <WorkflowsIcon />;
    case "loyalty":
      return <LoyaltyIcon />;
    case "gift-cards":
      return <GiftCardIcon />;
    case "quotes":
      return <QuotesIcon />;
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
    case "notifications":
      return <NotificationsIcon />;
    case "audit-log":
      return <AuditLogIcon />;
    case "service-orders":
      return <ServiceOrdersIcon />;
    case "invoicing":
      return <InvoicingIcon />;
    case "inventory-locations":
      return <StoreMapIcon />;
    case "inventory-expiry":
      return <ExpiryIcon />;
    case "inventory-serials":
      return <SerialsIcon />;
    case "inventory-reorder":
      return <ReorderIcon />;
    case "inventory-counts":
      return <CycleCountIcon />;
    case "workforce":
      return <WorkforceIcon />;
    default:
      return <ReportsIcon />;
  }
}

function activeLabel(active: NavKey) {
  return ALL_NAV_ITEMS.find((item) => item.key === MODULE_BY_ACTIVE[active])?.label ?? "Workspace";
}

function ChevronRight() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[rgba(0,0,0,0.25)]">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
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

function QuotesIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M12 18v-4" />
      <path d="M9.5 15.5 12 18l2.5-2.5" />
      <path d="M9 12h6" />
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

function WorkflowsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5"  cy="6"  r="2" />
      <circle cx="19" cy="6"  r="2" />
      <circle cx="5"  cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h10" />
      <path d="M7 18h10" />
      <path d="M5 8v8" />
      <path d="M19 8v8" />
    </svg>
  );
}

function LoyaltyIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function NotificationsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function AuditLogIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function ServiceOrdersIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function InvoicingIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function StoreMapIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}

function ExpiryIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function SerialsIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10v4" />
      <path d="M9 10v4" />
      <path d="M12 10v4" />
      <path d="M15 10v4" />
      <path d="M18 10v4" />
    </svg>
  );
}

function ReorderIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18" />
      <path d="M3 6h18" />
      <path d="M9 18h12" />
      <path d="M3 18l3-3 3 3" />
    </svg>
  );
}

function CycleCountIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function WorkforceIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
