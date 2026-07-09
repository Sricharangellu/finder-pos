/**
 * Ascend Module Registry — defines every optional module across all 12
 * business verticals. One platform, unlocked by business type.
 *
 * Verticals: Retail, Wholesale/B2B, Restaurant, Hospitality, Services,
 *            Healthcare, Manufacturing, E-Commerce, Automotive, Rental,
 *            Entertainment, Education
 *
 * Architecture: modules are gated by feature flags (key = `module:<name>`).
 * GET/POST /api/v1/settings/business-profile reads/writes these flags.
 */

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  route?: string;
  group: ModuleGroup;
  /** Always enabled — cannot be turned off. */
  core?: boolean;
}

export type ModuleGroup =
  | "common"
  | "retail"
  | "restaurant"
  | "b2b"
  | "hospitality"
  | "services"
  | "healthcare"
  | "manufacturing"
  | "ecommerce"
  | "automotive"
  | "rental"
  | "entertainment"
  | "education"
  | "golf"
  | "enterprise";

/** All modules available in Ascend — 12 verticals + enterprise add-ons. */
export const MODULE_REGISTRY: ModuleDefinition[] = [

  // ── Core (always on — not user-selectable) ──────────────────────────────

  { key: "catalog",      name: "Products & Catalog",   description: "Products, categories, variants, barcodes, price book",      group: "common",  core: true },
  { key: "inventory",    name: "Inventory",             description: "Stock tracking, receiving, adjustments, FEFO lots",          group: "common",  core: true },
  { key: "customers",    name: "Customers / CRM",       description: "Customer profiles, history, addresses, store credit",        group: "common",  core: true },
  { key: "payments",     name: "Payments",              description: "Cash, card, split tender, store credit, Stripe Terminal",    group: "common",  core: true },
  { key: "reports",      name: "Reports & Analytics",   description: "Sales, inventory, purchasing, payroll, time-card reports",   group: "common",  core: true },
  { key: "settings",     name: "Settings & Setup",      description: "Business profile, taxes, shipping, outlets, security",       group: "common",  core: true },
  { key: "team",         name: "Team & Users",          description: "Employees, roles, permissions, time clock, scheduling",      group: "common",  core: true },
  { key: "notifications", name: "Notifications",        description: "Low-stock alerts, overdue invoices, system notifications",  group: "common",  core: true },

  // ── Retail ──────────────────────────────────────────────────────────────

  { key: "pos_terminal",   name: "POS Terminal",          description: "Touch-screen register, barcode scanner, receipts, numpad",    group: "retail",  route: "/terminal" },
  { key: "discounts",      name: "Discounts & Promotions",description: "Coupons, BXGY, volume pricing, auto-applicable rules",        group: "retail",  route: "/discounts" },
  { key: "loyalty",        name: "Loyalty Programme",     description: "Points, tiers, rewards, automatic tier upgrades",             group: "retail",  route: "/loyalty" },
  { key: "gift_cards",     name: "Gift Cards",            description: "Issue, redeem, and track gift card balances",                 group: "retail",  route: "/gift-cards" },
  { key: "compliance",     name: "Compliance",            description: "Age verification, MSA/PACT reporting, state flavor bans",     group: "retail" },
  { key: "ecommerce",      name: "Ecommerce",             description: "Online store sync, product visibility, online orders",         group: "retail",  route: "/ecommerce" },
  { key: "customer_display", name: "Customer Display",    description: "Second-screen cart mirror for customer-facing display",       group: "retail",  route: "/display" },

  // ── B2B / Wholesale ────────────────────────────────────────────────────

  { key: "sales_orders",   name: "Sales Orders",          description: "B2B orders, credit terms, fulfilment workflows",              group: "b2b",     route: "/sales" },
  { key: "purchasing",     name: "Purchasing",            description: "Purchase orders, receiving, vendor management, returns",      group: "b2b",     route: "/purchasing" },
  { key: "billing",        name: "Billing — AP/AR",       description: "Supplier bills, customer invoices, aging reports",            group: "b2b",     route: "/finance" },
  { key: "accounting",     name: "Accounting",            description: "Chart of accounts, journal entries, batch deposits, P&L",     group: "b2b",     route: "/accounting" },
  { key: "price_book",     name: "Price Book",            description: "Customer-specific prices, outlet-specific overrides",          group: "b2b",     route: "/catalog/price-book" },
  { key: "quotes",         name: "Quotes / Quotations",   description: "Create, send, and convert sales quotes to orders",            group: "b2b",     route: "/quotes" },

  // ── Restaurant & Food Service ──────────────────────────────────────────

  { key: "tables",         name: "Table Management",      description: "Floor plan, table sessions, party size, server assignment",   group: "restaurant", route: "/restaurant/floor-plan" },
  { key: "kitchen",        name: "Kitchen Display (KDS)", description: "Kitchen tablet view, course ordering, bump when ready",      group: "restaurant", route: "/restaurant/kitchen" },
  { key: "bar_tabs",       name: "Bar Tabs",              description: "Open tabs, multi-round ordering, tab closing",               group: "restaurant", route: "/restaurant/tabs" },
  { key: "reservations",   name: "Reservations",          description: "Booking slots, waitlist, guest notes, confirmation emails",  group: "restaurant", route: "/restaurant/reservations" },
  { key: "menu_modifiers", name: "Menu Modifiers",        description: "Add-ons, substitutions, cooking instructions per line",      group: "restaurant" },

  // ── Hospitality ────────────────────────────────────────────────────────

  { key: "room_billing",   name: "Room Billing",          description: "Post charges to guest room accounts, room service",          group: "hospitality", route: "/hospitality/rooms" },
  { key: "guest_accounts", name: "Guest Accounts",        description: "Open guest folios, split charges, check-out settlement",     group: "hospitality", route: "/hospitality/guests" },
  { key: "spa_services",   name: "Spa & Services",        description: "Appointment booking, service packages, therapist assignment", group: "hospitality" },
  { key: "event_mgmt",     name: "Event Management",      description: "Banquets, conference rooms, AV packages, catering billing",  group: "hospitality", route: "/hospitality/events" },

  // ── Services ───────────────────────────────────────────────────────────

  { key: "appointments",   name: "Appointments",          description: "Online/walk-in booking, technician scheduling, reminders",   group: "services",  route: "/appointments" },
  { key: "service_orders", name: "Service Orders",        description: "Repair tickets, job tracking, status updates, parts used",  group: "services",  route: "/service-orders" },
  { key: "memberships",    name: "Membership Plans",      description: "Recurring memberships, access control, member pricing",     group: "services",  route: "/memberships" },
  { key: "staff_commission", name: "Staff Commission",    description: "Commission tracking per service, technician payouts",       group: "services" },

  // ── Healthcare ─────────────────────────────────────────────────────────

  { key: "prescriptions",  name: "Prescriptions",         description: "Prescription tracking, controlled substances, refill history", group: "healthcare", route: "/healthcare/prescriptions" },
  { key: "patient_records", name: "Patient Records",      description: "Patient profiles, visit history, allergy flags",             group: "healthcare", route: "/healthcare/patients" },
  { key: "insurance",      name: "Insurance Billing",     description: "Insurance claim codes, co-pay tracking, insurer billing",   group: "healthcare" },
  { key: "expiry_tracking", name: "Expiry Tracking",      description: "Medicine/lot expiry alerts, FEFO dispensing, near-expiry",  group: "healthcare" },

  // ── Manufacturing ─────────────────────────────────────────────────────

  { key: "production_orders", name: "Production Orders",  description: "BOM-based production orders, raw material consumption",     group: "manufacturing", route: "/manufacturing/orders" },
  { key: "raw_materials",  name: "Raw Materials",         description: "Raw material inventory, min levels, reorder automation",    group: "manufacturing" },
  { key: "batch_mgmt",     name: "Batch Management",      description: "Batch/lot tracking from production to sale, traceability",  group: "manufacturing" },
  { key: "quality_control", name: "Quality Control",      description: "Inspection checkpoints, pass/fail logging, hold orders",   group: "manufacturing" },

  // ── E-Commerce & Omnichannel ───────────────────────────────────────────

  { key: "online_store",   name: "Online Store",          description: "Product visibility, SEO fields, meta title/description",   group: "ecommerce",  route: "/ecommerce/products" },
  { key: "order_fulfillment", name: "Order Fulfillment",  description: "Pick-pack-ship for online orders, tracking integration",   group: "ecommerce",  route: "/inventory/receive-stock" },
  { key: "marketplace",    name: "Marketplace Sync",      description: "Sync inventory/orders with Amazon, eBay, Shopify, etc.",   group: "ecommerce" },
  { key: "shipping_mgmt",  name: "Shipping Management",   description: "Carrier integrations, label printing, tracking numbers",   group: "ecommerce",  route: "/shipping" },

  // ── Automotive ────────────────────────────────────────────────────────

  { key: "vehicle_history", name: "Vehicle History",      description: "VIN/license lookup, service history per vehicle, notes",   group: "automotive", route: "/automotive/vehicles" },
  { key: "parts_inventory", name: "Parts Inventory",      description: "Auto parts with OEM/aftermarket codes, supplier ordering",  group: "automotive" },
  { key: "work_orders",    name: "Work Orders",           description: "Job cards, technician assignment, time tracking, parts",   group: "automotive", route: "/automotive/work-orders" },
  { key: "inspection",     name: "Vehicle Inspection",    description: "Pre/post service inspection checklists, digital sign-off", group: "automotive" },

  // ── Rental ────────────────────────────────────────────────────────────

  { key: "rental_contracts", name: "Rental Contracts",   description: "Rental agreements, duration, return schedule, late fees",   group: "rental", route: "/rental/contracts" },
  { key: "deposits",       name: "Security Deposits",    description: "Deposit collection, refund on return, damage deduction",   group: "rental" },
  { key: "asset_tracking", name: "Asset Tracking",       description: "Track each rental unit by serial, location, condition",   group: "rental", route: "/rental/assets" },
  { key: "damage_mgmt",    name: "Damage Management",    description: "Damage assessment on return, repair cost billing",        group: "rental" },

  // ── Entertainment ─────────────────────────────────────────────────────

  { key: "tickets",        name: "Ticket Sales",          description: "Event/session tickets, seat selection, QR code tickets",   group: "entertainment", route: "/entertainment/tickets" },
  { key: "access_control", name: "Access Control",        description: "QR/barcode scan at entry, capacity management, passes",   group: "entertainment" },
  { key: "concessions",    name: "Concessions",           description: "Food/beverage at events, portable POS, fast checkout",    group: "entertainment" },
  { key: "season_passes",  name: "Season Passes",         description: "Annual/season pass sales, member lookup, visit tracking", group: "entertainment" },

  // ── Education ─────────────────────────────────────────────────────────

  { key: "fee_collection", name: "Fee Collection",        description: "Tuition billing, instalment plans, payment receipts",     group: "education", route: "/education/fees" },
  { key: "student_accounts", name: "Student Accounts",   description: "Student profiles, academic year, outstanding balances",    group: "education", route: "/education/students" },
  { key: "course_enrollment", name: "Course Enrollment",  description: "Course catalogue, enrollment, capacity, waiting lists",  group: "education", route: "/education/courses" },
  { key: "attendance",     name: "Attendance",            description: "Class attendance tracking, absence alerts, reports",      group: "education" },

  // ── Golf ──────────────────────────────────────────────────────────────

  { key: "tee_sheet",      name: "Tee Sheet",             description: "Tee time booking, slot management, cart assignment",      group: "golf", route: "/golf/tee-sheet" },
  { key: "golf_bookings",  name: "Golf Bookings",         description: "Reservations, group bookings, cancellations, deposits",   group: "golf", route: "/golf/bookings" },
  { key: "golf_members",   name: "Golf Memberships",      description: "Season passes, member tiers, handicap tracking",          group: "golf", route: "/golf/members" },
  { key: "pro_shop",       name: "Pro Shop",              description: "Retail sales within the golf context (clubs, apparel)",   group: "golf" },

  // ── Enterprise Add-ons ────────────────────────────────────────────────

  { key: "workforce",      name: "Workforce & Payroll",   description: "Scheduling, time-off requests, commission, payroll prep",  group: "enterprise", route: "/workforce" },
  { key: "wms",            name: "Warehouse Management",  description: "Multi-location stock, bin locations, pick-pack routing",  group: "enterprise", route: "/operations" },
  { key: "webhooks",       name: "Webhooks & Public API", description: "Outbound webhooks, API keys for third-party integrations", group: "enterprise" },
  { key: "sso",            name: "Single Sign-On",        description: "OIDC/SAML SSO for enterprise identity providers",         group: "enterprise" },
  { key: "multi_currency", name: "Multi-Currency",        description: "Accept and report in multiple currencies with FX rates",  group: "enterprise" },
  { key: "advanced_analytics", name: "Advanced Analytics", description: "BI dashboards, custom reports, data export, forecasting", group: "enterprise" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Business type bundles — curated module sets per vertical
// ─────────────────────────────────────────────────────────────────────────────

export const BUSINESS_BUNDLES: Record<string, {
  name: string;
  description: string;
  icon: string;
  modules: string[];
}> = {
  retail: {
    name: "Retail",
    icon: "🏪",
    description: "Convenience stores, supermarkets, fashion, electronics, pet, hardware, pharmacies",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","discounts","loyalty","gift_cards","compliance","customer_display"],
  },
  restaurant: {
    name: "Restaurant & F&B",
    icon: "🍽️",
    description: "Restaurants, cafes, bars, fast food, food trucks, bakeries, coffee shops",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","tables","kitchen","bar_tabs","reservations","menu_modifiers"],
  },
  wholesale: {
    name: "B2B / Wholesale",
    icon: "📦",
    description: "Distributors, wholesalers, B2B suppliers, FMCG, food & beverage distribution",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "sales_orders","purchasing","billing","accounting","price_book","quotes"],
  },
  hospitality: {
    name: "Hospitality",
    icon: "🏨",
    description: "Hotels, resorts, motels, guest houses, boutique properties",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","room_billing","guest_accounts","spa_services","event_mgmt"],
  },
  services: {
    name: "Services",
    icon: "✂️",
    description: "Salons, spas, car wash, repair shops, tailoring, laundry, beauty studios",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","appointments","service_orders","memberships","loyalty","staff_commission"],
  },
  healthcare: {
    name: "Healthcare & Pharmacy",
    icon: "🏥",
    description: "Pharmacies, clinics, medical stores, diagnostic labs, optical stores",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","prescriptions","patient_records","insurance","expiry_tracking","compliance"],
  },
  manufacturing: {
    name: "Manufacturing",
    icon: "🏭",
    description: "Factory outlets, manufacturers, direct-to-consumer brands",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "purchasing","billing","accounting","production_orders","raw_materials","batch_mgmt","quality_control"],
  },
  ecommerce: {
    name: "E-Commerce & Omnichannel",
    icon: "🛒",
    description: "Online stores, marketplace sellers, D2C brands, click-and-collect",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","ecommerce","online_store","order_fulfillment","marketplace","shipping_mgmt","loyalty"],
  },
  automotive: {
    name: "Automotive",
    icon: "🚗",
    description: "Auto parts stores, tire shops, vehicle workshops, service centers",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","vehicle_history","parts_inventory","work_orders","inspection","service_orders"],
  },
  rental: {
    name: "Rental",
    icon: "🔑",
    description: "Equipment rentals, vehicle rentals, event equipment, tool hire",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","rental_contracts","deposits","asset_tracking","damage_mgmt"],
  },
  entertainment: {
    name: "Entertainment",
    icon: "🎭",
    description: "Cinemas, theme parks, museums, gaming centers, sports venues",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","tickets","access_control","concessions","season_passes","memberships"],
  },
  education: {
    name: "Education",
    icon: "🎓",
    description: "Training institutes, coaching centers, private schools, universities",
    modules: ["catalog","customers","payments","reports","settings","team","notifications",
              "fee_collection","student_accounts","course_enrollment","attendance","memberships"],
  },
  golf: {
    name: "Golf",
    icon: "⛳",
    description: "Golf courses, driving ranges, pro shops, golf resorts",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","tee_sheet","golf_bookings","golf_members","pro_shop","loyalty"],
  },
  hybrid: {
    name: "Hybrid / Multi-Vertical",
    icon: "🔀",
    description: "Businesses spanning multiple verticals (e.g., hotel + restaurant + retail)",
    modules: ["catalog","inventory","customers","payments","reports","settings","team","notifications",
              "pos_terminal","sales_orders","purchasing","billing","discounts","loyalty","ecommerce"],
  },
  custom: {
    name: "Custom",
    icon: "⚙️",
    description: "Fully customised module selection — pick exactly what you need",
    modules: [],
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

/** Group display labels for the UI. */
export const GROUP_LABELS: Record<string, string> = {
  common:        "Core (always included)",
  retail:        "Retail",
  restaurant:    "Restaurant & Food Service",
  b2b:           "B2B / Wholesale",
  hospitality:   "Hospitality",
  services:      "Services & Repairs",
  healthcare:    "Healthcare & Pharmacy",
  manufacturing: "Manufacturing",
  ecommerce:     "E-Commerce & Omnichannel",
  automotive:    "Automotive",
  rental:        "Rental",
  entertainment: "Entertainment",
  education:     "Education",
  golf:          "Golf",
  enterprise:    "Enterprise Add-ons",
};
