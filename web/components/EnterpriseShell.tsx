"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";
import { useFinderContext } from "@/lib/useFinderContext";
import { useModuleFlags } from "@/hooks/useModuleFlags";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useCapabilities } from "@/contexts/CapabilitiesContext";

// ── NavKey ────────────────────────────────────────────────────────────────────

export type NavKey =
  | "dashboard" | "register" | "inventory" | "purchasing" | "customers"
  | "orders" | "sales" | "accounting" | "shipping" | "discounts" | "ecommerce"
  | "reports" | "settings" | "operations" | "team" | "insights" | "finance"
  | "catalog" | "gift-cards" | "vendors" | "payments" | "returns"
  | "tax-compliance" | "integrations" | "imports-exports" | "workflows"
  | "quotes" | "loyalty" | "notifications" | "audit-log" | "service-orders"
  | "inventory-locations" | "inventory-expiry" | "invoicing" | "inventory-serials"
  | "inventory-reorder" | "inventory-counts" | "inventory-pipeline" | "workforce" | "appointments"
  | "healthcare" | "automotive" | "hospitality" | "manufacturing" | "rental"
  | "entertainment" | "education" | "module-marketplace" | "kitchen" | "bar-tabs"
  | "golf" | "golf-bookings" | "golf-members" | "golf-pro-shop"
  | "restaurant-dashboard" | "restaurant-floor-plan" | "restaurant-tabs"
  | "permissions" | "modes" | "kiosk-settings" | "b2b-settings"
  | "warehouse" | "pricing" | "edi-imports" | "promotions" | "documents"
  | "inventory-errors" | "bills" | "delivery";

// ── Section / nav tree ────────────────────────────────────────────────────────

type RailSection =
  | "home" | "sell" | "online" | "reporting" | "catalog"
  | "inventory" | "customers" | "finance" | "setup";

const SECTION_MAP: Record<NavKey, RailSection> = {
  dashboard: "home",
  register: "sell", sales: "sell", orders: "sell", quotes: "sell",
  returns: "sell", payments: "sell", "service-orders": "sell",
  ecommerce: "online",
  reports: "reporting", insights: "reporting", "tax-compliance": "reporting",
  catalog: "catalog", discounts: "catalog", "gift-cards": "catalog",
  loyalty: "catalog", promotions: "catalog", pricing: "catalog",
  inventory: "inventory", operations: "inventory", purchasing: "inventory",
  "edi-imports": "inventory",
  vendors: "inventory", shipping: "inventory", "inventory-locations": "inventory",
  "inventory-expiry": "inventory", "inventory-serials": "inventory",
  "inventory-reorder": "inventory", "inventory-counts": "inventory", "inventory-pipeline": "inventory", "inventory-errors": "inventory", workforce: "inventory",
  warehouse: "inventory", delivery: "inventory",
  customers: "customers", appointments: "customers", healthcare: "customers",
  finance: "finance", accounting: "finance", invoicing: "finance", bills: "finance",
  settings: "setup", team: "setup", workflows: "setup", integrations: "setup",
  notifications: "setup", "audit-log": "setup", "imports-exports": "setup",
  "module-marketplace": "setup", documents: "setup",
  automotive: "setup", hospitality: "setup", manufacturing: "setup",
  rental: "setup", entertainment: "setup", education: "setup",
  kitchen: "sell", "bar-tabs": "sell",
  "restaurant-dashboard": "sell", "restaurant-floor-plan": "sell", "restaurant-tabs": "sell",
  golf: "sell", "golf-bookings": "sell", "golf-members": "sell", "golf-pro-shop": "sell",
  permissions: "setup", modes: "setup", "kiosk-settings": "setup", "b2b-settings": "setup",
} as Record<NavKey, RailSection>;

type NavChild = {
  label: string;
  href: string;
  featureGate?: string; // hide if user lacks this feature
  partial?: boolean;    // mock-backed / preview — hidden unless NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true
};

