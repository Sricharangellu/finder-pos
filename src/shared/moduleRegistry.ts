/**
 * FinderPOS Module Registry — defines every optional module, which business
 * bundles include it, and what feature-flag key gates it.
 *
 * Business types choose a base bundle on signup; individual modules can be
 * added/removed later by support (or self-served on Pro+ plans).
 *
 * Architecture: modules are gated by feature flags stored in the
 * `feature_flags` table (key = `module:<name>`). The settings module
 * exposes GET/POST /api/v1/settings/business-profile to read/write them.
 */

export interface ModuleDefinition {
  /** Machine key — used as the feature-flag key `module:<key>` */
  key: string;
  name: string;
  description: string;
  /** The nav route this module unlocks (for UI routing). */
  route?: string;
  /** Which group this belongs to (for display). */
  group: "common" | "retail" | "restaurant" | "b2b" | "golf" | "enterprise";
  /** Always enabled — cannot be turned off. */
  core?: boolean;
}

/** All modules available in FinderPOS. */
export const MODULE_REGISTRY: ModuleDefinition[] = [
  // ── Core (always on — not user-selectable) ─────────────────────────────────
  { key: "catalog",    name: "Products & Catalog",    description: "Product management, categories, variants, barcodes", group: "common", core: true },
  { key: "inventory",  name: "Inventory",             description: "Stock tracking, receiving, adjustments, FEFO lots",  group: "common", core: true },
  { key: "customers",  name: "Customers",             description: "CRM, contacts, addresses, store credit, loyalty",    group: "common", core: true },
  { key: "payments",   name: "Payments",              description: "Cash, card, split tender, store credit, Stripe",     group: "common", core: true },
  { key: "reports",    name: "Reports & Analytics",   description: "Sales, inventory, purchasing, time-cards reports",   group: "common", core: true },
  { key: "settings",   name: "Settings",              description: "Business profile, taxes, shipping, users, security", group: "common", core: true },
  { key: "team",       name: "Team & Users",          description: "Employees, roles, permissions, time clock",         group: "common", core: true },

  // ── Retail bundle ─────────────────────────────────────────────────────────
  { key: "pos_terminal", name: "POS Terminal",        description: "Touch-screen register, barcode scanner, receipts",  group: "retail", route: "/terminal" },
  { key: "discounts",    name: "Discounts",           description: "Coupons, promotions, volume pricing, BXGY rules",   group: "retail", route: "/discounts" },
  { key: "loyalty",      name: "Loyalty Programme",  description: "Points, tiers, rewards, automatic upgrades",         group: "retail", route: "/loyalty" },
  { key: "gift_cards",   name: "Gift Cards",          description: "Issue, redeem, and report on gift card balances",    group: "retail", route: "/gift-cards" },
  { key: "ecommerce",    name: "Ecommerce",           description: "Online store, product sync, online orders",          group: "retail", route: "/ecommerce" },
  { key: "compliance",   name: "Compliance",          description: "Age verification, MSA reporting, flavor bans",       group: "retail" },
  { key: "service_orders", name: "Service Orders",   description: "Repair tickets, job tracking (bike, electronics)",   group: "retail", route: "/service-orders" },

  // ── B2B / Wholesale bundle ─────────────────────────────────────────────────
  { key: "sales_orders", name: "Sales Orders",       description: "B2B orders, credit terms, fulfilment workflows",     group: "b2b",    route: "/sales" },
  { key: "purchasing",   name: "Purchasing",         description: "Purchase orders, receiving, vendor management",       group: "b2b",    route: "/purchasing" },
  { key: "billing",      name: "Billing (AP/AR)",    description: "Supplier bills, customer invoices, aging reports",    group: "b2b",    route: "/finance" },
  { key: "accounting",   name: "Accounting",         description: "Chart of accounts, journal entries, batch deposits",  group: "b2b",    route: "/accounting" },
  { key: "price_book",   name: "Price Book",         description: "Customer-specific prices, outlet overrides",          group: "b2b",    route: "/catalog/price-book" },

  // ── Restaurant bundle ─────────────────────────────────────────────────────
  { key: "tables",       name: "Table Management",   description: "Floor plan, table sessions, party tracking",          group: "restaurant", route: "/restaurant/floor-plan" },
  { key: "kitchen",      name: "Kitchen Display",    description: "KDS tablet view, course ordering, order bumping",     group: "restaurant", route: "/restaurant/kitchen" },
  { key: "bar_tabs",     name: "Bar Tabs",           description: "Open tabs, multi-round ordering, tab closing",        group: "restaurant", route: "/restaurant/tabs" },

  // ── Golf bundle ───────────────────────────────────────────────────────────
  { key: "tee_sheet",    name: "Tee Sheet",          description: "Tee time booking, slot management, cart assignment",  group: "golf", route: "/golf/tee-sheet" },
  { key: "bookings",     name: "Bookings",           description: "Reservations, waitlist, cancellations",               group: "golf", route: "/golf/bookings" },
  { key: "memberships",  name: "Memberships",        description: "Season passes, member tiers, handicap tracking",       group: "golf", route: "/golf/members" },

  // ── Enterprise (add-on) ───────────────────────────────────────────────────
  { key: "workforce",    name: "Workforce",          description: "Employee scheduling, shift management, time-off",     group: "enterprise", route: "/workforce" },
  { key: "webhooks",     name: "Webhooks & API",     description: "Outbound webhooks, API key access for integrations",  group: "enterprise" },
  { key: "sso",          name: "Single Sign-On",     description: "OIDC/SAML SSO for enterprise identity providers",     group: "enterprise" },
];

/** Pre-defined business type bundles. */
export const BUSINESS_BUNDLES: Record<string, { name: string; description: string; modules: string[] }> = {
  retail: {
    name: "Retail",
    description: "Convenience store, vape shop, liquor, apparel, electronics, pet, sporting goods",
    modules: ["catalog", "inventory", "customers", "payments", "reports", "settings", "team",
              "pos_terminal", "discounts", "loyalty", "gift_cards", "compliance"],
  },
  restaurant: {
    name: "Restaurant / F&B",
    description: "Cafe, bar, fine dining, quick service, hotel F&B",
    modules: ["catalog", "inventory", "customers", "payments", "reports", "settings", "team",
              "pos_terminal", "tables", "kitchen", "bar_tabs"],
  },
  wholesale: {
    name: "B2B / Wholesale",
    description: "Distributors, wholesalers, B2B sellers with credit terms",
    modules: ["catalog", "inventory", "customers", "payments", "reports", "settings", "team",
              "sales_orders", "purchasing", "billing", "accounting", "price_book"],
  },
  golf: {
    name: "Golf",
    description: "Golf courses, driving ranges, pro shops, resorts",
    modules: ["catalog", "inventory", "customers", "payments", "reports", "settings", "team",
              "pos_terminal", "tee_sheet", "bookings", "memberships"],
  },
  hybrid: {
    name: "Hybrid",
    description: "Multi-vertical business (retail + restaurant, retail + wholesale, etc.)",
    modules: ["catalog", "inventory", "customers", "payments", "reports", "settings", "team",
              "pos_terminal", "discounts", "loyalty", "sales_orders", "purchasing", "billing"],
  },
};

/** Core modules that are always enabled regardless of business type. */
export const CORE_MODULES = new Set(
  MODULE_REGISTRY.filter((m) => m.core).map((m) => m.key),
);

/** Feature flag key for a module. */
export function moduleFlag(key: string): string {
  return `module:${key}`;
}
