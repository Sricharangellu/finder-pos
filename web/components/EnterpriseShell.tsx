"use client";

/**
 * EnterpriseShell — retail operations frame.
 *
 * Layout per reference spec:
 *   - Fixed top bar 48px  dark #1a1a1a  (☰ Menu | Search ⌘/ | Help · Bell · User)
 *   - Fixed left rail 52px dark #1a1a1a  (9 icon sections, icon-only)
 *   - "Sell" rail icon → fly-out panel with register context + sub-items
 *   - Content area: top-12 ml-[52px], bg #F5F5F5
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";
import { useFinderContext } from "@/lib/useFinderContext";
import { useModuleFlags } from "@/hooks/useModuleFlags";

// ── NavKey type (kept for backward compat — all pages pass active="...") ──────

export type NavKey =
  | "dashboard" | "register" | "inventory" | "purchasing" | "customers"
  | "orders" | "sales" | "accounting" | "shipping" | "discounts" | "ecommerce"
  | "reports" | "settings" | "operations" | "team" | "insights" | "finance"
  | "catalog" | "gift-cards" | "vendors" | "payments" | "returns"
  | "tax-compliance" | "integrations" | "imports-exports" | "workflows"
  | "quotes" | "loyalty" | "notifications" | "audit-log" | "service-orders"
  | "inventory-locations" | "inventory-expiry" | "invoicing" | "inventory-serials"
  | "inventory-reorder" | "inventory-counts" | "workforce" | "appointments"
  | "healthcare" | "automotive" | "hospitality" | "manufacturing" | "rental"
  | "entertainment" | "education" | "module-marketplace" | "kitchen" | "bar-tabs"
  | "golf" | "golf-bookings" | "golf-members" | "golf-pro-shop";

// ── Section mapping: NavKey → which rail icon is highlighted ──────────────────

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
  loyalty: "catalog", promotions: "catalog",
  inventory: "inventory", operations: "inventory", purchasing: "inventory",
  vendors: "inventory", shipping: "inventory", "inventory-locations": "inventory",
  "inventory-expiry": "inventory", "inventory-serials": "inventory",
  "inventory-reorder": "inventory", "inventory-counts": "inventory", workforce: "inventory",
  customers: "customers", appointments: "customers", healthcare: "customers",
  finance: "finance", accounting: "finance", invoicing: "finance",
  settings: "setup", team: "setup", workflows: "setup", integrations: "setup",
  notifications: "setup", "audit-log": "setup", "imports-exports": "setup",
  "module-marketplace": "setup",
  automotive: "setup", hospitality: "setup", manufacturing: "setup",
  rental: "setup", entertainment: "setup", education: "setup",
  kitchen: "sell", "bar-tabs": "sell",
  golf: "sell", "golf-bookings": "sell", "golf-members": "sell", "golf-pro-shop": "sell",
} as Record<NavKey, RailSection>;

// Sell section fly-out sub-items
const SELL_SUBMENU = [
  { label: "Sell",             href: "/sell" },
  { label: "Open / Close",     href: "/sell#open-close" },
  { label: "Sales history",    href: "/sales" },
  { label: "Cash management",  href: "/sell#cash" },
  { label: "Status",           href: "/operations" },
  { label: "Settings",         href: "/setup" },
  { label: "Quotes",           href: "/quotes" },
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
  children,
  banner,
  contentClassName,
}: EnterpriseShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  return (
    <div className="flex min-h-screen flex-col bg-[#F5F5F5]">
      {/* Skip link */}
      <a href="#main-content" className="skip-link">Skip to content</a>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <TopBar onSearchClick={() => setPaletteOpen(true)} />

      {/* ── Body: sidebar + content ───────────────────────────────────────── */}
      <div className="flex flex-1 pt-12">
        <LeftRail active={active} />

        {/* Content area — sits right of the 52px rail */}
        <main
          id="main-content"
          className={[
            "flex flex-1 flex-col min-w-0 ml-[52px]",
            contentClassName ?? "overflow-y-auto",
          ].join(" ")}
        >
          {banner}
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({ onSearchClick }: { onSearchClick: () => void }) {
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
      {/* Left: hamburger + Menu label */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-white/70 hover:text-white transition-colors shrink-0"
        aria-label="Toggle menu"
      >
        <HamburgerIcon />
        <span className="text-sm font-medium hidden sm:block">Menu</span>
      </button>

      {/* Center: search */}
      <button
        type="button"
        onClick={onSearchClick}
        className="flex flex-1 max-w-2xl items-center gap-2 rounded border border-white/20 bg-white/10 px-3 h-8 text-[13px] text-white/50 hover:bg-white/15 hover:text-white/70 transition-colors mx-auto"
        aria-label="Open search (⌘/)"
      >
        <SearchIcon />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 text-[11px] text-white/40">⌘/</kbd>
      </button>

      {/* Right: offline pill + Help + Bell + User */}
      <div className="flex items-center gap-3 shrink-0">
        {isOffline && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white">
            Offline
          </span>
        )}
        <a href="/help" className="hidden sm:block text-sm text-white/60 hover:text-white transition-colors">
          Help
        </a>
        <NotificationBell />
        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
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
              <Link href="/setup" className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Account settings</Link>
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

// ── Left rail ─────────────────────────────────────────────────────────────────

function LeftRail({ active }: { active: NavKey }) {
  const pathname = usePathname();
  const { enabled: enabledModules } = useModuleFlags();
  const activeSection = SECTION_MAP[active] ?? "home";
  const [flyout, setFlyout] = useState<RailSection | null>(null);
  const railRef = useRef<HTMLElement>(null);

  // Close fly-out when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (railRef.current && !railRef.current.contains(e.target as Node)) {
        setFlyout(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { registerId } = useFinderContext();

  // Rail items — show/hide based on enabled modules
  const railItems: { section: RailSection; label: string; href?: string; icon: React.ReactNode }[] = [
    { section: "home",      label: "Home",      href: "/dashboard",  icon: <HomeIcon /> },
    { section: "sell",      label: "Sell",                           icon: <SellIcon /> },
    ...(enabledModules.has("ecommerce") || enabledModules.has("*")
      ? [{ section: "online" as RailSection, label: "Online", href: "/ecommerce", icon: <OnlineIcon /> }]
      : []),
    { section: "reporting", label: "Reporting", href: "/reporting",  icon: <ReportingIcon /> },
    { section: "catalog",   label: "Catalog",   href: "/catalog",    icon: <CatalogIcon /> },
    { section: "inventory", label: "Inventory", href: "/inventory",  icon: <InventoryIcon /> },
    { section: "customers", label: "Customers", href: "/customers",  icon: <CustomersIcon /> },
    { section: "finance",   label: "Finance",   href: "/finance",    icon: <FinanceIcon /> },
    { section: "setup",     label: "Setup",     href: "/setup",      icon: <SetupIcon /> },
  ];

  function handleRailClick(section: RailSection, href?: string) {
    if (section === "sell") {
      setFlyout((prev) => (prev === "sell" ? null : "sell"));
    } else {
      setFlyout(null);
      if (href) window.location.href = href;
    }
  }

  return (
    <>
      <nav
        ref={railRef}
        aria-label="Primary navigation"
        className="fixed left-0 top-12 bottom-0 z-40 flex w-[52px] flex-col items-center py-2 gap-0.5"
        style={{ backgroundColor: "var(--color-sidebar-bg)" }}
      >
        {railItems.map((item) => {
          const isActive = activeSection === item.section;
          const isFlyoutOpen = flyout === item.section;
          return (
            <button
              key={item.section}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? "true" : undefined}
              onClick={() => handleRailClick(item.section, item.href)}
              className="group relative flex w-10 h-10 items-center justify-center rounded-lg transition-colors"
              style={{
                backgroundColor: isActive || isFlyoutOpen
                  ? "var(--color-sidebar-active)"
                  : "transparent",
                color: isActive || isFlyoutOpen ? "#fff" : "rgba(255,255,255,0.5)",
              }}
              onMouseEnter={(e) => {
                if (!isActive && !isFlyoutOpen) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-sidebar-hover)";
                  (e.currentTarget as HTMLElement).style.color = "#fff";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive && !isFlyoutOpen) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.5)";
                }
              }}
            >
              {item.icon}
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-[52px] rounded bg-[#333] px-2 py-1 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50">
                {item.label}
              </span>
            </button>
          );
        })}

        {/* Spacer + expand (bottom) */}
        <div className="flex-1" />
        <button
          type="button"
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-white/40 hover:text-white transition-colors"
        >
          <ExpandIcon />
        </button>
      </nav>

      {/* ── Sell fly-out panel ──────────────────────────────────────────── */}
      {flyout === "sell" && (
        <div
          className="fixed left-[52px] top-12 bottom-0 z-30 w-56 flex flex-col shadow-2xl"
          style={{ backgroundColor: "var(--color-sidebar-flyout)" }}
        >
          {/* Register context header */}
          <div className="border-b border-white/10 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              {registerId ?? "Main Register"}
            </p>
            <div className="mt-0.5 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Main Outlet</p>
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/60 hover:text-white transition-colors"
              >
                Switch
              </button>
            </div>
          </div>

          {/* Sub-items */}
          <nav aria-label="Sell section" className="flex flex-col py-1">
            {SELL_SUBMENU.map((item) => {
              const isCurrentPage = pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setFlyout(null)}
                  className="flex items-center px-4 py-2.5 text-sm transition-colors"
                  style={{
                    backgroundColor: isCurrentPage ? "rgba(93,95,239,0.25)" : "transparent",
                    color: isCurrentPage ? "#fff" : "rgba(255,255,255,0.65)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrentPage) (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLElement).style.color = "#fff";
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrentPage) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                    (e.currentTarget as HTMLElement).style.color = isCurrentPage ? "#fff" : "rgba(255,255,255,0.65)";
                  }}
                >
                  {isCurrentPage && (
                    <span className="mr-2 h-1.5 w-1.5 rounded-full bg-[#5D5FEF]" />
                  )}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Click-away overlay when fly-out is open */}
      {flyout && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setFlyout(null)}
        />
      )}
    </>
  );
}

// ── Rail icons (24×24 SVG) ────────────────────────────────────────────────────

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function SellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
function OnlineIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function ReportingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}
function CatalogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}
function InventoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
function CustomersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function FinanceIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function SetupIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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
function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" />
    </svg>
  );
}