// Partial/preview pages are hidden from normal navigation in production. They
// exist in the tree (deep-linkable, developable) but only surface when the
// operator opts in. See AGENTS.md "Mock And Partial Rules".
const SHOW_PARTIAL_PAGES = process.env["NEXT_PUBLIC_SHOW_PARTIAL_PAGES"] === "true";

/**
 * Whether a nav child is visible — the four-layer gate (partial → tenant route
 * → user feature), pure and exported so it can be unit-tested without rendering
 * the whole shell. `routeEnabled`/`hasFeature` are injected (capabilities +
 * permissions layers); `showPartial` is the NEXT_PUBLIC_SHOW_PARTIAL_PAGES opt-in.
 */
export function isNavChildVisible(
  child: NavChild,
  deps: { showPartial: boolean; routeEnabled: (href: string) => boolean; hasFeature: (f: string) => boolean },
): boolean {
  if (child.partial && !deps.showPartial) return false;
  if (!deps.routeEnabled(child.href)) return false;
  if (child.featureGate && !deps.hasFeature(child.featureGate)) return false;
  return true;
}

type NavSection = {
  section: RailSection;
  label: string;
  href?: string;
  icon: React.ReactNode;
  children?: NavChild[];
  moduleGate?: string;  // only show if this module flag is enabled
  featureGate?: string; // hide if user lacks this feature (section-level)
};

const NAV_TREE: NavSection[] = [
  {
    section: "home",
    label: "Home",
    href: "/dashboard",
    icon: <HomeIcon />,
  },
  {
    section: "sell",
    label: "Sell",
    icon: <SellIcon />,
    children: [
      { label: "Register",       href: "/terminal",       featureGate: "register" },
      { label: "Sales",          href: "/sales",          featureGate: "sales" },
      { label: "Orders",         href: "/orders",         featureGate: "orders" },
      { label: "Quotes",         href: "/quotes",         featureGate: "quotes" },
      { label: "Returns",        href: "/returns",        featureGate: "returns" },
      { label: "Payments",       href: "/payments",       featureGate: "payments" },
      { label: "Service Orders", href: "/service-orders", featureGate: "service-orders" },
    ],
  },
  {
    section: "online",
    label: "Online",
    href: "/ecommerce",
    icon: <OnlineIcon />,
    moduleGate: "ecommerce",
    featureGate: "ecommerce",
  },
  {
    section: "reporting",
    label: "Reporting",
    icon: <ReportingIcon />,
    children: [
      { label: "Reports",        href: "/reports",        featureGate: "reports" },
      { label: "Insights",       href: "/insights",       featureGate: "insights" },
      { label: "Tax Compliance", href: "/tax-compliance", featureGate: "tax-compliance" },
    ],
  },
  {
    section: "catalog",
    label: "Catalog",
    icon: <CatalogIcon />,
    children: [
      { label: "Products",    href: "/catalog",             featureGate: "catalog" },
      { label: "Pricing",     href: "/pricing",             featureGate: "catalog", partial: true },
      { label: "Promotions",  href: "/catalog/promotions",  featureGate: "catalog", partial: true },
      { label: "Discounts",   href: "/discounts",           featureGate: "discounts" },
      { label: "Gift Cards",  href: "/gift-cards",          featureGate: "gift-cards" },
      { label: "Loyalty",     href: "/loyalty",             featureGate: "loyalty" },
    ],
  },
  {
    section: "inventory",
    label: "Inventory",
    icon: <InventoryIcon />,
    children: [
      { label: "Overview",      href: "/inventory",               featureGate: "inventory" },
      { label: "Pipeline",      href: "/inventory/pipeline",      featureGate: "inventory" },
      { label: "Receive Stock", href: "/inventory/receive-stock", featureGate: "inventory" },
      { label: "Warehouse",     href: "/warehouse",               featureGate: "inventory", partial: true },
      { label: "Delivery",      href: "/delivery",                featureGate: "shipping" },
      { label: "Purchasing",    href: "/purchasing",              featureGate: "purchasing" },
      { label: "EDI Imports",   href: "/purchasing/edi-imports",  featureGate: "purchasing" },
      { label: "Error Center",  href: "/inventory/errors",        featureGate: "inventory" },
      { label: "Vendors",       href: "/vendors",                 featureGate: "vendors" },
      { label: "Operations",    href: "/operations",              featureGate: "operations" },
    ],
  },
  {
    section: "customers",
    label: "Customers",
    icon: <CustomersIcon />,
    children: [
      { label: "Customers",    href: "/customers",    featureGate: "customers" },
      { label: "Appointments", href: "/appointments", featureGate: "appointments" },
    ],
  },
  {
    section: "finance",
    label: "Finance",
    icon: <FinanceIcon />,
    children: [
      { label: "Overview",   href: "/finance",    featureGate: "finance" },
      { label: "Accounting", href: "/accounting", featureGate: "accounting" },
      { label: "Bills",      href: "/bills",      featureGate: "accounting" },
      { label: "Invoicing",  href: "/invoicing",  featureGate: "invoicing" },
    ],
  },
  {
    section: "setup",
    label: "Setup",
    icon: <SetupIcon />,
    children: [
      { label: "Settings",        href: "/settings",             featureGate: "settings" },
      { label: "Permissions",     href: "/settings/permissions", featureGate: "settings" },
      { label: "Business Modes",  href: "/settings/modes",       featureGate: "settings" },
      { label: "Kiosk Mode",      href: "/settings/kiosk",       featureGate: "settings" },
      { label: "B2B Portal",      href: "/settings/b2b",         featureGate: "settings" },
      { label: "Team",            href: "/team",                 featureGate: "team" },
      { label: "Workflows",       href: "/workflows",            featureGate: "workflows" },
      { label: "Integrations",    href: "/integrations",         featureGate: "integrations" },
      { label: "Imports/Exports", href: "/imports-exports",      featureGate: "imports-exports" },
      { label: "Document Center", href: "/documents",            featureGate: "documents", partial: true },
      { label: "Audit Log",       href: "/audit-log",            featureGate: "audit-log" },
    ],
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface EnterpriseShellProps {
  active: NavKey;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  banner?: React.ReactNode;
  contentClassName?: string;
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function EnterpriseShell({
  active,
  title,
  children,
  banner,
  contentClassName,
}: EnterpriseShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "/")) {
      e.preventDefault();
      setPaletteOpen((o) => !o);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [handleGlobalKey]);

  const sidebarW = sidebarExpanded ? 220 : 52;

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F5]">
      <a href="#main-content" className="skip-link">Skip to content</a>

      <TopBar
        onSearchClick={() => setPaletteOpen(true)}
        onMenuToggle={() => setSidebarExpanded((e) => !e)}
      />

      <div className="flex flex-1 pt-12">
        <LeftRail
          active={active}
          expanded={sidebarExpanded}
          onCollapseToggle={() => setSidebarExpanded((e) => !e)}
        />

        <main
          id="main-content"
          className={[
            "flex flex-1 flex-col min-w-0 transition-[margin-left] duration-200 ease-in-out",
            contentClassName ?? "overflow-y-auto",
          ].join(" ")}
          style={{ marginLeft: sidebarW }}
        >
          {/* Visually hidden page heading — gives every page an accessible
              h1 (screen readers, tests) without altering the visual design. */}
          <h1 className="sr-only">{title}</h1>
          {banner}
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({
  onSearchClick,
  onMenuToggle,
}: {
  onSearchClick: () => void;
  onMenuToggle: () => void;
}) {
  const { user, logout } = useAuth();
  const { isOffline } = useOffline();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex h-12 items-center gap-3 px-3"
      style={{ backgroundColor: "var(--color-topbar-bg)" }}
    >
      {/* Hamburger — toggles sidebar */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors shrink-0"
        aria-label="Toggle sidebar"
      >
        <HamburgerIcon />
      </button>

      {/* Search */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex flex-1 max-w-2xl items-center gap-2 rounded border border-white/20 bg-white/10 px-3 h-8 text-[13px] text-white/50 hover:bg-white/15 hover:text-white/70 transition-colors mx-auto"
        aria-label="Open search (⌘/)"
      >
        <SearchIcon />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[11px] text-white/40">
          ⌘/
        </kbd>
      </button>

      {/* Right controls */}
      <div className="flex items-center gap-3 shrink-0">
        {isOffline && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
            Offline
          </span>
        )}
        <a
          href="/help"
          className="hidden sm:block text-sm text-white/60 hover:text-white transition-colors"
        >
          Help
        </a>
        <NotificationBell />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="User menu"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5D5FEF] text-[11px] font-bold text-white">
              {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
            </div>
            <span className="hidden sm:block max-w-[120px] truncate">{user?.name ?? "User"}</span>
            <ChevronDown />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-9 z-50 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="text-xs font-semibold text-slate-900 truncate">{user?.name}</p>
                <p className="text-xs text-slate-500 truncate">{user?.email}</p>
              </div>
              <Link
                href="/setup"
                className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Account settings
              </Link>
              <button
                type="button"
                onClick={() => void logout()}
                className="block w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Left rail / sidebar ───────────────────────────────────────────────────────

function LeftRail({
  active,
  expanded,
  onCollapseToggle,
}: {
  active: NavKey;
  expanded: boolean;
  onCollapseToggle: () => void;
}) {
  const pathname = usePathname();
  const { enabled: enabledModules } = useModuleFlags();
  const { hasFeature, error: permissionsError } = usePermissions();
  const { routeEnabled } = useCapabilities();
  const activeSection = SECTION_MAP[active] ?? "home";
  const { registerId } = useFinderContext();

  // Track which sections are open (expanded sub-items)
  const [openSections, setOpenSections] = useState<Set<RailSection>>(
    new Set([activeSection])
  );

  // When active section changes, auto-open it
  useEffect(() => {
    setOpenSections((prev) => new Set([...prev, activeSection]));
  }, [activeSection]);

  const toggleSection = (section: RailSection) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // Filter nav items — four-layer check, tenant layer first:
  //   0. partial/preview gate (mock-backed pages hidden unless the operator opts in)
  //   1. tenant module gate (explicit moduleGate key)
  //   2. tenant route gate (href owned by a capabilities module that is disabled)
  //   3. user feature gate (permissions)
  const childVisible = (c: NavChild) =>
    isNavChildVisible(c, { showPartial: SHOW_PARTIAL_PAGES, routeEnabled, hasFeature });
  const navItems = NAV_TREE.filter((item) => {
    if (item.moduleGate && !enabledModules.has(item.moduleGate) && !enabledModules.has("*")) return false;
    if (item.href && !routeEnabled(item.href)) return false;
    if (item.featureGate && !hasFeature(item.featureGate)) return false;
    // For sections with children, hide if ALL children are gated away
    if (item.children) {
      const visible = item.children.filter(childVisible);
      if (visible.length === 0) return false;
    }
    return true;
  });

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed left-0 top-12 bottom-0 z-40 flex flex-col overflow-hidden transition-[width] duration-200 ease-in-out"
      style={{
        width: expanded ? 220 : 52,
        backgroundColor: "var(--color-sidebar-bg)",
      }}
    >
      {/* ── Nav items ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 scrollbar-hide">
        {/* Permissions could not load → fail closed. Tell the operator that
            privileged items are hidden rather than silently dropping them. */}
        {permissionsError && expanded && (
          <div
            role="alert"
            className="mx-2 mb-2 rounded-md bg-amber-500/15 px-3 py-2 text-xs leading-snug text-amber-100"
          >
            Permissions couldn’t load. Some features are hidden until access is restored — refresh to retry.
          </div>
        )}
        {navItems.map((item) => {
          const isActive = activeSection === item.section;
          const hasChildren = !!(item.children && item.children.length > 0);
          const isOpen = openSections.has(item.section);

          return (
            <div key={item.section}>
              {/* Section header button */}
              {hasChildren || !item.href ? (
                <button
                  type="button"
                  title={expanded ? undefined : item.label}
                  aria-label={item.label}
                  aria-expanded={hasChildren ? isOpen : undefined}
                  onClick={() => {
                    if (hasChildren) toggleSection(item.section);
                    else if (item.href) window.location.href = item.href;
                  }}
                  className={`group relative flex w-full items-center gap-3 px-3 py-2.5 transition-colors ${
                    isActive
                      ? "text-white"
                      : "text-white/55 hover:text-white"
                  }`}
                  style={{
                    backgroundColor: isActive && !expanded
                      ? "var(--color-sidebar-active)"
                      : "transparent",
                  }}
                >
                  {/* Active indicator (expanded mode) */}
                  {expanded && isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-[#5D5FEF]" />
                  )}

                  {/* Icon */}
                  <span className="shrink-0">{item.icon}</span>

                  {/* Label + chevron — only when expanded */}
                  {expanded && (
                    <>
                      <span className="flex-1 truncate text-left text-sm font-medium">
                        {item.label}
                      </span>
                      {hasChildren && (
                        <ChevronSmall
                          className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                        />
                      )}
                    </>
                  )}

                  {/* Tooltip (collapsed only) */}
                  {!expanded && (
                    <span className="pointer-events-none absolute left-[52px] z-50 rounded bg-[#333] px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </button>
              ) : (
                <Link
                  href={item.href}
                  title={expanded ? undefined : item.label}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={`group relative flex w-full items-center gap-3 px-3 py-2.5 transition-colors ${
                    isActive ? "text-white" : "text-white/55 hover:text-white"
                  }`}
                  style={{
                    backgroundColor: isActive && !expanded
                      ? "var(--color-sidebar-active)"
                      : "transparent",
                  }}
                >
                  {expanded && isActive && (
                    <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r bg-[#5D5FEF]" />
                  )}
                  <span className="shrink-0">{item.icon}</span>
                  {expanded && (
                    <span className="flex-1 truncate text-left text-sm font-medium">
                      {item.label}
                    </span>
                  )}
                  {!expanded && (
                    <span className="pointer-events-none absolute left-[52px] z-50 rounded bg-[#333] px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {item.label}
                    </span>
                  )}
                </Link>
              )}

              {/* Sub-items — only in expanded mode */}
              {expanded && hasChildren && isOpen && item.children && (
                <div className="pb-1">
                  {/* Register context header for Sell section */}
                  {item.section === "sell" && (
                    <div className="mx-3 mb-1.5 mt-0.5 flex items-center justify-between rounded-md bg-white/5 px-2.5 py-1.5">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-white/35">
                          {registerId ?? "Main Register"}
                        </p>
                        <p className="text-xs font-medium text-white/70">Main Outlet</p>
                      </div>
                      <button
                        type="button"
                        className="text-[10px] font-medium text-white/40 hover:text-white/70 transition-colors"
                      >
                        Switch
                      </button>
                    </div>
                  )}

                  {item.children.filter(childVisible).map((child) => {
                    const isCurrent =
                      pathname === child.href ||
                      pathname.startsWith(child.href + "/");
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2 py-1.5 pl-[46px] pr-3 text-xs transition-colors ${
                          isCurrent
                            ? "font-semibold text-white"
                            : "font-normal text-white/50 hover:text-white/80"
                        }`}
                      >
                        {isCurrent && (
                          <span className="h-1 w-1 shrink-0 rounded-full bg-[#5D5FEF]" />
                        )}
                        <span className={isCurrent ? "" : "ml-3"}>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Bottom: collapse toggle ───────────────────────────────────── */}
      <div className="border-t border-white/10 p-2">
        <button
          type="button"
          onClick={onCollapseToggle}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
        >
          <CollapseIcon flipped={expanded} />
          {expanded && (
            <span className="text-xs font-medium">Collapse</span>
          )}
        </button>
      </div>
    </nav>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function SellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function OnlineIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function ReportingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function CatalogIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function InventoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function CustomersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function FinanceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function SetupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronSmall({ className }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CollapseIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={`transition-transform duration-200 ${flipped ? "" : "rotate-180"}`}
    >
      <polyline points="11 17 6 12 11 7" />
      <polyline points="18 17 13 12 18 7" />
    </svg>
  );
}
