/**
 * MSW handlers for the Cycle-3 backend modules (customers, gift cards, webhooks,
 * inventory overview, team). Kept in a separate file so the backend agent can
 * add/maintain these without colliding with the frontend's edits to handlers.ts.
 * Wired into the main array via `...mockHandlers`.
 *
 * Shapes mirror the live API (see orchestration/BACKEND_HANDOFF.md).
 */
import { http, HttpResponse, delay } from "msw";

const V1 = "*/api/v1";
const lat = () => delay(Math.floor(Math.random() * 120) + 60);
const rid = () => `mock-${Math.random().toString(36).slice(2, 10)}`;

// ── In-memory dev stores ────────────────────────────────────────────────────

// Live stock levels shared between catalog and inventory handlers
// product_id → location_id → { on_hand, committed, avg_cost_cents }
const catalogStockLevels = new Map<string, Map<string, { on_hand: number; committed: number; avg_cost_cents: number | null }>>();

export const STOCK_LOCATIONS = [
  { id: "loc_1", code: "MAIN-FLR", name: "Main Floor" },
  { id: "loc_2", code: "WAREHOUSE", name: "Warehouse" },
];

// [main_floor_on_hand, warehouse_on_hand, main_floor_committed]
const SEED_STOCK: Record<string, [number, number, number]> = {
  prod_1: [42, 58, 6],   prod_2: [12, 38, 2],  prod_3: [27, 0, 0],
  prod_4: [6,  14, 1],   prod_5: [48, 72, 4],  prod_6: [3,  0, 0],
  prod_7: [18, 32, 3],   prod_8: [85, 0, 0],
};

export function getOrInitStock(productId: string, avgCostCents: number | null = null) {
  if (!catalogStockLevels.has(productId)) {
    const s = SEED_STOCK[productId] ?? [10, 5, 0];
    catalogStockLevels.set(productId, new Map([
      ["loc_1", { on_hand: s[0], committed: s[2], avg_cost_cents: avgCostCents }],
      ["loc_2", { on_hand: s[1], committed: 0,    avg_cost_cents: avgCostCents }],
    ]));
  }
  return catalogStockLevels.get(productId)!;
}

// Movement log per product — append-only, newest first
const catalogMovements = new Map<string, Array<{
  id: string; type: string; delta: number; location: string;
  actor: string; note: string | null; created_at: number;
}>>();

// Seed movement history for prod_1 (demo product)
const _sNow = Date.now(); const _sD = 86_400_000;
catalogMovements.set("prod_1", [
  { id: "mv_p1_1", type: "sale",       delta: -2,  location: "Main Floor", actor: "POS Terminal",      note: "Order #ORD-0042", created_at: _sNow - 2  * 3600_000 },
  { id: "mv_p1_2", type: "adjustment", delta: +5,  location: "Main Floor", actor: "admin@demo.com",    note: "Cycle count",     created_at: _sNow - 8  * 3600_000 },
  { id: "mv_p1_3", type: "receive",    delta: +50, location: "Warehouse",  actor: "system",            note: "PO-0019",         created_at: _sNow - _sD },
  { id: "mv_p1_4", type: "transfer",   delta: -10, location: "Warehouse",  actor: "system",            note: "Transfer → Main", created_at: _sNow - _sD - 3600_000 },
  { id: "mv_p1_5", type: "sale",       delta: -1,  location: "Main Floor", actor: "POS Terminal",      note: "Order #ORD-0039", created_at: _sNow - 2  * _sD },
  { id: "mv_p1_6", type: "return",     delta: +1,  location: "Main Floor", actor: "cashier@demo.com",  note: "Customer return", created_at: _sNow - 2  * _sD - 3600_000 },
  { id: "mv_p1_7", type: "adjustment", delta: -3,  location: "Main Floor", actor: "manager@demo.com",  note: "Damage write-off",created_at: _sNow - 3  * _sD },
  { id: "mv_p1_8", type: "receive",    delta: +20, location: "Main Floor", actor: "system",            note: "PO-0017",         created_at: _sNow - 5  * _sD },
]);

const customers = new Map<string, any>();
const giftcards = new Map<string, any>();
// Billing: tracks payment-mutated bills/invoices, keyed by id, layered over the base seed rows below.
const billsStore = new Map<string, any>();
const invoicesStore = new Map<string, any>();
// PO vendor bills (3-way match, #42): dev-only store keyed by bill id.
const poBills = new Map<string, any>();
let poBillSeq = 1;
const BASE_BILLS: Record<string, any> = {
  // bil_1: 2% early-pay discount valid for 10 days — still active.
  bil_1: { id: "bil_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", po_id: "po_1", bill_number: "BILL-00001", status: "open",    total_cents: 24000, paid_cents: 0,    due_date: Date.now() + 30 * 86400000, issued_at: Date.now() - 2 * 86400000, discount_pct: 2.00,  discount_date: Date.now() + 10 * 86400000, discount_applied_cents: 0 },
  // bil_2: 1% discount window already expired — no discount on payment.
  bil_2: { id: "bil_2", tenant_id: "tnt_demo", supplier_id: "sup_tea",  po_id: "po_2", bill_number: "BILL-00002", status: "partial", total_cents: 11250, paid_cents: 5000, due_date: Date.now() + 20 * 86400000, issued_at: Date.now() - 86400000,    discount_pct: 1.00,  discount_date: Date.now() - 5  * 86400000, discount_applied_cents: 0 },
  // bil_3: no discount terms.
  bil_3: { id: "bil_3", tenant_id: "tnt_demo", supplier_id: "sup_acme", po_id: null,   bill_number: "BILL-00003", status: "open",    total_cents: 6500,  paid_cents: 0,    due_date: Date.now() + 45 * 86400000, issued_at: Date.now() - 3 * 86400000, discount_pct: null,  discount_date: null,                       discount_applied_cents: 0 },
};
const BASE_INVOICES: Record<string, any> = {
  inv_1: { id: "inv_1", tenant_id: "tnt_demo", customer_id: "cus_demo_1", order_id: "ord_a", invoice_number: "INV-00001", status: "paid",    total_cents: 8600,  paid_cents: 8600, due_date: Date.now() + 15 * 86400000, issued_at: Date.now() - 5  * 86400000, dunning_level: null },
  inv_2: { id: "inv_2", tenant_id: "tnt_demo", customer_id: "cus_demo_2", order_id: null,    invoice_number: "INV-00002", status: "open",    total_cents: 4200,  paid_cents: 0,    due_date: Date.now() + 30 * 86400000, issued_at: Date.now(),              dunning_level: null },
  inv_3: { id: "inv_3", tenant_id: "tnt_demo", customer_id: "cus_demo_3", order_id: null,    invoice_number: "INV-00003", status: "partial",  total_cents: 12000, paid_cents: 3000, due_date: Date.now() - 35 * 86400000, issued_at: Date.now() - 65 * 86400000, dunning_level: 1 },
  inv_4: { id: "inv_4", tenant_id: "tnt_demo", customer_id: "cus_demo_4", order_id: null,    invoice_number: "INV-00004", status: "open",    total_cents: 7500,  paid_cents: 0,    due_date: Date.now() - 65 * 86400000, issued_at: Date.now() - 95 * 86400000, dunning_level: 2 },
  inv_5: { id: "inv_5", tenant_id: "tnt_demo", customer_id: "cus_demo_5", order_id: null,    invoice_number: "INV-00005", status: "open",    total_cents: 18900, paid_cents: 0,    due_date: Date.now() - 95 * 86400000, issued_at: Date.now() - 125 * 86400000, dunning_level: 3 },
};
let webhooks: any[] = [];
// Fulfillment / WMS dev stores
let locations: any[] = [];
const productLocations = new Map<string, string>(); // productId -> locationId
let pickLists: any[] = [];
const pickLines = new Map<string, any[]>(); // pickListId -> lines
// Sales dev stores
let quotations: any[] = [];
const quoteLines = new Map<string, any[]>();
let salesOrders: any[] = [];
const soLines = new Map<string, any[]>();
let qtSeq = 0, soSeq = 0;
const TIER_PCT: Record<number, number> = { 1: 10, 2: 7.5, 3: 5, 4: 2.5, 5: 0 };
const tierPrices = new Map<string, Array<{ tier: number; priceCents: number }>>();
// Discounts dev store
let discounts: any[] = [];
// Register sessions dev store
const registerSessions = new Map<string, any>();
// Ecommerce dev store
const onlineProducts = new Map<string, any>();
const onlineSettings = new Map<string, Record<string, unknown>>();
let ecSoSeq = 0;

// ── Store customer auth ────────────────────────────────────────────────────────
interface StoreCustomer { id: string; name: string; email: string; password: string; created_at: number; }
let storeCustomers: StoreCustomer[] = [
  { id: "sc_demo_1", name: "Alice Johnson", email: "alice@demo.com", password: "demo1234", created_at: Date.now() - 30 * 86400000 },
  { id: "sc_demo_2", name: "Bob Smith",     email: "bob@demo.com",   password: "demo1234", created_at: Date.now() - 15 * 86400000 },
];
const storeTokens = new Map<string, string>(); // token → customerId
let scSeq = 10;
const storeSettings = { visibility: "private" as "public" | "private", store_name: "Ascend Store" };
// Settings dev stores
let shippingMethods: any[] = [];
let paymentTerms: any[] = [];
let paymentModes: any[] = [];
let taxRates: any[] = [];
// ── Business-type bundles ─────────────────────────────────────────────────────
// Each bundle lists the module keys that are auto-activated when a business
// type is selected during signup or changed by support later.
const BT_BUNDLES: Record<string, string[]> = {
  retail:        ["pos_terminal", "discounts", "loyalty", "gift_cards", "ecommerce", "customer_display", "compliance"],
  wholesale:     ["sales_orders", "purchasing", "billing", "accounting", "price_book", "quotes", "invoicing"],
  restaurant:    ["tables", "kitchen", "bar_tabs", "reservations", "menu_modifiers", "pos_terminal"],
  golf:          ["tee_sheet", "golf_bookings", "golf_members", "pro_shop", "pos_terminal"],
  hospitality:   ["room_billing", "guest_accounts", "spa_services", "event_mgmt", "pos_terminal"],
  services:      ["appointments", "service_orders", "memberships", "staff_commission", "pos_terminal"],
  healthcare:    ["prescriptions", "patient_records", "insurance", "expiry_tracking"],
  manufacturing: ["production_orders", "raw_materials", "batch_mgmt", "quality_control"],
  ecommerce:     ["online_store", "order_fulfillment", "marketplace", "shipping_mgmt"],
  automotive:    ["vehicle_history", "parts_inventory", "work_orders", "inspection"],
  rental:        ["rental_contracts", "deposits", "asset_tracking", "damage_mgmt"],
  entertainment: ["tickets", "access_control", "concessions", "season_passes"],
  education:     ["fee_collection", "student_accounts", "course_enrollment", "attendance"],
};

// Non-nav system flags that always persist regardless of business type.
const SYSTEM_FLAGS: Record<string, boolean> = {
  achBatchPayout: false, imaiTracking: false, msaReporting: false,
  compositeProducts: false, customerPortal: false, commissionTracking: false,
  pickerFulfillment: true, batchDeposits: true,
};

function buildFeatureFlags(type: string, extraEnabled: Set<string>): Record<string, boolean> {
  const bundle = new Set([...(BT_BUNDLES[type] ?? []), ...extraEnabled]);
  const result: Record<string, boolean> = { ...SYSTEM_FLAGS };
  for (const key of bundle) result[`module:${key}`] = true;
  return result;
}

let featureFlags: Record<string, boolean> = buildFeatureFlags("retail", new Set());
let businessProfile: Record<string, unknown> = {};
let _btLocked = false; // locked after first setup — only support can change
// Business-profile audit trail — merged into the /audit-log feed so the
// Business Profile page's Recent Changes section works in mock mode too.
const _bpAuditEvents: Array<Record<string, unknown>> = [];
let _bpAuditSeq = 0;
function pushBpAudit(action: string, changes: Record<string, { from: unknown; to: unknown }>): void {
  _bpAuditEvents.push({
    id: `aud_bp_${++_bpAuditSeq}`,
    actor: { id: "usr_demo_owner", email: "owner@ascend.dev", role: "owner" },
    action,
    resource_type: "business_profile",
    resource_id: "business_profile",
    resource_label: "Business Profile",
    changes,
    ip_address: null,
    created_at: Date.now(),
  });
}
// ── UX-2: Module marketplace state ─────────────────────────────────────────
type _BPMod = { key: string; name: string; description: string; group: string; core?: boolean; route?: string };
const _BP_CATALOG: _BPMod[] = [
  { key: "catalog",       name: "Products & Catalog",      description: "Products, categories, variants, barcodes, price book",          group: "common",        core: true },
  { key: "inventory",     name: "Inventory",               description: "Stock tracking, receiving, adjustments, FEFO lots",             group: "common",        core: true },
  { key: "customers",     name: "Customers / CRM",         description: "Customer profiles, history, addresses, store credit",           group: "common",        core: true },
  { key: "payments",      name: "Payments",                description: "Cash, card, split tender, store credit, Stripe Terminal",       group: "common",        core: true },
  { key: "reports",       name: "Reports & Analytics",     description: "Sales, inventory, purchasing, payroll, time-card reports",      group: "common",        core: true },
  { key: "settings",      name: "Settings & Setup",        description: "Business profile, taxes, shipping, outlets, security",          group: "common",        core: true },
  { key: "team",          name: "Team & Users",            description: "Employees, roles, permissions, time clock, scheduling",         group: "common",        core: true },
  { key: "notifications", name: "Notifications",           description: "Low-stock alerts, overdue invoices, system notifications",      group: "common",        core: true },
  { key: "pos_terminal",     name: "POS Terminal",            description: "Touch-screen register, barcode scanner, receipts, numpad",      group: "retail",  route: "/terminal" },
  { key: "discounts",        name: "Discounts & Promotions",  description: "Coupons, BXGY, volume pricing, auto-applicable rules",          group: "retail",  route: "/discounts" },
  { key: "loyalty",          name: "Loyalty Programme",       description: "Points, tiers, rewards, automatic tier upgrades",               group: "retail",  route: "/loyalty" },
  { key: "gift_cards",       name: "Gift Cards",               description: "Issue, redeem, and track gift card balances",                  group: "retail",  route: "/gift-cards" },
  { key: "compliance",       name: "Compliance",               description: "Age verification, MSA/PACT reporting, state flavor bans",      group: "retail" },
  { key: "ecommerce",        name: "Ecommerce",                description: "Online store sync, product visibility, online orders",          group: "retail",  route: "/ecommerce" },
  { key: "customer_display", name: "Customer Display",          description: "Second-screen cart mirror for customer-facing display",        group: "retail",  route: "/display" },
  { key: "sales_orders",  name: "Sales Orders",        description: "B2B orders, credit terms, fulfilment workflows",              group: "b2b",  route: "/sales" },
  { key: "purchasing",    name: "Purchasing",           description: "Purchase orders, receiving, vendor management, returns",     group: "b2b",  route: "/purchasing" },
  { key: "billing",       name: "Billing — AP/AR",      description: "Supplier bills, customer invoices, aging reports",           group: "b2b",  route: "/finance" },
  { key: "accounting",    name: "Accounting",           description: "Chart of accounts, journal entries, batch deposits, P&L",   group: "b2b",  route: "/accounting" },
  { key: "price_book",    name: "Price Book",           description: "Customer-specific prices, outlet-specific overrides",        group: "b2b" },
  { key: "quotes",        name: "Quotes / Quotations",  description: "Create, send, and convert sales quotes to orders",          group: "b2b",  route: "/quotes" },
  { key: "tables",         name: "Table Management",      description: "Floor plan, table sessions, party size, server assignment",   group: "restaurant", route: "/restaurant/floor-plan" },
  { key: "kitchen",        name: "Kitchen Display (KDS)", description: "Kitchen tablet view, course ordering, bump when ready",      group: "restaurant", route: "/restaurant/kitchen" },
  { key: "bar_tabs",       name: "Bar Tabs",              description: "Open tabs, multi-round ordering, tab closing",               group: "restaurant", route: "/restaurant/tabs" },
  { key: "reservations",   name: "Reservations",          description: "Booking slots, waitlist, guest notes, confirmation emails",  group: "restaurant" },
  { key: "menu_modifiers", name: "Menu Modifiers",        description: "Add-ons, substitutions, cooking instructions per line",      group: "restaurant" },
  { key: "room_billing",   name: "Room Billing",      description: "Post charges to guest room accounts, room service",          group: "hospitality", route: "/hospitality/rooms" },
  { key: "guest_accounts", name: "Guest Accounts",    description: "Open guest folios, split charges, check-out settlement",    group: "hospitality" },
  { key: "spa_services",   name: "Spa & Services",    description: "Appointment booking, service packages, therapist assignment", group: "hospitality" },
  { key: "event_mgmt",     name: "Event Management",  description: "Banquets, conference rooms, AV packages, catering billing",  group: "hospitality" },
  { key: "appointments",     name: "Appointments",       description: "Online/walk-in booking, technician scheduling, reminders",     group: "services", route: "/appointments" },
  { key: "service_orders",   name: "Service Orders",     description: "Repair tickets, job tracking, status updates, parts used",    group: "services" },
  { key: "memberships",      name: "Membership Plans",   description: "Recurring memberships, access control, member pricing",       group: "services" },
  { key: "staff_commission", name: "Staff Commission",   description: "Commission tracking per service, technician payouts",         group: "services" },
  { key: "prescriptions",   name: "Prescriptions",     description: "Prescription tracking, controlled substances, refill history",   group: "healthcare", route: "/healthcare/prescriptions" },
  { key: "patient_records", name: "Patient Records",   description: "Patient profiles, visit history, allergy flags",                 group: "healthcare", route: "/healthcare/patients" },
  { key: "insurance",       name: "Insurance Billing", description: "Insurance claim codes, co-pay tracking, insurer billing",        group: "healthcare" },
  { key: "expiry_tracking", name: "Expiry Tracking",   description: "Medicine/lot expiry alerts, FEFO dispensing, near-expiry",     group: "healthcare" },
  { key: "production_orders", name: "Production Orders",  description: "BOM-based production orders, raw material consumption",      group: "manufacturing", route: "/manufacturing/orders" },
  { key: "raw_materials",     name: "Raw Materials",      description: "Raw material inventory, min levels, reorder automation",     group: "manufacturing" },
  { key: "batch_mgmt",        name: "Batch Management",   description: "Batch/lot tracking from production to sale, traceability",   group: "manufacturing" },
  { key: "quality_control",   name: "Quality Control",    description: "Inspection checkpoints, pass/fail logging, hold orders",     group: "manufacturing" },
  { key: "online_store",      name: "Online Store",        description: "Product visibility, SEO fields, meta title/description",    group: "ecommerce" },
  { key: "order_fulfillment", name: "Order Fulfillment",   description: "Pick-pack-ship for online orders, tracking integration",    group: "ecommerce" },
  { key: "marketplace",       name: "Marketplace Sync",    description: "Sync inventory/orders with external marketplaces",          group: "ecommerce" },
  { key: "shipping_mgmt",     name: "Shipping Management", description: "Carrier integrations, label printing, tracking numbers",    group: "ecommerce", route: "/shipping" },
  { key: "vehicle_history", name: "Vehicle History",    description: "VIN/license lookup, service history per vehicle, notes",    group: "automotive", route: "/automotive/vehicles" },
  { key: "parts_inventory", name: "Parts Inventory",    description: "Auto parts with OEM/aftermarket codes, supplier ordering",  group: "automotive" },
  { key: "work_orders",     name: "Work Orders",        description: "Job cards, technician assignment, time tracking, parts",    group: "automotive", route: "/automotive/work-orders" },
  { key: "inspection",      name: "Vehicle Inspection", description: "Pre/post service inspection checklists, digital sign-off",  group: "automotive" },
  { key: "rental_contracts", name: "Rental Contracts",  description: "Rental agreements, duration, return schedule, late fees",  group: "rental", route: "/rental/contracts" },
  { key: "deposits",         name: "Security Deposits", description: "Deposit collection, refund on return, damage deduction",   group: "rental" },
  { key: "asset_tracking",   name: "Asset Tracking",    description: "Track each rental unit by serial, location, condition",    group: "rental" },
  { key: "damage_mgmt",      name: "Damage Management", description: "Damage assessment on return, repair cost billing",         group: "rental" },
  { key: "tickets",        name: "Ticket Sales",     description: "Event/session tickets, seat selection, QR code tickets",  group: "entertainment", route: "/entertainment/tickets" },
  { key: "access_control", name: "Access Control",   description: "QR/barcode scan at entry, capacity management, passes",   group: "entertainment" },
  { key: "concessions",    name: "Concessions",      description: "Food/beverage at events, portable POS, fast checkout",    group: "entertainment" },
  { key: "season_passes",  name: "Season Passes",    description: "Annual/season pass sales, member lookup, visit tracking",  group: "entertainment" },
  { key: "fee_collection",    name: "Fee Collection",     description: "Tuition billing, instalment plans, payment receipts",     group: "education", route: "/education/fees" },
  { key: "student_accounts",  name: "Student Accounts",   description: "Student profiles, academic year, outstanding balances",  group: "education", route: "/education/students" },
  { key: "course_enrollment", name: "Course Enrollment",  description: "Course catalogue, enrollment, capacity, waiting lists",  group: "education" },
  { key: "attendance",        name: "Attendance",          description: "Class attendance tracking, absence alerts, reports",     group: "education" },
  { key: "tee_sheet",     name: "Tee Sheet",       description: "Tee time booking, slot management, cart assignment",       group: "golf" },
  { key: "golf_bookings", name: "Golf Bookings",    description: "Reservations, group bookings, cancellations, deposits",   group: "golf" },
  { key: "golf_members",  name: "Golf Memberships", description: "Season passes, member tiers, handicap tracking",          group: "golf" },
  { key: "pro_shop",      name: "Pro Shop",         description: "Retail sales within the golf context (clubs, apparel)",  group: "golf" },
  { key: "workforce",          name: "Workforce & Payroll",    description: "Scheduling, time-off requests, commission, payroll prep",  group: "enterprise" },
  { key: "wms",                name: "Warehouse Management",   description: "Multi-location stock, bin locations, pick-pack routing",   group: "enterprise" },
  { key: "webhooks",           name: "Webhooks & Public API",  description: "Outbound webhooks, API keys for third-party integrations", group: "enterprise" },
  { key: "sso",                name: "Single Sign-On",         description: "OIDC/SAML SSO for enterprise identity providers",          group: "enterprise" },
  { key: "multi_currency",     name: "Multi-Currency",         description: "Accept and report in multiple currencies with FX rates",   group: "enterprise" },
  { key: "advanced_analytics", name: "Advanced Analytics",     description: "BI dashboards, custom reports, data export, forecasting",  group: "enterprise" },
];
const _BP_CORE_KEYS = new Set(_BP_CATALOG.filter(m => m.core).map(m => m.key));
let _bpType = "retail";
let _bpEnabled = new Set<string>(BT_BUNDLES["retail"]);
// Shipping dev stores
let shipments: any[] = [];
const shipLines = new Map<string, any[]>();
let shpSeq = 0;
// Accounting dev stores
let accounts: any[] = [];
let deposits: any[] = [];
const depositItems = new Map<string, any[]>();
let depSeq = 0;
const DEFAULT_COA = [
  ["1000","Cash","asset"],["1010","Bank Checking","asset"],["1020","Bank Savings","asset"],
  ["1100","Accounts Receivable","asset"],["1200","Inventory Asset","asset"],
  ["2000","Accounts Payable","liability"],["2100","Sales Tax Payable","liability"],["2200","Credit Card","liability"],
  ["4000","Sales Revenue","income"],["4100","Shipping Income","income"],["4200","Discount Given","income"],
  ["5000","Cost of Goods Sold","expense"],["5100","Shipping Expense","expense"],["5200","Operating Expenses","expense"],
];

function seed() {
  if (customers.size === 0) {
    customers.set("cus_demo_1", { id: "cus_demo_1", tenant_id: "tnt_demo", name: "Ada Lovelace", email: "ada@example.com", phone: null, points: 240, created_at: Date.now() });
    customers.set("cus_demo_2", { id: "cus_demo_2", tenant_id: "tnt_demo", name: "Grace Hopper", email: "grace@example.com", phone: null, points: 80, created_at: Date.now() });
  }
}
seed();


export const mockHandlers = [
  // ── Inventory overview ────────────────────────────────────────────────────
  http.get(`${V1}/inventory/overview`, async () => {
    await lat();
    const items = [
      { id: "prod_1", sku: "GRO-COFFEE-001", name: "Organic Dark Roast Beans", price_cents: 1499, category: "groceries", status: "active", stock_qty: 42, reorder_pt: 10, low_stock: false },
      { id: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", price_cents: 899, category: "groceries", status: "active", stock_qty: 6, reorder_pt: 8, low_stock: true },
      { id: "prod_3", sku: "APP-TSHIRT-001", name: "Ascend Logo T-Shirt", price_cents: 2200, category: "apparel", status: "active", stock_qty: 17, reorder_pt: 5, low_stock: false },
      { id: "prod_4", sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", price_cents: 1200, category: "home", status: "active", stock_qty: 0, reorder_pt: 4, low_stock: true },
    ];
    return HttpResponse.json({ items });
  }),

  // ── Reports: top products (best sellers by revenue) ───────────────────────
  http.get(`${V1}/reports/top-products`, async () => {
    await lat();
    return HttpResponse.json({
      items: [
        { productId: "prod_1", name: "Latte", units: 34, revenueCents: 16966 },
        { productId: "prod_4", name: "Butter Croissant", units: 21, revenueCents: 6825 },
        { productId: "prod_6", name: "Cold Brew", units: 18, revenueCents: 9882 },
        { productId: "prod_9", name: "Matcha Latte", units: 12, revenueCents: 6348 },
      ],
    });
  }),

  // ── Purchasing: suppliers + purchase orders ───────────────────────────────
  http.get(`${V1}/purchasing/suppliers`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "sup_acme", tenant_id: "tnt_demo", name: "Acme Coffee Co", email: "orders@acme.example", created_at: Date.now() },
      { id: "sup_tea", tenant_id: "tnt_demo", name: "Tea Traders", email: null, created_at: Date.now() },
    ] });
  }),
  http.post(`${V1}/purchasing/suppliers`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { name?: string; email?: string };
    return HttpResponse.json({ id: `sup_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", name: b.name, email: b.email ?? null, created_at: Date.now() }, { status: 201 });
  }),
  // Purchase cost-entry — received lines awaiting cost confirmation.
  http.get(`${V1}/purchasing/cost-entry`, async () => {
    await lat();
    const now = Date.now();
    return HttpResponse.json({ items: [
      { line_id: "pol_1", product_id: "prod_1", sku: "COF-001", product_name: "House Blend 1kg", received_qty: 24, po_cost_cents: 850, supplier_name: "Acme Coffee Co", received_at: now - 3600_000, selling_price_cents: 1499, last_purchase_cost_cents: 820, prev_vendor_cost_cents: 830 },
      { line_id: "pol_2", product_id: "prod_2", sku: "TEA-014", product_name: "Earl Grey 500g", received_qty: 12, po_cost_cents: 640, supplier_name: "Tea Traders", received_at: now - 7200_000, selling_price_cents: 999, last_purchase_cost_cents: 600, prev_vendor_cost_cents: null },
    ] });
  }),
  http.post(`${V1}/purchasing/cost-entry`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { productId?: string; costCents?: number };
    return HttpResponse.json({ product_id: b.productId, cost_cents: b.costCents ?? 0 });
  }),
  http.get(`${V1}/purchasing/orders`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "po_1", tenant_id: "tnt_demo", po_number: 4001, supplier_id: "sup_acme", status: "received",  receive_status: "received", total_cost_cents: 24000, created_at: now - 2*D, received_at: now - D },
      { id: "po_2", tenant_id: "tnt_demo", po_number: 4002, supplier_id: "sup_tea",  status: "ordered",   receive_status: "pending",  total_cost_cents: 11250, created_at: now - 3600000, received_at: null },
      { id: "po_3", tenant_id: "tnt_demo", po_number: 4003, supplier_id: "sup_acme", status: "ordered",   receive_status: "partial",  total_cost_cents: 43500, created_at: now - 5*D, received_at: null },
    ] });
  }),
  http.post(`${V1}/purchasing/orders`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { supplierId: string; lines: Array<{ productId: string; quantity: number; unitCostCents: number }> };
    const lines = b.lines.map((l, i) => ({ id: `pol_${i}`, tenant_id: "tnt_demo", po_id: "po_new", product_id: l.productId, quantity: l.quantity, unit_cost_cents: l.unitCostCents, line_cost_cents: l.quantity * l.unitCostCents }));
    const total = lines.reduce((s, l) => s + l.line_cost_cents, 0);
    return HttpResponse.json({ id: "po_new", tenant_id: "tnt_demo", supplier_id: b.supplierId, status: "ordered", total_cost_cents: total, created_at: Date.now(), received_at: null, lines }, { status: 201 });
  }),
  http.post(`${V1}/purchasing/orders/:id/receive`, async ({ params, request }) => {
    await lat();
    // Echo the received lines (incl. the receive-time expiry/lot actuals) so the
    // mock matches the real contract that now persists them onto the PO line.
    const body = (await request.json().catch(() => ({}))) as {
      lines?: Array<{ lineId: string; qty?: number; expiryDate?: number; lotCode?: string }>;
    };
    const lines = (body.lines ?? []).map((l) => ({
      id: l.lineId, received_qty: l.qty ?? 0,
      expiry_date: l.expiryDate ?? null, lot_code: l.lotCode ?? null,
    }));
    return HttpResponse.json({ id: String(params.id), tenant_id: "tnt_demo", supplier_id: "sup_acme", status: "received", receive_status: "received", total_cost_cents: 24000, created_at: Date.now() - 3600000, received_at: Date.now(), lines });
  }),

  // ── Inventory: near-expiry report ─────────────────────────────────────────
  http.get(`${V1}/inventory/expiring`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "lot_1", product_id: "prod_2", name: "Wildflower Honey", lot_code: "L-2401", expiry_date: now + 5 * D, qty_on_hand: 6, days_to_expiry: 5 },
      { id: "lot_2", product_id: "prod_1", name: "Organic Dark Roast Beans", lot_code: "L-2402", expiry_date: now + 12 * D, qty_on_hand: 18, days_to_expiry: 12 },
      { id: "lot_3", product_id: "prod_4", name: "Ceramic Coffee Mug", lot_code: "L-2403", expiry_date: now + 27 * D, qty_on_hand: 4, days_to_expiry: 27 },
    ] });
  }),

  // Expiry pool + sweep + dispositions.
  http.get(`${V1}/inventory/expiry`, async () => {
    await lat();
    const now = Date.now(), D = 86400000;
    return HttpResponse.json({ items: [
      { id: "exp_1", product_id: "prod_2", product_name: "Wildflower Honey", lot_code: "L-2310", expiry_date: now - 3 * D, qty: 4, unit_cost_cents: 320, loss_cents: 1280, status: "pending" },
      { id: "exp_2", product_id: "prod_5", product_name: "Fresh Cream 500ml", lot_code: "L-2401", expiry_date: now - 1 * D, qty: 9, unit_cost_cents: 180, loss_cents: 1620, status: "pending" },
    ] });
  }),
  http.post(`${V1}/inventory/expiry/sweep`, async () => {
    await lat();
    return HttpResponse.json({ swept: 2, loss_cents: 2900, items: [] });
  }),
  http.post(`${V1}/inventory/expiry/:id/discard`, async ({ params }) => {
    await lat();
    return HttpResponse.json({ id: params.id, status: "discarded" });
  }),
  http.post(`${V1}/inventory/expiry/:id/return-to-vendor`, async ({ params }) => {
    await lat();
    return HttpResponse.json({ writeoff: { id: params.id, status: "returned", disposition_ref: "ret_mock" }, vendorReturn: { id: "ret_mock" } });
  }),

  // ── Inventory: already-expired + value-at-risk ────────────────────────────
  http.get(`${V1}/inventory/expired`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "lot_x1", product_id: "prod_2", name: "Wildflower Honey", lot_code: "L-2312", expiry_date: now - 3 * D, qty_on_hand: 4, unit_cost_cents: 500, po_id: null, received_at: now - 60 * D, days_overdue: 3 },
    ] });
  }),
  http.get(`${V1}/inventory/expiry-summary`, async () => {
    await lat();
    return HttpResponse.json({
      expired: { lots: 1, units: 4, valueCents: 2000 },
      expiringSoon: { lots: 3, units: 28, valueCents: 9400, withinDays: 30 },
    });
  }),

  // ── Vendors + AP credits (chargebacks / credit memos) ─────────────────────
  http.get(`${V1}/purchasing/vendors`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "sup_acme", tenant_id: "tnt_demo", name: "Acme Coffee Co",  email: "orders@acme.example", created_at: Date.now(), poCount: 6, totalSpentCents: 184200, openCreditsCents: 5000, status: "active",   vendor_type: "distributor", terms_days: 30, contact_name: "Bob Martinez",   city: "Austin",  state: "TX" },
      { id: "sup_tea",  tenant_id: "tnt_demo", name: "Tea Traders",      email: "hello@teatraders.co", created_at: Date.now(), poCount: 2, totalSpentCents: 41250,  openCreditsCents: 0,    status: "active",   vendor_type: "manufacturer", terms_days: 15, contact_name: "Priya Nair",     city: "Portland", state: "OR" },
      { id: "sup_pac",  tenant_id: "tnt_demo", name: "Pacific Wholesale", email: "ops@pacwhole.com",   created_at: Date.now(), poCount: 1, totalSpentCents: 12500,  openCreditsCents: 0,    status: "inactive", vendor_type: "wholesaler",   terms_days: 45, contact_name: "Derek Chan",     city: "Seattle", state: "WA" },
    ] });
  }),

  http.get(`${V1}/purchasing/vendors/:id`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const profiles: Record<string, unknown> = {
      sup_acme: {
        id: "sup_acme", tenant_id: "tnt_demo", name: "Acme Coffee Co", company: "Acme Coffee Co LLC",
        dba: null, email: "orders@acme.example", phone: "+1-555-0101", contact_name: "Bob Martinez",
        primary_sales_rep: "Jennifer Wu", address1: "123 Roastery Row", city: "Austin", state: "TX", zip: "78701",
        tax_id: "82-1234567", fein_number: "82-1234567", vendor_type: "distributor", msa_type: "standard",
        terms_days: 30, payment_method: "ach", lead_time_days: 3, status: "active",
        poCount: 6, totalSpentCents: 184200, openCreditsCents: 5000, avg_po_value_cents: 30700,
        on_time_delivery_pct: 94, fill_rate_pct: 98, dispute_rate_pct: 1,
        notes: "Preferred coffee distributor. Net-30 terms. Orders must be placed by Monday for Thursday delivery.",
        created_at: NOW - 365 * D,
      },
      sup_tea: {
        id: "sup_tea", tenant_id: "tnt_demo", name: "Tea Traders", company: "Tea Traders International",
        dba: "TTI", email: "hello@teatraders.co", phone: "+1-503-555-0199", contact_name: "Priya Nair",
        primary_sales_rep: "Mark Chen", address1: "88 Harbor Blvd", city: "Portland", state: "OR", zip: "97201",
        tax_id: "91-7654321", fein_number: "91-7654321", vendor_type: "manufacturer", msa_type: null,
        terms_days: 15, payment_method: "check", lead_time_days: 7, status: "active",
        poCount: 2, totalSpentCents: 41250, openCreditsCents: 0, avg_po_value_cents: 20625,
        on_time_delivery_pct: 87, fill_rate_pct: 95, dispute_rate_pct: 3,
        notes: null, created_at: NOW - 180 * D,
      },
      sup_pac: {
        id: "sup_pac", tenant_id: "tnt_demo", name: "Pacific Wholesale", company: "Pacific Wholesale LLC",
        dba: null, email: "ops@pacwhole.com", phone: "+1-206-555-0177", contact_name: "Derek Chan",
        primary_sales_rep: null, address1: "900 Pier St", city: "Seattle", state: "WA", zip: "98101",
        tax_id: null, fein_number: null, vendor_type: "wholesaler", msa_type: null,
        terms_days: 45, payment_method: "wire", lead_time_days: 10, status: "inactive",
        poCount: 1, totalSpentCents: 12500, openCreditsCents: 0, avg_po_value_cents: 12500,
        on_time_delivery_pct: 70, fill_rate_pct: 80, dispute_rate_pct: 8,
        notes: "On hold — pricing dispute unresolved.", created_at: NOW - 90 * D,
      },
    };
    const v = profiles[id];
    if (!v) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
    return HttpResponse.json(v);
  }),

  http.get(`${V1}/purchasing/vendors/:id/products`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const byVendor: Record<string, unknown[]> = {
      sup_acme: [
        { id: "vp_1", product_id: "prod_1", product_name: "Premium Whiskey 750ml", sku: "LIQ-001", vendor_sku: "ACM-0042", cost_cents: 1400, retail_price_cents: 2499, margin_pct: 44.0, last_cost_cents: 1380, moq: 6,  lead_time_days: 3, is_preferred: true,  last_ordered_at: NOW - 7 * D },
        { id: "vp_2", product_id: "prod_2", product_name: "Craft Beer 6-Pack",    sku: "BEV-004", vendor_sku: "ACM-0088", cost_cents: 3100, retail_price_cents: 5499, margin_pct: 43.6, last_cost_cents: 3100, moq: 1,  lead_time_days: 3, is_preferred: true,  last_ordered_at: NOW - 5 * D },
        { id: "vp_3", product_id: "prod_3", product_name: "House Red Wine",       sku: "LIQ-003", vendor_sku: "ACM-0211", cost_cents: 699,  retail_price_cents: 1299, margin_pct: 46.2, last_cost_cents: 680,  moq: 12, lead_time_days: 3, is_preferred: false, last_ordered_at: NOW - 30 * D },
      ],
      sup_tea: [
        { id: "vp_4", product_id: "prod_7", product_name: "Organic Green Tea 100g", sku: "TEA-001", vendor_sku: "TTI-GREEN-100", cost_cents: 599, retail_price_cents: 1199, margin_pct: 50.0, last_cost_cents: 599, moq: 24, lead_time_days: 7, is_preferred: true, last_ordered_at: NOW - 14 * D },
        { id: "vp_5", product_id: "prod_8", product_name: "Earl Grey Loose Leaf",  sku: "TEA-002", vendor_sku: "TTI-EARL-50",   cost_cents: 450, retail_price_cents: 999,  margin_pct: 55.0, last_cost_cents: 430, moq: 12, lead_time_days: 7, is_preferred: true, last_ordered_at: NOW - 21 * D },
      ],
      sup_pac: [],
    };
    return HttpResponse.json({ items: byVendor[id] ?? [] });
  }),

  http.get(`${V1}/purchasing/vendors/:id/purchase-orders`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const byVendor: Record<string, unknown[]> = {
      sup_acme: [
        { id: "po_1", po_number: "PO-4001", status: "received",  receive_status: "received", total_cost_cents: 24000, line_count: 2, created_at: NOW - 2 * D, received_at: NOW - D },
        { id: "po_3", po_number: "PO-4003", status: "ordered",   receive_status: "partial",  total_cost_cents: 43500, line_count: 3, created_at: NOW - 5 * D, received_at: null },
        { id: "po_5", po_number: "PO-4005", status: "billed",    receive_status: "received", total_cost_cents: 18700, line_count: 1, created_at: NOW - 14 * D, received_at: NOW - 12 * D },
        { id: "po_6", po_number: "PO-4006", status: "received",  receive_status: "received", total_cost_cents: 31200, line_count: 4, created_at: NOW - 30 * D, received_at: NOW - 28 * D },
      ],
      sup_tea: [
        { id: "po_2", po_number: "PO-4002", status: "ordered",   receive_status: "pending",  total_cost_cents: 11250, line_count: 2, created_at: NOW - 3600000, received_at: null },
        { id: "po_4", po_number: "PO-4004", status: "received",  receive_status: "received", total_cost_cents: 8750,  line_count: 1, created_at: NOW - 45 * D, received_at: NOW - 40 * D },
      ],
      sup_pac: [
        { id: "po_7", po_number: "PO-4007", status: "cancelled", receive_status: "pending",  total_cost_cents: 12500, line_count: 1, created_at: NOW - 60 * D, received_at: null },
      ],
    };
    return HttpResponse.json({ items: byVendor[id] ?? [] });
  }),

  http.get(`${V1}/purchasing/vendors/:id/invoices`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const byVendor: Record<string, unknown[]> = {
      sup_acme: [
        { id: "bil_1", bill_number: "BILL-00001", po_id: "po_1", po_number: "PO-4001", status: "open",    total_cents: 24000, paid_cents: 0,     due_date: NOW + 30 * D, issued_at: NOW - 2 * D },
        { id: "bil_3", bill_number: "BILL-00003", po_id: null,   po_number: null,       status: "open",    total_cents: 6500,  paid_cents: 0,     due_date: NOW + 45 * D, issued_at: NOW - 3 * D },
        { id: "bil_5", bill_number: "BILL-00005", po_id: "po_5", po_number: "PO-4005", status: "paid",    total_cents: 18700, paid_cents: 18700, due_date: NOW - 5 * D,  issued_at: NOW - 20 * D },
      ],
      sup_tea: [
        { id: "bil_2", bill_number: "BILL-00002", po_id: "po_2", po_number: "PO-4002", status: "partial", total_cents: 11250, paid_cents: 5000,  due_date: NOW + 20 * D, issued_at: NOW - D },
      ],
      sup_pac: [],
    };
    return HttpResponse.json({ items: byVendor[id] ?? [] });
  }),

  http.get(`${V1}/purchasing/vendors/:id/credits`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const byVendor: Record<string, unknown[]> = {
      sup_acme: [
        { id: "vcr_1", type: "chargeback",  amount_cents: 5000, reason: "expired stock return", po_id: "po_1", po_number: "PO-4001", status: "open",    created_at: NOW - D },
        { id: "vcr_2", type: "credit_memo", amount_cents: 2200, reason: "price adjustment",      po_id: null,   po_number: null,       status: "applied", created_at: NOW - 3 * D },
      ],
      sup_tea:  [],
      sup_pac:  [],
    };
    return HttpResponse.json({ items: byVendor[id] ?? [] });
  }),

  http.get(`${V1}/purchasing/vendors/:id/receiving`, async ({ params }) => {
    await lat();
    const id = String(params["id"]);
    const NOW = Date.now(); const D = 86_400_000;
    const byVendor: Record<string, unknown[]> = {
      sup_acme: [
        { id: "rcv_1", po_id: "po_1", po_number: "PO-4001", received_by: "Alex T.", received_at: NOW - D,     qty_ordered: 48, qty_received: 48, short_qty: 0, damage_qty: 0, notes: null },
        { id: "rcv_2", po_id: "po_3", po_number: "PO-4003", received_by: "Maria S.", received_at: NOW - 4 * D, qty_ordered: 90, qty_received: 60, short_qty: 30, damage_qty: 2, notes: "30 units back-ordered; 2 damaged on arrival." },
      ],
      sup_tea: [
        { id: "rcv_3", po_id: "po_4", po_number: "PO-4004", received_by: "John D.", received_at: NOW - 40 * D, qty_ordered: 24, qty_received: 24, short_qty: 0, damage_qty: 0, notes: null },
      ],
      sup_pac: [],
    };
    return HttpResponse.json({ items: byVendor[id] ?? [] });
  }),
  http.get(`${V1}/purchasing/vendor-credits`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "vcr_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", type: "chargeback", amount_cents: 5000, reason: "expired stock return", po_id: null, status: "open", created_at: Date.now() - 86400000, updated_at: Date.now() - 86400000 },
      { id: "vcr_2", tenant_id: "tnt_demo", supplier_id: "sup_acme", type: "credit_memo", amount_cents: 2200, reason: "price adjustment", po_id: null, status: "applied", created_at: Date.now() - 3 * 86400000, updated_at: Date.now() - 3 * 86400000 },
    ] });
  }),
  http.get(`${V1}/purchasing/returns`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "ret_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", reason: "expired", total_cost_cents: 1200, credit_id: "vcr_9", status: "recorded", created_at: Date.now() - 86400000 },
      { id: "ret_2", tenant_id: "tnt_demo", supplier_id: "sup_tea", reason: "damaged", total_cost_cents: 450, credit_id: null, status: "recorded", created_at: Date.now() - 2 * 86400000 },
    ] });
  }),
  http.post(`${V1}/purchasing/returns`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { supplierId?: string; reason: string; createCredit?: boolean; lines: Array<{ quantity: number; unitCostCents?: number }> };
    const total = b.lines.reduce((s, l) => s + l.quantity * (l.unitCostCents ?? 0), 0);
    return HttpResponse.json({ id: `ret_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", supplier_id: b.supplierId ?? null, reason: b.reason, total_cost_cents: total, credit_id: b.createCredit && b.supplierId ? `vcr_${Math.random().toString(36).slice(2, 8)}` : null, status: "recorded", created_at: Date.now() }, { status: 201 });
  }),
  http.post(`${V1}/purchasing/vendor-credits`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { supplierId: string; type: string; amountCents: number; reason?: string };
    return HttpResponse.json({ id: `vcr_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", supplier_id: b.supplierId, type: b.type, amount_cents: b.amountCents, reason: b.reason ?? null, po_id: null, status: "open", created_at: Date.now(), updated_at: Date.now() }, { status: 201 });
  }),

  // ── Billing: bills (AP) + invoices (AR) ───────────────────────────────────
  http.get(`${V1}/billing/bills`, async ({ request }) => {
    await lat();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const supplierId = url.searchParams.get("supplierId");
    const supNames: Record<string, string> = { sup_acme: "Acme Coffee Co", sup_tea: "Tea Traders", sup_pac: "Pacific Wholesale" };
    let items = Object.keys(BASE_BILLS).map((id) => billsStore.get(id) ?? BASE_BILLS[id]);
    if (status) items = items.filter((b) => b.status === status);
    if (supplierId) items = items.filter((b) => b.supplier_id === supplierId);
    // Mirror the backend join: each bill carries its supplier's name/company.
    items = items.map((b) => ({ ...b, supplier_name: supNames[b.supplier_id] ?? null, supplier_company: supNames[b.supplier_id] ?? null }));
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/billing/invoices`, async ({ request }) => {
    await lat();
    const status = new URL(request.url).searchParams.get("status");
    const items = Object.keys(BASE_INVOICES).map((id) => invoicesStore.get(id) ?? BASE_INVOICES[id]);
    return HttpResponse.json({ items: status ? items.filter((i) => i.status === status) : items });
  }),
  http.post(`${V1}/billing/bills/:id/pay`, async ({ request, params }) => {
    await lat();
    const body = (await request.json()) as { amountCents: number; method?: string };
    if (!body.amountCents || body.amountCents <= 0) {
      return HttpResponse.json({ error: { code: "bad_request", message: "amountCents must be > 0", requestId: rid() } }, { status: 400 });
    }
    const base = billsStore.get(params.id as string) ?? BASE_BILLS[params.id as string];
    if (!base) return HttpResponse.json({ error: { code: "not_found", message: "bill not found", requestId: rid() } }, { status: 404 });
    if (base.status === "void") return HttpResponse.json({ error: { code: "conflict", message: "cannot pay a void bill", requestId: rid() } }, { status: 409 });

    // Apply early payment discount on first payment before deadline (mirrors backend payBill logic).
    let discountApplied: number = base.discount_applied_cents ?? 0;
    const now = Date.now();
    if (discountApplied === 0 && base.discount_pct != null && base.discount_pct > 0 && base.discount_date != null && now <= base.discount_date) {
      discountApplied = Math.floor(base.total_cents * base.discount_pct / 100);
    }

    const effectiveTotal = base.total_cents - discountApplied;
    if (body.amountCents > effectiveTotal - base.paid_cents) {
      return HttpResponse.json({ error: { code: "bad_request", message: "payment exceeds discounted amount due", requestId: rid() } }, { status: 400 });
    }
    const paid_cents = base.paid_cents + body.amountCents;
    const updated = { ...base, paid_cents, discount_applied_cents: discountApplied, status: paid_cents >= effectiveTotal ? "paid" : "partial" };
    billsStore.set(updated.id, updated);
    return HttpResponse.json(updated);
  }),
  http.post(`${V1}/billing/invoices/:id/pay`, async ({ request, params }) => {
    await lat();
    const body = (await request.json()) as { amountCents: number; method?: string };
    if (!body.amountCents || body.amountCents <= 0) {
      return HttpResponse.json({ error: { code: "bad_request", message: "amountCents must be > 0", requestId: rid() } }, { status: 400 });
    }
    const base = invoicesStore.get(params.id as string) ?? BASE_INVOICES[params.id as string];
    if (!base) return HttpResponse.json({ error: { code: "not_found", message: "invoice not found", requestId: rid() } }, { status: 404 });
    if (base.status === "void") return HttpResponse.json({ error: { code: "conflict", message: "cannot pay a void invoice", requestId: rid() } }, { status: 409 });
    const remaining = base.total_cents - base.paid_cents;
    if (body.amountCents > remaining) {
      return HttpResponse.json({ error: { code: "bad_request", message: "payment exceeds amount due", requestId: rid() } }, { status: 400 });
    }
    const paid_cents = base.paid_cents + body.amountCents;
    const updated = { ...base, paid_cents, status: paid_cents >= base.total_cents ? "paid" : "partial" };
    invoicesStore.set(updated.id, updated);
    return HttpResponse.json(updated);
  }),

  // ── Reports: hourly sales rhythm ──────────────────────────────────────────
  http.get(`${V1}/reports/hourly`, async () => {
    await lat();
    const peak = [0,0,0,0,0,0,0,5,42,60,78,70,56,40,38,55,64,58,47,30,18,8,2,0];
    const max = Math.max(...peak);
    const fmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    return HttpResponse.json({
      items: peak.map((rev, hour) => ({ hour, label: fmt(hour), orderCount: Math.round(rev / 8), revenueCents: rev * 100, value: Math.round((rev / max) * 100) })),
    });
  }),
  // ── ERP reports: AR/AP aging, sales-by-X, valuation ───────────────────────
  http.get(`${V1}/reports/ar-aging`, async () => {
    await lat();
    return HttpResponse.json({
      totals: { current: 120000, d1_30: 45000, d31_60: 18000, d61_90: 9000, d90_plus: 5000, total: 197000 },
      parties: [
        { partyId: "cus_demo_1", buckets: { current: 80000, d1_30: 20000, d31_60: 0, d61_90: 0, d90_plus: 5000, total: 105000 } },
        { partyId: "cus_demo_2", buckets: { current: 40000, d1_30: 25000, d31_60: 18000, d61_90: 9000, d90_plus: 0, total: 92000 } },
      ],
    });
  }),
  // Dunning sweep (BE-14 / FE-28) — flags overdue invoices with dunning_level
  http.post(`${V1}/reports/ar-aging/sweep`, async () => {
    await lat();
    const now = Date.now();
    let updated = 0;
    for (const id of Object.keys(BASE_INVOICES)) {
      const inv = invoicesStore.get(id) ?? BASE_INVOICES[id];
      if (inv.status === "paid" || inv.status === "void" || !inv.due_date) continue;
      const daysOverdue = Math.floor((now - inv.due_date) / 86400_000);
      if (daysOverdue <= 0) continue;
      const level: 1 | 2 | 3 = daysOverdue > 90 ? 3 : daysOverdue > 60 ? 2 : 1;
      if (inv.dunning_level !== level) {
        invoicesStore.set(id, { ...inv, dunning_level: level });
        updated++;
      }
    }
    return HttpResponse.json({ updated });
  }),

  http.get(`${V1}/reports/ap-aging`, async () => {
    await lat();
    return HttpResponse.json({
      totals: { current: 60000, d1_30: 22000, d31_60: 0, d61_90: 0, d90_plus: 0, total: 82000 },
      parties: [{ partyId: "sup_demo_1", buckets: { current: 60000, d1_30: 22000, d31_60: 0, d61_90: 0, d90_plus: 0, total: 82000 } }],
    });
  }),
  http.get(`${V1}/reports/sales-by-category`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { key: "Beverages", name: "Beverages", units: 320, revenueCents: 480000 },
      { key: "Snacks", name: "Snacks", units: 540, revenueCents: 270000 },
      { key: "Tobacco", name: "Tobacco", units: 110, revenueCents: 198000 },
    ] });
  }),
  http.get(`${V1}/reports/sales-by-customer`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { key: "cus_demo_1", name: "Ada Lovelace", units: 18, revenueCents: 410000 },
      { key: "cus_demo_2", name: "Grace Hopper", units: 12, revenueCents: 286000 },
    ] });
  }),
  http.get(`${V1}/reports/inventory-valuation`, async () => {
    await lat();
    const rows = [
      { productId: "prod_demo_a", name: "Organic Dark Roast Beans", stockQty: 95, costCents: 600, retailCents: 1000, costValueCents: 57000, retailValueCents: 95000 },
      { productId: "prod_demo_b", name: "Wildflower Honey", stockQty: 90, costCents: 300, retailCents: 500, costValueCents: 27000, retailValueCents: 45000 },
      { productId: "prod_demo_c", name: "Ascend Logo T-Shirt", stockQty: 42, costCents: 900, retailCents: 2200, costValueCents: 37800, retailValueCents: 92400 },
      { productId: "prod_demo_d", name: "Ceramic Coffee Mug", stockQty: 30, costCents: 450, retailCents: 1200, costValueCents: 13500, retailValueCents: 36000 },
      { productId: "prod_demo_e", name: "Whole Bean Coffee 1lb", stockQty: 68, costCents: 700, retailCents: 1499, costValueCents: 47600, retailValueCents: 101932 },
    ];
    const totalCostCents = rows.reduce((s, r) => s + r.costValueCents, 0);
    const totalRetailCents = rows.reduce((s, r) => s + r.retailValueCents, 0);
    return HttpResponse.json({ rows, totalCostCents, totalRetailCents });
  }),


  // ── Outlets + registers (store/register selector) ─────────────────────────
  http.get(`${V1}/outlets`, async () => {
    await lat();
    return HttpResponse.json({
      items: [
        { id: "otl_main", tenant_id: "tnt_demo", name: "Main Store", timezone: "America/Los_Angeles", created_at: Date.now(), updated_at: Date.now(),
          registers: [
            { id: "reg_1", tenant_id: "tnt_demo", outlet_id: "otl_main", name: "Register 1", status: "open", created_at: Date.now(), updated_at: Date.now() },
            { id: "reg_2", tenant_id: "tnt_demo", outlet_id: "otl_main", name: "Register 2", status: "closed", created_at: Date.now(), updated_at: Date.now() },
          ] },
        { id: "otl_dt", tenant_id: "tnt_demo", name: "Downtown", timezone: "America/Los_Angeles", created_at: Date.now(), updated_at: Date.now(),
          registers: [{ id: "reg_3", tenant_id: "tnt_demo", outlet_id: "otl_dt", name: "Till A", status: "closed", created_at: Date.now(), updated_at: Date.now() }] },
      ],
    });
  }),

  http.post(`${V1}/outlets`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { name?: string; timezone?: string };
    if (!b.name) return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "name required", requestId: rid() } }, { status: 400 });
    const outlet = { id: `otl_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", name: b.name, timezone: b.timezone ?? "UTC", registers: [], created_at: Date.now(), updated_at: Date.now() };
    return HttpResponse.json(outlet, { status: 201 });
  }),
  http.post(`${V1}/outlets/:outletId/registers`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { name?: string };
    if (!b.name) return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "name required", requestId: rid() } }, { status: 400 });
    const register = { id: `reg_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", outlet_id: String(params.outletId), name: b.name, status: "closed" as const, created_at: Date.now(), updated_at: Date.now() };
    return HttpResponse.json(register, { status: 201 });
  }),

  // ── Inventory levels (frontend-requested shape) ───────────────────────────
  http.get(`${V1}/inventory/levels`, async () => {
    await lat();
    const mk = (id: string, sku: string, name: string, category: string, priceCents: number, onHand: number, reorderPoint: number) => ({
      id, sku, name, category, status: "active", priceCents,
      onHand, committed: 0, available: onHand, reorderPoint,
      // snake_case aliases consumed by LowStockSection in reports page
      stock_qty: onHand, reorder_pt: reorderPoint,
      lowStock: reorderPoint > 0 && onHand <= reorderPoint, costCents: null, velocity: 0,
    });
    return HttpResponse.json({
      pageSize: 100,
      items: [
        mk("prod_1", "GRO-COFFEE-001", "Organic Dark Roast Beans", "groceries", 1499, 42, 10),
        mk("prod_2", "GRO-HONEY-001", "Wildflower Honey", "groceries", 899, 6, 8),
        mk("prod_3", "APP-TSHIRT-001", "Ascend Logo T-Shirt", "apparel", 2200, 17, 5),
        mk("prod_4", "HOME-MUG-001", "Ceramic Coffee Mug", "home", 1200, 0, 4),
      ],
    });
  }),

  // ── Inventory transfers ───────────────────────────────────────────────────
  http.get(`${V1}/inventory/transfers`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "xfr_1", transfer_number: "TRF-0001", from_location: "Warehouse", to_location: "Main Store", status: "completed", qty: 50, created_at: now - 2*D, due_date: now - D, note: "Weekly restock" },
      { id: "xfr_2", transfer_number: "TRF-0002", from_location: "Main Store", to_location: "Downtown",  status: "in_transit", qty: 12, created_at: now - 3600000, due_date: now + D, note: null },
      { id: "xfr_3", transfer_number: "TRF-0003", from_location: "Warehouse", to_location: "Downtown",  status: "pending",    qty: 24, created_at: now - 5*D, due_date: now + 2*D, note: "Low stock alert" },
      { id: "xfr_4", transfer_number: "TRF-0004", from_location: "Warehouse", to_location: "Main Store", status: "completed", qty: 18, created_at: now - 8*D, due_date: now - 7*D, note: null },
    ] });
  }),
  http.get(`${V1}/inventory/supplier-returns`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "ret_1", return_number: "RET-0001", supplier: "Acme Coffee Co", from_location: "Main Store", status: "sent",    qty: 8,  total_cost_cents: 4800, created_at: now - 4*D, note: "Damaged goods" },
      { id: "ret_2", return_number: "RET-0002", supplier: "Tea Traders",    from_location: "Main Store", status: "pending", qty: 4,  total_cost_cents: 2200, created_at: now - D,   note: "Overshipment" },
      { id: "ret_3", return_number: "RET-0003", supplier: "Acme Coffee Co", from_location: "Downtown",  status: "credited", qty: 12, total_cost_cents: 7200, created_at: now - 10*D, note: "Wrong SKU" },
    ] });
  }),
  // Alias used by inventory Returns tab
  http.get(`${V1}/inventory/returns`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "ret_1", number: "RET-0001", from_location: "Main Store", to_location: "Acme Coffee Co", status: "sent",    total_qty: 8,  total_cost_cents: 4800, created_at: now - 4*D,  due_date: null, note: "Damaged goods" },
      { id: "ret_2", number: "RET-0002", from_location: "Main Store", to_location: "Tea Traders",    status: "pending", total_qty: 4,  total_cost_cents: 2200, created_at: now - D,    due_date: null, note: "Overshipment" },
      { id: "ret_3", number: "RET-0003", from_location: "Downtown",   to_location: "Acme Coffee Co", status: "received",total_qty: 12, total_cost_cents: 7200, created_at: now - 10*D, due_date: null, note: "Wrong SKU" },
    ] });
  }),
  http.post(`${V1}/inventory/transfers`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { from_location_id: string; to_location_id: string; product_id: string; quantity: number; note?: string };
    return HttpResponse.json({
      id: `xfr_${Date.now()}`,
      from_location_id: b.from_location_id,
      to_location_id: b.to_location_id,
      product_id: b.product_id,
      quantity: b.quantity,
      note: b.note ?? null,
      status: "completed",
      created_at: Date.now(),
    }, { status: 201 });
  }),

  // ── Inventory: locations ──────────────────────────────────────────────────
  http.get(`${V1}/inventory/locations`, async () => {
    await lat();
    return HttpResponse.json({
      items: [
        { id: "loc_main", name: "Main Store" },
        { id: "loc_wh",   name: "Warehouse" },
        { id: "loc_dt",   name: "Downtown" },
      ],
    });
  }),

  // ── Inventory: stock deduction (post-payment) ─────────────────────────────
  http.post(`${V1}/inventory/deduct`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as {
      location_id: string;
      lines: Array<{ product_id: string; qty: number }>;
      order_id: string | null;
    };
    return HttpResponse.json({
      deducted: (b.lines ?? []).reduce((s: number, l: { qty: number }) => s + l.qty, 0),
      location_id: b.location_id,
      order_id: b.order_id,
    });
  }),

  // ── Inventory: adjustments (live — mutates catalogStockLevels) ───────────
  http.post(`${V1}/inventory/adjustments`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as {
      product_id: string; location_id: string;
      delta: number; mode?: "add" | "remove" | "set";
      reason: string; note: string | null; actor?: string;
    };
    const pid = b.product_id; const lid = b.location_id;
    const stock = getOrInitStock(pid);
    const loc = stock.get(lid) ?? { on_hand: 0, committed: 0, avg_cost_cents: null };
    let actualDelta = b.delta;
    if (b.mode === "set") {
      actualDelta = b.delta - loc.on_hand;
    } else if (b.mode === "remove") {
      actualDelta = -Math.abs(b.delta);
    }
    const newOnHand = Math.max(0, loc.on_hand + actualDelta);
    stock.set(lid, { ...loc, on_hand: newOnHand });
    // Append to movement log
    if (!catalogMovements.has(pid)) catalogMovements.set(pid, []);
    const locationName = STOCK_LOCATIONS.find((l) => l.id === lid)?.name ?? lid;
    catalogMovements.get(pid)!.unshift({
      id: `mv_${pid}_${Date.now()}`,
      type: "adjustment",
      delta: actualDelta,
      location: locationName,
      actor: b.actor ?? "admin@demo.com",
      note: b.note ?? b.reason,
      created_at: Date.now(),
    });
    return HttpResponse.json(
      { id: `adj_${Math.random().toString(36).slice(2,12)}`, product_id: pid, location_id: lid, delta: actualDelta, reason: b.reason, applied_at: Date.now() },
      { status: 201 },
    );
  }),

  // ── Inventory: movement ledger ────────────────────────────────────────────
  http.get(`${V1}/inventory/movements`, async ({ request }) => {
    await lat();
    const url = new URL(request.url);
    const productId = url.searchParams.get("product_id") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 30);
    const items = (catalogMovements.get(productId) ?? []).slice(0, limit);
    return HttpResponse.json({ items, total: items.length });
  }),

  // ── Customers + loyalty ───────────────────────────────────────────────────
  http.get(`${V1}/customers`, async () => {
    await lat();
    return HttpResponse.json({ items: Array.from(customers.values()) });
  }),
  http.post(`${V1}/customers`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { name?: string; email?: string; phone?: string };
    if (!b.name) return HttpResponse.json({ error: { code: "VALIDATION_ERROR", message: "name required", requestId: rid() } }, { status: 400 });
    const c = { id: `cus_${Math.random().toString(36).slice(2, 12)}`, tenant_id: "tnt_demo", name: b.name, email: b.email ?? null, phone: b.phone ?? null, points: 0, tier: 5, company: null, dba: null, tax_id: null, license_no: null, state: null, billing_address: null, shipping_address: null, sales_rep_id: null, store_credit_cents: 0, excess_cents: 0, status: "active", verified: 0, created_at: Date.now(), updated_at: Date.now() };
    customers.set(c.id, c);
    return HttpResponse.json(c, { status: 201 });
  }),
  http.patch(`${V1}/customers/:id`, async ({ params, request }) => {
    await lat();
    const c = customers.get(String(params.id));
    if (!c) return HttpResponse.json({ error: { code: "not_found", message: "customer not found", requestId: rid() } }, { status: 404 });
    const b = (await request.json()) as any;
    const colMap: Record<string, string> = { taxId: "tax_id", licenseNo: "license_no", billingAddress: "billing_address", shippingAddress: "shipping_address", salesRepId: "sales_rep_id" };
    for (const [k, v] of Object.entries(b)) {
      if (k === "verified") { (c as any).verified = v ? 1 : 0; continue; }
      (c as any)[colMap[k] ?? k] = v;
    }
    c.updated_at = Date.now();
    return HttpResponse.json(c);
  }),
  http.get(`${V1}/customers/:id/financials`, async ({ params }) => {
    await lat();
    const c = customers.get(String(params.id));
    return HttpResponse.json({ customerId: String(params.id), dueCents: 12500, excessCents: c?.excess_cents ?? 0, storeCreditCents: c?.store_credit_cents ?? 0, openInvoices: 2 });
  }),
  http.get(`${V1}/sales/products/:productId/tier-prices`, async ({ params }) => {
    await lat();
    return HttpResponse.json({ productId: String(params.productId), prices: tierPrices.get(String(params.productId)) ?? [] });
  }),
  http.put(`${V1}/sales/products/:productId/tier-prices`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { prices: Record<string, number> };
    const list = Object.entries(b.prices).map(([tier, priceCents]) => ({ tier: Number(tier), priceCents })).sort((a, b2) => a.tier - b2.tier);
    tierPrices.set(String(params.productId), list);
    return HttpResponse.json({ productId: String(params.productId), prices: list });
  }),
  http.get(`${V1}/customers/:id/summary`, async ({ params }) => {
    await lat();
    const c = customers.get(String(params.id)) ?? { id: String(params.id), name: "Customer", email: null, phone: null, points: 0 };
    return HttpResponse.json({
      customer: { id: c.id, name: c.name, email: c.email, phone: c.phone, points: c.points },
      visits: 7, totalSpentCents: 18940, avgOrderCents: 2706, lastVisitAt: Date.now() - 86400000,
      recentOrders: [
        { id: "ord_a", orderNumber: "FP-A1", status: "completed", totalCents: 3120, createdAt: Date.now() - 86400000 },
        { id: "ord_b", orderNumber: "FP-B2", status: "completed", totalCents: 2480, createdAt: Date.now() - 3 * 86400000 },
        { id: "ord_c", orderNumber: "FP-C3", status: "refunded", totalCents: 1990, createdAt: Date.now() - 9 * 86400000 },
      ],
    });
  }),
  http.get(`${V1}/customers/:id/loyalty`, async ({ params }) => {
    await lat();
    const c = customers.get(String(params.id));
    // Simulate a silver-tier member with ~420 pts
    const pts = c?.points ?? 420;
    const tier = pts >= 1000 ? "platinum" : pts >= 500 ? "gold" : pts >= 200 ? "silver" : "bronze";
    const tierNames: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };
    const nextTier: Record<string, string | null> = { bronze: "Silver", silver: "Gold", gold: "Platinum", platinum: null };
    const thresholds: Record<string, number> = { bronze: 200, silver: 500, gold: 1000, platinum: 9999 };
    const multiplier: Record<string, number> = { bronze: 1, silver: 1.5, gold: 2, platinum: 3 };
    const discount: Record<string, number> = { bronze: 0, silver: 5, gold: 10, platinum: 15 };
    const nextTierKey = nextTier[tier];
    const pointsToNext = nextTierKey ? thresholds[nextTierKey] - pts : null;
    return HttpResponse.json({
      currentPoints: pts,
      lifetimePoints: pts + 1230,
      currentTierLevel: tier,
      currentTierName: tierNames[tier],
      nextTierName: nextTierKey ? tierNames[nextTierKey] : null,
      pointsToNextTier: pointsToNext,
      pointMultiplier: multiplier[tier],
      discountPct: discount[tier],
      redemptionHistory: [
        { id: "rdm_1", rewardName: "5% Off Voucher", pointsSpent: 100, redeemedAt: Date.now() - 86400000 * 14 },
        { id: "rdm_2", rewardName: "Free Shipping", pointsSpent: 50, redeemedAt: Date.now() - 86400000 * 30 },
      ],
    });
  }),
  http.get(`${V1}/customers/:id`, async ({ params }) => {
    await lat();
    const c = customers.get(String(params.id));
    return c ? HttpResponse.json(c) : HttpResponse.json({ error: { code: "not_found", message: "customer not found", requestId: rid() } }, { status: 404 });
  }),
  http.post(`${V1}/customers/:id/redeem`, async ({ params, request }) => {
    await lat();
    const c = customers.get(String(params.id));
    if (!c) return HttpResponse.json({ error: { code: "not_found", message: "customer not found", requestId: rid() } }, { status: 404 });
    const { points } = (await request.json()) as { points: number };
    if (!points || points % 100 !== 0) return HttpResponse.json({ error: { code: "bad_request", message: "points must be a positive multiple of 100", requestId: rid() } }, { status: 400 });
    if (c.points < points) return HttpResponse.json({ error: { code: "insufficient_points", message: "insufficient points", requestId: rid() } }, { status: 400 });
    c.points -= points;
    return HttpResponse.json({ pointsRemaining: c.points, valueCents: (points / 100) * 500 });
  }),

  // ── Gift cards ────────────────────────────────────────────────────────────
  http.post(`${V1}/giftcards`, async ({ request }) => {
    await lat();
    const { amountCents } = (await request.json()) as { amountCents: number };
    if (!amountCents || amountCents <= 0) return HttpResponse.json({ error: { code: "bad_request", message: "amountCents must be positive", requestId: rid() } }, { status: 400 });
    const block = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    const card = { id: `gft_${Math.random().toString(36).slice(2, 12)}`, tenant_id: "tnt_demo", code: `GC-${block()}-${block()}-${block()}`, initial_cents: amountCents, balance_cents: amountCents, status: "active", created_at: Date.now() };
    giftcards.set(card.code, card);
    return HttpResponse.json(card, { status: 201 });
  }),
  http.get(`${V1}/giftcards/:code`, async ({ params }) => {
    await lat();
    const card = giftcards.get(String(params.code));
    return card ? HttpResponse.json(card) : HttpResponse.json({ error: { code: "not_found", message: "gift card not found", requestId: rid() } }, { status: 404 });
  }),
  http.post(`${V1}/giftcards/:code/redeem`, async ({ params, request }) => {
    await lat();
    const card = giftcards.get(String(params.code));
    if (!card) return HttpResponse.json({ error: { code: "not_found", message: "gift card not found", requestId: rid() } }, { status: 404 });
    const { amountCents } = (await request.json()) as { amountCents: number };
    if (card.balance_cents < amountCents) return HttpResponse.json({ error: { code: "insufficient_balance", message: "insufficient balance", requestId: rid() } }, { status: 400 });
    card.balance_cents -= amountCents;
    card.status = card.balance_cents === 0 ? "redeemed" : "active";
    return HttpResponse.json({ code: card.code, redeemedCents: amountCents, balanceCents: card.balance_cents, status: card.status });
  }),

  // ── Team ─────────────────────────────────────────────────────────────────
  ...(() => {
    const NOW = Date.now();
    const D = (days: number) => NOW - days * 86_400_000;
    const H = (hrs: number) => NOW - hrs * 3_600_000;

    type Emp = {
      id: string; name: string; email: string; phone: string | null;
      role: string; department: string | null; employment_type: string;
      hourly_rate_cents: number | null; status: string; suspend_reason: string | null;
      pin: string | null; hire_date: number;
      clocked_in: boolean; clocked_in_at: number | null; today_minutes: number;
    };
    type Entry = { id: string; employee_id: string; clock_in: number; clock_out: number | null; duration_mins: number | null; notes: string | null };

    let empSeq = 20;
    let entrySeq = 100;

    let employees: Emp[] = [
      { id: "emp_1",  name: "Sarah Johnson",   email: "sarah@demo.dev",   phone: "555-1001", role: "manager",    department: "Operations",   employment_type: "full_time",  hourly_rate_cents: 2500, status: "active",     suspend_reason: null, pin: "1234", hire_date: D(540), clocked_in: true,  clocked_in_at: H(6),   today_minutes: 0    },
      { id: "emp_2",  name: "Mike Chen",       email: "mike@demo.dev",    phone: "555-1002", role: "cashier",    department: "Front End",    employment_type: "full_time",  hourly_rate_cents: 1600, status: "active",     suspend_reason: null, pin: "2345", hire_date: D(270), clocked_in: false, clocked_in_at: null,   today_minutes: 420  },
      { id: "emp_3",  name: "Ashley Williams", email: "ashley@demo.dev",  phone: "555-1003", role: "sales",      department: "Sales",        employment_type: "full_time",  hourly_rate_cents: 2000, status: "active",     suspend_reason: null, pin: "3456", hire_date: D(180), clocked_in: true,  clocked_in_at: H(3),   today_minutes: 0    },
      { id: "emp_4",  name: "David Rodriguez", email: "david@demo.dev",   phone: "555-1004", role: "accountant", department: "Finance",      employment_type: "full_time",  hourly_rate_cents: 3200, status: "active",     suspend_reason: null, pin: "4567", hire_date: D(730), clocked_in: false, clocked_in_at: null,   today_minutes: 0    },
      { id: "emp_5",  name: "Emma Thompson",   email: "emma@demo.dev",    phone: "555-1005", role: "receiver",   department: "Warehouse",    employment_type: "part_time",  hourly_rate_cents: 1500, status: "active",     suspend_reason: null, pin: "5678", hire_date: D(120), clocked_in: true,  clocked_in_at: H(2),   today_minutes: 0    },
      { id: "emp_6",  name: "James O'Brien",   email: "james@demo.dev",   phone: "555-1006", role: "shipper",    department: "Warehouse",    employment_type: "full_time",  hourly_rate_cents: 1800, status: "active",     suspend_reason: null, pin: "6789", hire_date: D(90),  clocked_in: false, clocked_in_at: null,   today_minutes: 240  },
      { id: "emp_7",  name: "Priya Patel",     email: "priya@demo.dev",   phone: "555-1007", role: "cashier",    department: "Front End",    employment_type: "part_time",  hourly_rate_cents: 1500, status: "suspended",  suspend_reason: "Attendance policy violation", pin: "7890", hire_date: D(200), clocked_in: false, clocked_in_at: null, today_minutes: 0 },
      { id: "emp_8",  name: "Carlos Ruiz",     email: "carlos@demo.dev",  phone: "555-1008", role: "warehouse",  department: "Warehouse",    employment_type: "full_time",  hourly_rate_cents: 1700, status: "active",     suspend_reason: null, pin: "8901", hire_date: D(150), clocked_in: true,  clocked_in_at: H(1),   today_minutes: 0    },
      { id: "emp_9",  name: "Alex Kim",        email: "alex@demo.dev",    phone: "555-1009", role: "driver",     department: "Delivery",     employment_type: "full_time",  hourly_rate_cents: 1900, status: "active",     suspend_reason: null, pin: "9012", hire_date: D(60),  clocked_in: true,  clocked_in_at: H(5),   today_minutes: 0    },
      { id: "emp_10", name: "Jordan Lee",      email: "jordan@demo.dev",  phone: "555-1010", role: "cashier",    department: "Front End",    employment_type: "full_time",  hourly_rate_cents: 1600, status: "active",     suspend_reason: null, pin: "0123", hire_date: D(45),  clocked_in: false, clocked_in_at: null,   today_minutes: 480  },
      { id: "emp_11", name: "Demo Owner",      email: "owner@ascend.dev", phone: null,   role: "owner",      department: "Management",   employment_type: "full_time",  hourly_rate_cents: null, status: "active",     suspend_reason: null, pin: null,   hire_date: D(900), clocked_in: false, clocked_in_at: null,   today_minutes: 0    },
    ];

    // Seed today's time entries for active demo employees
    let timeEntries: Entry[] = [
      // Sarah: clocked in 6h ago (no clock-out yet)
      { id: "ent_1", employee_id: "emp_1", clock_in: H(6), clock_out: null, duration_mins: null, notes: null },
      // Mike: 7h complete shift
      { id: "ent_2", employee_id: "emp_2", clock_in: H(8), clock_out: H(1), duration_mins: 420, notes: null },
      // Ashley: clocked in 3h ago
      { id: "ent_3", employee_id: "emp_3", clock_in: H(3), clock_out: null, duration_mins: null, notes: null },
      // James: 4h complete
      { id: "ent_4", employee_id: "emp_6", clock_in: H(5), clock_out: H(1), duration_mins: 240, notes: null },
      // Jordan: 8h complete
      { id: "ent_5", employee_id: "emp_10", clock_in: H(9), clock_out: H(1), duration_mins: 480, notes: null },
      // Emma: clocked in 2h ago
      { id: "ent_6", employee_id: "emp_5", clock_in: H(2), clock_out: null, duration_mins: null, notes: null },
      // Carlos: clocked in 1h ago
      { id: "ent_7", employee_id: "emp_8", clock_in: H(1), clock_out: null, duration_mins: null, notes: null },
      // Alex: clocked in 5h ago
      { id: "ent_8", employee_id: "emp_9", clock_in: H(5), clock_out: null, duration_mins: null, notes: null },
    ];

    return [
      // GET /team
      http.get(`${V1}/team`, async () => {
        await lat();
        return HttpResponse.json({ items: employees });
      }),

      // GET /team/:id — single employee
      http.get(`${V1}/team/:id`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const emp = employees.find((e) => e.id === id);
        if (!emp) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(emp);
      }),

      // POST /team (create)
      http.post(`${V1}/team`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<Emp>;
        if (!b.name || !b.email) return HttpResponse.json({ error: { code: "validation", message: "name and email required" } }, { status: 400 });
        if (employees.find((e) => e.email === b.email)) return HttpResponse.json({ error: { code: "conflict", message: "Email already exists." } }, { status: 409 });
        const emp: Emp = {
          id: `emp_${++empSeq}`, name: b.name, email: b.email,
          phone: b.phone ?? null, role: b.role ?? "cashier",
          department: b.department ?? null, employment_type: b.employment_type ?? "full_time",
          hourly_rate_cents: b.hourly_rate_cents ?? null, status: "active",
          suspend_reason: null, pin: b.pin ?? null, hire_date: b.hire_date ?? Date.now(),
          clocked_in: false, clocked_in_at: null, today_minutes: 0,
        };
        employees.push(emp);
        return HttpResponse.json(emp, { status: 201 });
      }),

      // Legacy invite alias
      http.post(`${V1}/team/invite`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { email: string; role?: string; name?: string };
        if (!b.email) return HttpResponse.json({ error: { code: "validation", message: "email required" } }, { status: 400 });
        const emp: Emp = {
          id: `emp_${++empSeq}`, name: b.name ?? b.email.split("@")[0] ?? b.email,
          email: b.email, phone: null, role: b.role ?? "cashier",
          department: null, employment_type: "full_time", hourly_rate_cents: null,
          status: "active", suspend_reason: null, pin: null, hire_date: Date.now(),
          clocked_in: false, clocked_in_at: null, today_minutes: 0,
        };
        employees.push(emp);
        return HttpResponse.json(emp, { status: 201 });
      }),

      // POST /team/:id/clock-in  — must come before PATCH /:id
      http.post(`${V1}/team/:id/clock-in`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const emp = employees.find((e) => e.id === id);
        if (!emp) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        if (emp.clocked_in) return HttpResponse.json({ error: { code: "already_in", message: "Already clocked in." } }, { status: 409 });
        emp.clocked_in = true;
        emp.clocked_in_at = Date.now();
        const entry: Entry = { id: `ent_${++entrySeq}`, employee_id: id, clock_in: Date.now(), clock_out: null, duration_mins: null, notes: null };
        timeEntries.push(entry);
        return HttpResponse.json({ ok: true, clocked_in_at: emp.clocked_in_at });
      }),

      // POST /team/:id/clock-out — must come before PATCH /:id
      http.post(`${V1}/team/:id/clock-out`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const emp = employees.find((e) => e.id === id);
        if (!emp) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        if (!emp.clocked_in) return HttpResponse.json({ error: { code: "not_in", message: "Not clocked in." } }, { status: 409 });
        const elapsed = Math.floor((Date.now() - (emp.clocked_in_at ?? Date.now())) / 60_000);
        emp.today_minutes += elapsed;
        emp.clocked_in = false;
        emp.clocked_in_at = null;
        const entry = [...timeEntries].reverse().find((e) => e.employee_id === id && !e.clock_out);
        if (entry) { entry.clock_out = Date.now(); entry.duration_mins = elapsed; }
        return HttpResponse.json({ ok: true, today_minutes: emp.today_minutes });
      }),

      // GET /team/:id/time-entries
      http.get(`${V1}/team/:id/time-entries`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const items = timeEntries.filter((e) => e.employee_id === id && e.clock_in >= todayStart.getTime());
        return HttpResponse.json({ items });
      }),

      // PATCH /team/:id
      http.patch(`${V1}/team/:id`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const idx = employees.findIndex((e) => e.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<Emp>;
        employees[idx] = { ...employees[idx]!, ...b, id };
        return HttpResponse.json(employees[idx]);
      }),

      // DELETE /team/:id
      http.delete(`${V1}/team/:id`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const idx = employees.findIndex((e) => e.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        employees.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Custom Roles ─────────────────────────────────────────────────────────
  ...(() => {
    let crlSeq = 0;
    let customRoles: Array<{
      id: string; name: string; description: string | null;
      permissions: string[]; createdAt: number; updatedAt: number;
    }> = [
      {
        id: "crl_demo_1", name: "Sales Rep",
        description: "Can view and write orders and customers",
        permissions: ["orders:read", "orders:write", "customers:read", "customers:write"],
        createdAt: Date.now() - 45 * 86_400_000, updatedAt: Date.now() - 45 * 86_400_000,
      },
      {
        id: "crl_demo_2", name: "Inventory Clerk",
        description: "Can manage catalog and inventory",
        permissions: ["catalog:read", "catalog:write", "inventory:read", "inventory:write"],
        createdAt: Date.now() - 20 * 86_400_000, updatedAt: Date.now() - 20 * 86_400_000,
      },
    ];
    return [
      http.get(`${V1}/custom-roles`, async () => {
        await lat();
        return HttpResponse.json({ items: customRoles });
      }),
      http.get(`${V1}/custom-roles/:id`, async ({ params }) => {
        await lat();
        const r = customRoles.find((x) => x.id === String(params["id"]));
        if (!r) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(r);
      }),
      http.post(`${V1}/custom-roles`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { name: string; description?: string; permissions: string[] };
        const r = {
          id: `crl_${++crlSeq}`, name: b.name,
          description: b.description ?? null, permissions: b.permissions,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        customRoles.push(r);
        return HttpResponse.json(r, { status: 201 });
      }),
      http.patch(`${V1}/custom-roles/:id`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Partial<{ name: string; description: string; permissions: string[] }>;
        const idx = customRoles.findIndex((x) => x.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        customRoles[idx] = { ...customRoles[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(customRoles[idx]);
      }),
      http.delete(`${V1}/custom-roles/:id`, async ({ params }) => {
        await lat();
        const before = customRoles.length;
        customRoles = customRoles.filter((x) => x.id !== String(params["id"]));
        if (customRoles.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch(`${V1}/custom-roles/assign/:userId`, async () => {
        await lat();
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Catalog ───────────────────────────────────────────────────────────────
  ...(() => {
    let prodSeq = 10;
    let catSeq  = 10;

    let categories: Array<{ id: string; name: string; parent_id: string | null; created_at: number }> = [
      { id: "cat_1", name: "Beverages",  parent_id: null, created_at: Date.now() - 120 * 86_400_000 },
      { id: "cat_2", name: "Snacks",     parent_id: null, created_at: Date.now() - 120 * 86_400_000 },
      { id: "cat_3", name: "Tobacco",    parent_id: null, created_at: Date.now() - 120 * 86_400_000 },
      { id: "cat_4", name: "Chips",      parent_id: "cat_2", created_at: Date.now() - 90 * 86_400_000 },
    ];

    // Many-to-many: category → set of product IDs
    const categoryProducts = new Map<string, Set<string>>([
      ["cat_1", new Set(["prod_1", "prod_2", "prod_6"])],
      ["cat_2", new Set(["prod_3", "prod_4"])],
      ["cat_3", new Set(["prod_5", "prod_7"])],
      ["cat_4", new Set(["prod_8"])],
    ]);

    // Products are stored and returned in TerminalProduct shape (camelCase) so
    // ProductGrid and the barcode scanner both receive the right field names.
    const now = Date.now();
    const mkProduct = (
      id: string, sku: string, name: string, priceCents: number,
      category: string, taxClass: "standard" | "exempt", barcode: string,
      status: "active" | "draft" | "archived", ageRestricted: boolean,
      costCents: number, createdDaysAgo: number,
      compliance?: {
        tobacco_type?: string | null;
        flavored?: boolean;
        menthol?: boolean;
        msa_reportable?: boolean;
        restricted_states?: string[];
      },
    ) => ({
      id, sku, name, priceCents, category, taxClass, barcode, status, ageRestricted,
      createdAt: now - createdDaysAgo * 86_400_000, updatedAt: now - Math.floor(createdDaysAgo / 3) * 86_400_000,
      // Extended fields used by catalog management pages (snake_case subset)
      price_cents: priceCents, tax_class: taxClass, age_restricted: ageRestricted ? 1 : 0,
      raw_cost_price_cents: costCents, description: null, brand: null,
      image_url: null, msrp_cents: null, parent_product_id: null, variant_label: null,
      // Compliance fields (dual snake_case + camelCase for compatibility)
      tobacco_type: compliance?.tobacco_type ?? null,
      flavored: compliance?.flavored ? 1 : 0,
      menthol: compliance?.menthol ? 1 : 0,
      msa_reportable: compliance?.msa_reportable ? 1 : 0,
      restricted_states: compliance?.restricted_states ?? [],
      tobaccoType: compliance?.tobacco_type ?? null,
      msaReportable: !!compliance?.msa_reportable,
      restrictedStates: compliance?.restricted_states ?? [],
    });

    let products = [
      mkProduct("prod_1","BEV-001","Spring Water 500ml",199,"Beverages","standard","012345678901","active",false,80,90),
      mkProduct("prod_2","BEV-002","Orange Juice 1L",349,"Beverages","standard","012345678902","active",false,140,88),
      mkProduct("prod_3","SNK-001","Potato Chips 150g",299,"Snacks","standard","012345678903","active",false,110,60),
      mkProduct("prod_4","SNK-002","Mixed Nuts 200g",599,"Snacks","standard","012345678904","active",false,250,45),
      mkProduct("prod_5","TOB-001","Classic Cigarettes 20pk",1299,"Tobacco","exempt","012345678905","active",true,850,100,
        { tobacco_type: "cigarette", msa_reportable: true }),
      mkProduct("prod_6","BEV-003","Energy Drink 250ml",249,"Beverages","standard","012345678906","draft",false,100,5),
      mkProduct("prod_7","TOB-FLV","Mango Blast Vape 50mg",1499,"Tobacco","exempt","012345678907","active",true,600,45,
        { tobacco_type: "ecigarette", flavored: true, msa_reportable: true, restricted_states: ["CA","MA","NJ","RI","IL"] }),
      Object.assign(
        mkProduct("prod_8","SNK-CHD-025","Pringles Potato Crisps Chips, Cheddar Cheese, Grab N' Go Snack Pack - 2.5 Ounce",249,"Chips","standard","038000845260","active",false,88,30),
        {
          brand: "Pringles",
          description: "A delicious and cheesy snack option. Each tube contains a stack of crispy and flavorful potato chips coated with a savory cheddar cheese seasoning. The 2.5 oz grab-and-go size is perfect for on-the-go snacking or lunchboxes. The resealable tube keeps chips fresh and crispy.",
          image_url: null,
          msrp_cents: 269,
        },
      ),
    ];

    function applyFilters(
      list: typeof products,
      category?: string,
      status?: string,
      q?: string,
    ) {
      return list.filter((p) => {
        if (category && p.category !== category) return false;
        if (status && p.status !== status) return false;
        if (q) {
          const lq = q.toLowerCase();
          if (
            !String(p.name).toLowerCase().includes(lq) &&
            !String(p.sku).toLowerCase().includes(lq) &&
            !String(p.barcode ?? "").includes(lq)
          ) return false;
        }
        return true;
      });
    }

    return [
      // ── Products ──────────────────────────────────────────────────────────
      http.get(`${V1}/catalog`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const category = url.searchParams.get("category") ?? undefined;
        const status   = url.searchParams.get("status")   ?? undefined;
        const q        = url.searchParams.get("q")        ?? undefined;
        const limit    = Number(url.searchParams.get("limit") ?? 50);
        const offset   = Number(url.searchParams.get("offset") ?? 0);
        const filtered = applyFilters(products, category, status, q);
        return HttpResponse.json({
          items: filtered.slice(offset, offset + limit),
          total: filtered.length,
          limit,
          offset,
        });
      }),

      http.post(`${V1}/catalog`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Record<string, unknown>;
        const pc = Number(b.price_cents ?? b.priceCents ?? 0);
        const p = mkProduct(
          `prod_${++prodSeq}`, String(b.sku ?? ""), String(b.name ?? ""), pc,
          String(b.category ?? "Uncategorized"),
          (b.tax_class ?? b.taxClass ?? "standard") as "standard" | "exempt",
          String(b.barcode ?? ""),
          (b.status ?? "draft") as "active" | "draft" | "archived",
          !!(b.age_restricted ?? b.ageRestricted),
          Number(b.raw_cost_price_cents ?? 0), 0,
        );
        products.push(p);
        return HttpResponse.json(p, { status: 201 });
      }),

      http.get(`${V1}/catalog/:id/stock`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const p = products.find((x) => x.id === id);
        if (!p) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const stock = getOrInitStock(id, p.raw_cost_price_cents ?? null);
        const locations = STOCK_LOCATIONS.map((loc) => {
          const s = stock.get(loc.id) ?? { on_hand: 0, committed: 0, avg_cost_cents: null };
          return {
            location_id: loc.id, location_code: loc.code, location_name: loc.name,
            quantity_on_hand: s.on_hand, quantity_committed: s.committed,
            quantity_available: Math.max(0, s.on_hand - s.committed),
            average_cost_cents: s.avg_cost_cents ?? p.raw_cost_price_cents,
          };
        });
        return HttpResponse.json({ product_id: id, locations });
      }),

      http.get(`${V1}/catalog/:id`, async ({ params }) => {
        await lat();
        const p = products.find((x) => x.id === String(params["id"]));
        if (!p) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(p);
      }),

      http.patch(`${V1}/catalog/:id`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Record<string, unknown>;
        const idx = products.findIndex((x) => x.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        products[idx] = { ...products[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(products[idx]);
      }),

      http.delete(`${V1}/catalog/:id`, async ({ params }) => {
        await lat();
        const idx = products.findIndex((x) => x.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        products[idx] = { ...products[idx], status: "archived", updatedAt: Date.now() };
        return HttpResponse.json(products[idx]);
      }),

      http.get(`${V1}/catalog/barcode/:code`, async ({ params }) => {
        await lat();
        const code = String(params["code"]);
        const p = products.find((x) => x.barcode === code || x.sku === code);
        if (!p) return HttpResponse.json({ error: { code: "not_found", message: `No active product with barcode '${code}'` } }, { status: 404 });
        return HttpResponse.json(p);
      }),

      // ── Bulk operations ───────────────────────────────────────────────────
      http.post(`${V1}/catalog/bulk-update`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { ids: string[]; update: Record<string, unknown> };
        let updated = 0;
        for (const id of b.ids) {
          const idx = products.findIndex(p => p.id === id);
          if (idx !== -1) { products[idx] = { ...products[idx], ...b.update, updatedAt: Date.now() }; updated++; }
        }
        return HttpResponse.json({ updated });
      }),

      http.post(`${V1}/catalog/import-csv`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { rows: Array<Record<string, string>> };
        const rows = body.rows ?? [];
        let imported = 0;
        const errors: Array<{ row: number; message: string }> = [];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const name = (r["name"] ?? r["Name"] ?? "").trim();
          if (!name) { errors.push({ row: i + 1, message: "Name is required" }); continue; }
          const sku = (r["sku"] ?? r["SKU"] ?? `IMP-${++prodSeq}`).trim();
          const pc = Math.round(parseFloat(r["price"] ?? r["Price"] ?? "0") * 100) || 0;
          const costPc = Math.round(parseFloat(r["cost"] ?? r["Cost"] ?? "0") * 100) || 0;
          const p = mkProduct(
            `prod_${++prodSeq}`, sku, name, pc,
            (r["category"] ?? r["Category"] ?? "Uncategorized").trim(),
            ((r["tax_class"] ?? r["Tax Class"] ?? "standard").toLowerCase() === "exempt" ? "exempt" : "standard"),
            (r["barcode"] ?? r["Barcode"] ?? "").trim(),
            "draft", false, costPc, 0,
          );
          Object.assign(p, {
            brand: (r["brand"] ?? r["Brand"] ?? null) || null,
            description: (r["description"] ?? r["Description"] ?? null) || null,
          });
          products.push(p);
          imported++;
        }
        return HttpResponse.json({ imported, skipped: 0, errors });
      }),

      http.post(`${V1}/catalog/:id/duplicate`, async ({ params }) => {
        await lat();
        const src = products.find((x) => x.id === String(params["id"]));
        if (!src) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const copy = {
          ...src,
          id: `prod_${++prodSeq}`,
          name: `${src.name} (Copy)`,
          sku: `${src.sku}-COPY`,
          status: "draft" as const,
          parent_product_id: null,
          variant_label: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        products.push(copy);
        return HttpResponse.json(copy, { status: 201 });
      }),

      // ── Categories ────────────────────────────────────────────────────────
      http.get(`${V1}/catalog/categories`, async () => {
        await lat();
        const items = categories.map((c) => ({
          ...c,
          product_count: categoryProducts.get(c.id)?.size ?? 0,
          slug: c.name.toLowerCase().replace(/\s+/g, "-"),
        }));
        return HttpResponse.json({ items });
      }),

      http.post(`${V1}/catalog/categories`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { name: string; parent_id?: string | null };
        const cat = { id: `cat_${++catSeq}`, name: b.name, parent_id: b.parent_id ?? null, created_at: Date.now() };
        categories.push(cat);
        return HttpResponse.json(cat, { status: 201 });
      }),

      http.patch(`${V1}/catalog/categories/:id`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Partial<{ name: string; parent_id: string | null }>;
        const idx = categories.findIndex((c) => c.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        categories[idx] = { ...categories[idx], ...b };
        return HttpResponse.json(categories[idx]);
      }),

      http.delete(`${V1}/catalog/categories/:id`, async ({ params }) => {
        await lat();
        const before = categories.length;
        categories = categories.filter((c) => c.id !== String(params["id"]));
        if (categories.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        categoryProducts.delete(String(params["id"]));
        return new HttpResponse(null, { status: 204 });
      }),

      // GET single category with sub-categories + product_count
      http.get(`${V1}/catalog/categories/:id`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const cat = categories.find((c) => c.id === id);
        if (!cat) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const subs = categories
          .filter((c) => c.parent_id === id)
          .map((s) => ({ ...s, product_count: categoryProducts.get(s.id)?.size ?? 0, slug: s.name.toLowerCase().replace(/\s+/g, "-") }));
        return HttpResponse.json({
          ...cat,
          slug: cat.name.toLowerCase().replace(/\s+/g, "-"),
          product_count: categoryProducts.get(id)?.size ?? 0,
          sub_categories: subs,
        });
      }),

      // GET products in a category
      http.get(`${V1}/catalog/categories/:id/products`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const url = new URL(request.url);
        const q = url.searchParams.get("q")?.toLowerCase() ?? "";
        const pids = categoryProducts.get(id) ?? new Set<string>();
        let items = products.filter((p) => pids.has(p.id));
        if (q) items = items.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
        return HttpResponse.json({ items, total: items.length });
      }),

      // Add products to a category
      http.post(`${V1}/catalog/categories/:id/products`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        if (!categories.find((c) => c.id === id))
          return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const { productIds } = (await request.json()) as { productIds: string[] };
        if (!categoryProducts.has(id)) categoryProducts.set(id, new Set());
        for (const pid of productIds ?? []) categoryProducts.get(id)!.add(pid);
        return HttpResponse.json({ added: (productIds ?? []).length });
      }),

      // Remove a product from a category
      http.delete(`${V1}/catalog/categories/:id/products/:productId`, async ({ params }) => {
        await lat();
        categoryProducts.get(String(params["id"]))?.delete(String(params["productId"]));
        return new HttpResponse(null, { status: 204 });
      }),

      // GET categories assigned to a product
      http.get(`${V1}/catalog/:id/categories`, async ({ params }) => {
        await lat();
        const productId = String(params["id"]);
        const assigned = categories
          .filter((c) => categoryProducts.get(c.id)?.has(productId))
          .map((c) => ({ ...c, product_count: categoryProducts.get(c.id)?.size ?? 0, slug: c.name.toLowerCase().replace(/\s+/g, "-") }));
        return HttpResponse.json({ items: assigned });
      }),

      // Replace category assignments for a product
      http.post(`${V1}/catalog/:id/categories`, async ({ params, request }) => {
        await lat();
        const productId = String(params["id"]);
        const { categoryIds } = (await request.json()) as { categoryIds: string[] };
        for (const [, pids] of categoryProducts) pids.delete(productId);
        for (const cid of categoryIds ?? []) {
          if (!categoryProducts.has(cid)) categoryProducts.set(cid, new Set());
          categoryProducts.get(cid)!.add(productId);
        }
        return HttpResponse.json({ ok: true });
      }),

      // ── Compliance flags ──────────────────────────────────────────────────
      http.patch(`${V1}/catalog/:id/compliance`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Record<string, unknown>;
        const idx = products.findIndex((p) => p.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        products[idx] = { ...products[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(products[idx]);
      }),

      // ── Variants (master/child) ───────────────────────────────────────────
      http.get(`${V1}/catalog/:id/variants`, async ({ params }) => {
        await lat();
        const masterId = String(params["id"]);
        const children = products.filter((p) => p.parent_product_id === masterId);
        return HttpResponse.json({ items: children });
      }),

      http.post(`${V1}/catalog/:id/variants/assign`, async ({ params, request }) => {
        await lat();
        const masterId = String(params["id"]);
        const master = products.find((p) => p.id === masterId);
        if (!master) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { productIds: string[]; label?: string };
        for (const pid of body.productIds ?? []) {
          const cidx = products.findIndex((p) => p.id === pid);
          if (cidx !== -1) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (products[cidx] as any).parent_product_id = masterId;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (products[cidx] as any).variant_label = body.label ?? null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (products[cidx] as any).updatedAt = Date.now();
          }
        }
        const updated = products.filter((p) => p.parent_product_id === masterId);
        return HttpResponse.json({ items: updated }, { status: 200 });
      }),

      http.delete(`${V1}/catalog/:id/variants/:childId`, async ({ params }) => {
        await lat();
        const cidx = products.findIndex((p) => p.id === String(params["childId"]));
        if (cidx !== -1) {
          products[cidx] = { ...products[cidx], parent_product_id: null, variant_label: null, updatedAt: Date.now() };
        }
        return HttpResponse.json({ ok: true });
      }),

      // ── Matrix generation — creates child products for each combination ───
      http.post(`${V1}/catalog/:id/variants/generate`, async ({ params, request }) => {
        await lat();
        const masterId = String(params["id"]);
        const master = products.find((p) => p.id === masterId);
        if (!master) return HttpResponse.json({ error: "not_found" }, { status: 404 });
        const body = (await request.json()) as { attributes: { name: string; values: string[] }[] };
        const attrs = body.attributes ?? [];

        // Cartesian product of all attribute value arrays
        const combos: string[][] = attrs.reduce<string[][]>(
          (acc, attr) => acc.flatMap((combo) => attr.values.map((v) => [...combo, v])),
          [[]],
        );

        let added = 0;
        for (const combo of combos) {
          const variantLabel = combo.join(" / ");
          // Skip if already exists as a child with same label
          const already = products.some(
            (p) => p.parent_product_id === masterId && (p as any).variant_label === variantLabel,
          );
          if (already) continue;

          const newId = `var_${Math.random().toString(36).slice(2, 10)}`;
          const skuSuffix = combo.map((v) => v.replace(/\s+/g, "").toUpperCase().slice(0, 4)).join("-");
          // Name = "Master Name — Variant Label" for invoice/scan display
          const variantName = `${master.name} — ${variantLabel}`;
          const newProduct = {
            ...master,
            id: newId,
            sku: `${master.sku}-${skuSuffix}`,
            name: variantName,
            parent_product_id: masterId,
            variant_label: variantLabel,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          products.push(newProduct as unknown as typeof products[0]);
          added++;
        }

        const children = products.filter((p) => p.parent_product_id === masterId);
        return HttpResponse.json({ items: children, added });
      }),

      // ── Batches/lots per product (used by ExpiryTab) ─────────────────────
      ...(() => {
        let bSeq = 100;
        const D = 86_400_000;
        const N = Date.now();

        function mkBatch(id: string, productId: string, batchNum: string, qty: number, costCents: number | null,
          expiryOffset: number | null, supplier: string | null): {
          id: string; product_id: string; batch_number: string; supplier_name: string | null;
          received_at: number; expiry_date: number; qty_on_hand: number; cost_cents: number | null;
          status: "fresh" | "expiring" | "expired";
        } {
          const exp = expiryOffset !== null ? N + expiryOffset * D : N + 90 * D;
          const daysLeft = Math.ceil((exp - N) / D);
          const status: "fresh" | "expiring" | "expired" =
            daysLeft < 0 ? "expired" : daysLeft <= 30 ? "expiring" : "fresh";
          return { id, product_id: productId, batch_number: batchNum, supplier_name: supplier,
            received_at: N - 20 * D, expiry_date: exp, qty_on_hand: qty, cost_cents: costCents, status };
        }

        let batches = [
          mkBatch("b_p1_a","prod_1","LOT-2024-001",48,80,-3,"CoreDist"),
          mkBatch("b_p1_b","prod_1","LOT-2024-002",120,78,15,"CoreDist"),
          mkBatch("b_p1_c","prod_1","LOT-2024-003",60,82,45,"CoreDist"),
          mkBatch("b_p2_a","prod_2","LOT-2024-010",24,130,4,"KeHE"),
          mkBatch("b_p2_b","prod_2","LOT-2024-011",36,128,60,"KeHE"),
          mkBatch("b_p3_a","prod_3","LOT-2024-020",72,100,null,"Sysco"),
          mkBatch("b_p4_a","prod_4","LOT-2024-030",18,240,22,"NatFoods"),
          mkBatch("b_p5_a","prod_5","LOT-2024-040",100,820,null,null),
        ];

        return [
          http.get(`${V1}/catalog/:id/batches`, async ({ params }) => {
            await lat();
            const pid = String(params["id"]);
            const items = batches.filter((b) => b.product_id === pid);
            return HttpResponse.json({ items });
          }),
          http.post(`${V1}/catalog/:id/batches`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const body = (await request.json()) as Record<string, unknown>;
            const exp = body.expiry_date ? Number(body.expiry_date) : Date.now() + 90 * D;
            const dLeft = Math.ceil((exp - Date.now()) / D);
            const status: "fresh" | "expiring" | "expired" = dLeft < 0 ? "expired" : dLeft <= 30 ? "expiring" : "fresh";
            const b = {
              id: `b_${++bSeq}`, product_id: pid,
              batch_number: String(body.batch_number ?? "LOT-NEW"),
              supplier_name: (body.supplier_name as string | null) ?? null,
              received_at: body.received_at ? Number(body.received_at) : Date.now(),
              expiry_date: exp,
              qty_on_hand: Number(body.qty_on_hand ?? 0),
              cost_cents: body.cost_cents ? Number(body.cost_cents) : null,
              status,
            };
            batches.push(b);
            return HttpResponse.json(b, { status: 201 });
          }),
          http.patch(`${V1}/catalog/:id/batches/:bid`, async ({ params, request }) => {
            await lat();
            const bid = String(params["bid"]);
            const body = (await request.json()) as Record<string, unknown>;
            const idx = batches.findIndex((b) => b.id === bid);
            if (idx === -1) return HttpResponse.json({ error: "not_found" }, { status: 404 });
            batches[idx] = { ...batches[idx], ...body } as typeof batches[0];
            return HttpResponse.json(batches[idx]);
          }),
          http.delete(`${V1}/catalog/:id/batches/:bid`, async ({ params }) => {
            await lat();
            const bid = String(params["bid"]);
            const before = batches.length;
            batches = batches.filter((b) => b.id !== bid);
            if (batches.length === before) return HttpResponse.json({ error: "not_found" }, { status: 404 });
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Expiry batches per product ────────────────────────────────────────
      ...(() => {
        let batchSeq = 10;
        const DAY = 86_400_000;
        const BASE = Date.now();

        function makeExpiry(id: string, productId: string, batchNum: string, qty: number,
          costCents: number, expiryOffset: number | null, supplier: string | null,
          lotCode: string | null = null, notes: string | null = null) {
          const expiryDate = expiryOffset !== null ? BASE + expiryOffset * DAY : null;
          const daysUntil = expiryDate !== null ? Math.round((expiryDate - BASE) / DAY) : null;
          let expiry_status: "ok" | "warning" | "critical" | "expired" = "ok";
          if (daysUntil !== null) {
            if (daysUntil < 0) expiry_status = "expired";
            else if (daysUntil < 7) expiry_status = "critical";
            else if (daysUntil < 30) expiry_status = "warning";
          }
          return {
            id, product_id: productId, batch_number: batchNum,
            lot_code: lotCode, quantity: qty, unit_cost_cents: costCents,
            expiry_date: expiryDate, received_at: BASE - 20 * DAY,
            supplier_name: supplier, location_name: "Main Floor",
            notes, expiry_status, days_until_expiry: daysUntil,
            created_at: BASE - 20 * DAY, updated_at: BASE - 5 * DAY,
          };
        }

        let expiryBatches = [
          makeExpiry("batch_p1_1","prod_1","LOT-2024-001",48,80,-3,"CoreDist","L-001"),
          makeExpiry("batch_p1_2","prod_1","LOT-2024-002",120,78,15,"CoreDist","L-002"),
          makeExpiry("batch_p1_3","prod_1","LOT-2024-003",60,82,45,"CoreDist","L-003"),
          makeExpiry("batch_p2_1","prod_2","LOT-2024-010",24,130,4,"KeHE","L-010","Check dates"),
          makeExpiry("batch_p2_2","prod_2","LOT-2024-011",36,128,60,"KeHE","L-011"),
          makeExpiry("batch_p3_1","prod_3","LOT-2024-020",72,100,null,"Sysco",null),
          makeExpiry("batch_p4_1","prod_4","LOT-2024-030",18,240,22,"NatFoods","L-030"),
          makeExpiry("batch_p5_1","prod_5","LOT-2024-040",100,820,null,null,null,"Tobacco — no expiry"),
        ];

        return [
          http.get(`${V1}/catalog/:id/expiry`, async ({ params }) => {
            await lat();
            const productId = String(params["id"]);
            const items = expiryBatches.filter((b) => b.product_id === productId);
            return HttpResponse.json({ items, total: items.length });
          }),

          http.post(`${V1}/catalog/:id/expiry`, async ({ params, request }) => {
            await lat();
            const productId = String(params["id"]);
            const b = (await request.json()) as Record<string, unknown>;
            const expiryDate = b.expiry_date ? Number(b.expiry_date) : null;
            const daysUntil = expiryDate ? Math.round((expiryDate - Date.now()) / DAY) : null;
            let expiry_status: "ok" | "warning" | "critical" | "expired" = "ok";
            if (daysUntil !== null) {
              if (daysUntil < 0) expiry_status = "expired";
              else if (daysUntil < 7) expiry_status = "critical";
              else if (daysUntil < 30) expiry_status = "warning";
            }
            const batch = {
              id: `batch_${++batchSeq}`, product_id: productId,
              batch_number: String(b.batch_number ?? `LOT-${Date.now()}`),
              lot_code: (b.lot_code as string | null) ?? null,
              quantity: Number(b.quantity ?? 0),
              unit_cost_cents: Number(b.unit_cost_cents ?? 0),
              expiry_date: expiryDate, received_at: Date.now(),
              supplier_name: (b.supplier_name as string | null) ?? null,
              location_name: (b.location_name as string | null) ?? "Main Floor",
              notes: (b.notes as string | null) ?? null,
              expiry_status, days_until_expiry: daysUntil,
              created_at: Date.now(), updated_at: Date.now(),
            };
            expiryBatches.push(batch);
            return HttpResponse.json(batch, { status: 201 });
          }),

          http.patch(`${V1}/catalog/:id/expiry/:batchId`, async ({ params, request }) => {
            await lat();
            const batchId = String(params["batchId"]);
            const b = (await request.json()) as Record<string, unknown>;
            const idx = expiryBatches.findIndex((x) => x.id === batchId);
            if (idx === -1) return HttpResponse.json({ error: "not_found" }, { status: 404 });
            expiryBatches[idx] = { ...expiryBatches[idx], ...b, updated_at: Date.now() };
            return HttpResponse.json(expiryBatches[idx]);
          }),

          http.delete(`${V1}/catalog/:id/expiry/:batchId`, async ({ params }) => {
            await lat();
            const batchId = String(params["batchId"]);
            const before = expiryBatches.length;
            expiryBatches = expiryBatches.filter((x) => x.id !== batchId);
            if (expiryBatches.length === before) return HttpResponse.json({ error: "not_found" }, { status: 404 });
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Sales history per product ──────────────────────────────────────────
      ...(() => {
        const BASE = Date.now();
        const DAY = 86_400_000;
        const cashiers = ["Alex T.","Maria S.","John D.","Sara K."];
        const methods = ["cash","card","gift_card","split"];

        function makeSale(id: string, productId: string, saleId: string, saleNum: string,
          daysAgo: number, qty: number, unitCents: number, taxCents: number,
          customer: string | null, cashierIdx: number) {
          const discountCents = 0;
          return {
            id, product_id: productId, sale_id: saleId, sale_number: saleNum,
            date: BASE - daysAgo * DAY, quantity: qty,
            unit_price_cents: unitCents, discount_cents: discountCents,
            tax_cents: taxCents, total_cents: qty * unitCents - discountCents + taxCents,
            customer_name: customer, cashier_name: cashiers[cashierIdx % cashiers.length],
            outlet_name: "Main Outlet", payment_method: methods[Math.floor(Math.random() * methods.length)],
          };
        }

        const salesData = [
          makeSale("sl_p1_1","prod_1","sale_001","SALE-0001",1,3,199,5,"Jane Doe",0),
          makeSale("sl_p1_2","prod_1","sale_002","SALE-0002",3,1,199,2,null,1),
          makeSale("sl_p1_3","prod_1","sale_003","SALE-0003",5,5,199,8,"Bob Smith",2),
          makeSale("sl_p1_4","prod_1","sale_004","SALE-0004",8,2,199,3,"Alice J.",3),
          makeSale("sl_p1_5","prod_1","sale_005","SALE-0005",12,4,199,7,null,0),
          makeSale("sl_p1_6","prod_1","sale_006","SALE-0006",15,1,199,2,"Tom K.",1),
          makeSale("sl_p1_7","prod_1","sale_007","SALE-0007",20,6,199,10,null,2),
          makeSale("sl_p2_1","prod_2","sale_008","SALE-0008",2,2,349,6,"Jane Doe",0),
          makeSale("sl_p2_2","prod_2","sale_009","SALE-0009",4,1,349,3,null,1),
          makeSale("sl_p3_1","prod_3","sale_010","SALE-0010",1,4,299,10,"Bob Smith",2),
          makeSale("sl_p3_2","prod_3","sale_011","SALE-0011",6,2,299,5,null,3),
          makeSale("sl_p4_1","prod_4","sale_012","SALE-0012",3,1,599,10,"Alice J.",0),
          makeSale("sl_p5_1","prod_5","sale_013","SALE-0013",2,3,1299,0,null,1),
          makeSale("sl_p5_2","prod_5","sale_014","SALE-0014",7,5,1299,0,"Tom K.",2),
          makeSale("sl_p7_1","prod_7","sale_015","SALE-0015",1,2,1499,0,null,0),
        ];

        return [
          http.get(`${V1}/catalog/:id/sales`, async ({ params, request }) => {
            await lat();
            const productId = String(params["id"]);
            const url = new URL(request.url);
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const all = salesData.filter((s) => s.product_id === productId)
              .sort((a, b) => b.date - a.date);
            const items = all.slice(offset, offset + limit);
            const totalRevenue = all.reduce((s, r) => s + r.total_cents, 0);
            const totalUnits = all.reduce((s, r) => s + r.quantity, 0);
            return HttpResponse.json({ items, total: all.length, total_units_sold: totalUnits, total_revenue_cents: totalRevenue });
          }),
        ];
      })(),

      // ── Returns per product ────────────────────────────────────────────────
      ...(() => {
        const BASE = Date.now();
        const DAY = 86_400_000;
        const reasons = ["defective","customer_changed_mind","wrong_item","expired","damaged","other"] as const;

        const returnsData = [
          { id:"ret_p1_1", product_id:"prod_1", return_id:"rtn_001", return_number:"RTN-0001", original_sale_id:"sale_001", original_sale_number:"SALE-0001", date:BASE-1*DAY, quantity:1, unit_price_cents:199, refund_cents:199, reason:"defective" as const, notes:"Leaking bottle", customer_name:"Jane Doe", cashier_name:"Alex T.", status:"approved" as const },
          { id:"ret_p1_2", product_id:"prod_1", return_id:"rtn_002", return_number:"RTN-0002", original_sale_id:"sale_003", original_sale_number:"SALE-0003", date:BASE-5*DAY, quantity:2, unit_price_cents:199, refund_cents:398, reason:"wrong_item" as const, notes:null, customer_name:"Bob Smith", cashier_name:"Maria S.", status:"restocked" as const },
          { id:"ret_p2_1", product_id:"prod_2", return_id:"rtn_003", return_number:"RTN-0003", original_sale_id:"sale_008", original_sale_number:"SALE-0008", date:BASE-2*DAY, quantity:1, unit_price_cents:349, refund_cents:349, reason:"customer_changed_mind" as const, notes:null, customer_name:"Jane Doe", cashier_name:"John D.", status:"approved" as const },
          { id:"ret_p3_1", product_id:"prod_3", return_id:"rtn_004", return_number:"RTN-0004", original_sale_id:null, original_sale_number:null, date:BASE-10*DAY, quantity:1, unit_price_cents:299, refund_cents:299, reason:"expired" as const, notes:"Past best-by date", customer_name:null, cashier_name:"Sara K.", status:"pending" as const },
          { id:"ret_p5_1", product_id:"prod_5", return_id:"rtn_005", return_number:"RTN-0005", original_sale_id:"sale_013", original_sale_number:"SALE-0013", date:BASE-3*DAY, quantity:1, unit_price_cents:1299, refund_cents:1299, reason:"damaged" as const, notes:"Packaging damaged", customer_name:null, cashier_name:"Alex T.", status:"rejected" as const },
        ];

        return [
          http.get(`${V1}/catalog/:id/returns`, async ({ params, request }) => {
            await lat();
            const productId = String(params["id"]);
            const url = new URL(request.url);
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const all = returnsData.filter((r) => r.product_id === productId)
              .sort((a, b) => b.date - a.date);
            const items = all.slice(offset, offset + limit);
            const totalUnits = all.reduce((s, r) => s + r.quantity, 0);
            const totalRefunded = all.reduce((s, r) => s + r.refund_cents, 0);
            return HttpResponse.json({ items, total: all.length, total_units_returned: totalUnits, total_refunded_cents: totalRefunded });
          }),
        ];
      })(),

      // ── Credits per product ───────────────────────────────────────────────
      ...(() => {
        const BASE = Date.now();
        const DAY = 86_400_000;

        const creditsData = [
          { id:"crd_p1_1", product_id:"prod_1", credit_note_id:"cn_001", credit_number:"CN-2024-001", date:BASE-2*DAY, amount_cents:199, reason:"Product defect refund", notes:"Leaking bottle batch LOT-001", customer_name:"Jane Doe", status:"applied" as const, expires_at:BASE+60*DAY },
          { id:"crd_p1_2", product_id:"prod_1", credit_note_id:"cn_002", credit_number:"CN-2024-002", date:BASE-10*DAY, amount_cents:398, reason:"Wrong item shipped", notes:null, customer_name:"Bob Smith", status:"issued" as const, expires_at:BASE+90*DAY },
          { id:"crd_p2_1", product_id:"prod_2", credit_note_id:"cn_003", credit_number:"CN-2024-003", date:BASE-15*DAY, amount_cents:349, reason:"Goodwill credit", notes:"Customer complaint resolution", customer_name:"Jane Doe", status:"applied" as const, expires_at:null },
          { id:"crd_p3_1", product_id:"prod_3", credit_note_id:"cn_004", credit_number:"CN-2024-004", date:BASE-30*DAY, amount_cents:149, reason:"Expired stock credit", notes:null, customer_name:null, status:"expired" as const, expires_at:BASE-1*DAY },
          { id:"crd_p5_1", product_id:"prod_5", credit_note_id:"cn_005", credit_number:"CN-2024-005", date:BASE-5*DAY, amount_cents:1299, reason:"Damaged in transit", notes:"Supplier credit applied", customer_name:null, status:"issued" as const, expires_at:BASE+120*DAY },
        ];

        return [
          http.get(`${V1}/catalog/:id/credits`, async ({ params, request }) => {
            await lat();
            const productId = String(params["id"]);
            const url = new URL(request.url);
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const all = creditsData.filter((c) => c.product_id === productId)
              .sort((a, b) => b.date - a.date);
            const items = all.slice(offset, offset + limit);
            const totalCredits = all.filter((c) => (c.status as string) !== "expired" && (c.status as string) !== "voided")
              .reduce((s, c) => s + c.amount_cents, 0);
            return HttpResponse.json({ items, total: all.length, total_credits_cents: totalCredits });
          }),
        ];
      })(),

      // ── Invoices / PO history per product ────────────────────────────────
      ...(() => {
        const BASE = Date.now();
        const DAY = 86_400_000;

        const invoicesData = [
          { id:"inv_p1_1", product_id:"prod_1", po_id:"po_001", po_number:"PO-2024-001", invoice_number:"INV-2024-001", date:BASE-60*DAY, quantity:200, unit_cost_cents:80, total_cost_cents:16000, supplier_name:"CoreDist", status:"received" as const, expiry_date:BASE+15*DAY, lot_code:"L-001" },
          { id:"inv_p1_2", product_id:"prod_1", po_id:"po_002", po_number:"PO-2024-015", invoice_number:"INV-2024-015", date:BASE-30*DAY, quantity:180, unit_cost_cents:82, total_cost_cents:14760, supplier_name:"CoreDist", status:"invoiced" as const, expiry_date:BASE+45*DAY, lot_code:"L-002" },
          { id:"inv_p1_3", product_id:"prod_1", po_id:"po_003", po_number:"PO-2024-030", invoice_number:null, date:BASE-5*DAY, quantity:120, unit_cost_cents:80, total_cost_cents:9600, supplier_name:"CoreDist", status:"partial" as const, expiry_date:null, lot_code:null },
          { id:"inv_p2_1", product_id:"prod_2", po_id:"po_004", po_number:"PO-2024-005", invoice_number:"INV-2024-005", date:BASE-45*DAY, quantity:96, unit_cost_cents:130, total_cost_cents:12480, supplier_name:"KeHE", status:"received" as const, expiry_date:BASE+4*DAY, lot_code:"L-010" },
          { id:"inv_p2_2", product_id:"prod_2", po_id:"po_005", po_number:"PO-2024-025", invoice_number:"INV-2024-025", date:BASE-10*DAY, quantity:60, unit_cost_cents:128, total_cost_cents:7680, supplier_name:"KeHE", status:"invoiced" as const, expiry_date:BASE+60*DAY, lot_code:"L-011" },
          { id:"inv_p3_1", product_id:"prod_3", po_id:"po_006", po_number:"PO-2024-010", invoice_number:"INV-2024-010", date:BASE-20*DAY, quantity:144, unit_cost_cents:100, total_cost_cents:14400, supplier_name:"Sysco", status:"received" as const, expiry_date:null, lot_code:null },
          { id:"inv_p4_1", product_id:"prod_4", po_id:"po_007", po_number:"PO-2024-012", invoice_number:null, date:BASE-7*DAY, quantity:48, unit_cost_cents:240, total_cost_cents:11520, supplier_name:"NatFoods", status:"pending" as const, expiry_date:BASE+22*DAY, lot_code:"L-030" },
          { id:"inv_p5_1", product_id:"prod_5", po_id:"po_008", po_number:"PO-2024-020", invoice_number:"INV-2024-020", date:BASE-90*DAY, quantity:500, unit_cost_cents:820, total_cost_cents:410000, supplier_name:"TobaccoNet", status:"invoiced" as const, expiry_date:null, lot_code:null },
          { id:"inv_p7_1", product_id:"prod_7", po_id:"po_009", po_number:"PO-2024-028", invoice_number:"INV-2024-028", date:BASE-14*DAY, quantity:200, unit_cost_cents:600, total_cost_cents:120000, supplier_name:"VapeWholesale", status:"received" as const, expiry_date:null, lot_code:null },
        ];

        return [
          http.get(`${V1}/catalog/:id/invoices`, async ({ params, request }) => {
            await lat();
            const productId = String(params["id"]);
            const url = new URL(request.url);
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const offset = Number(url.searchParams.get("offset") ?? 0);
            const all = invoicesData.filter((i) => i.product_id === productId)
              .sort((a, b) => b.date - a.date);
            const items = all.slice(offset, offset + limit);
            const totalUnits = all.reduce((s, i) => s + i.quantity, 0);
            const totalCost = all.reduce((s, i) => s + i.total_cost_cents, 0);
            return HttpResponse.json({ items, total: all.length, total_units_ordered: totalUnits, total_cost_cents: totalCost });
          }),
        ];
      })(),

      // ── Catalog: Pricing ──────────────────────────────────────────────────
      ...(() => {
        interface PriceTier { id: string; product_id: string; min_qty: number; price_cents: number; label: string | null; created_at: number; }
        interface PriceBookEntry { id: string; price_book_id: string; price_book_name: string; price_cents: number; active: boolean; }
        const tiers: PriceTier[] = [
          { id: "pt_1", product_id: "prod_1", min_qty: 6,  price_cents: 2099, label: "6-pack",   created_at: Date.now() - 864e5 * 10 },
          { id: "pt_2", product_id: "prod_1", min_qty: 12, price_cents: 1899, label: "Case",      created_at: Date.now() - 864e5 * 8  },
          { id: "pt_3", product_id: "prod_2", min_qty: 5,  price_cents: 3499, label: "5-pack",   created_at: Date.now() - 864e5 * 5  },
        ];
        const priceBooks: PriceBookEntry[] = [
          { id: "pbe_1", price_book_id: "pb_wholesale", price_book_name: "Wholesale",        price_cents: 1799, active: true  },
          { id: "pbe_2", price_book_id: "pb_vip",       price_book_name: "VIP Members",      price_cents: 2299, active: true  },
          { id: "pbe_3", price_book_id: "pb_b2b",       price_book_name: "B2B Contract",     price_cents: 1699, active: false },
        ];
        const productMeta: Record<string, { wholesale_price_cents: number | null; map_price_cents: number | null }> = {
          prod_1: { wholesale_price_cents: 1800, map_price_cents: 2400 },
          prod_2: { wholesale_price_cents: 3200, map_price_cents: null },
        };
        let tierSeq = 10;
        return [
          http.get(`${V1}/catalog/:id/pricing`, async ({ params }) => {
            await lat();
            const pid = String(params["id"]);
            const meta = productMeta[pid] ?? { wholesale_price_cents: null, map_price_cents: null };
            return HttpResponse.json({ tiers: tiers.filter((t) => t.product_id === pid), price_books: priceBooks, ...meta });
          }),
          http.patch(`${V1}/catalog/:id/pricing`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const b = (await request.json()) as { wholesale_price_cents?: number | null; map_price_cents?: number | null };
            productMeta[pid] = { ...(productMeta[pid] ?? { wholesale_price_cents: null, map_price_cents: null }), ...b };
            return HttpResponse.json({ ok: true });
          }),
          http.post(`${V1}/catalog/:id/pricing/tiers`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const b = (await request.json()) as { min_qty?: number; price_cents?: number; label?: string | null };
            const tier: PriceTier = { id: `pt_${++tierSeq}`, product_id: pid, min_qty: b.min_qty ?? 1, price_cents: b.price_cents ?? 0, label: b.label ?? null, created_at: Date.now() };
            tiers.push(tier);
            return HttpResponse.json(tier, { status: 201 });
          }),
          http.delete(`${V1}/catalog/:id/pricing/tiers/:tid`, async ({ params }) => {
            await lat();
            const idx = tiers.findIndex((t) => t.id === String(params["tid"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            tiers.splice(idx, 1);
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Catalog: Suppliers per product ────────────────────────────────────
      ...(() => {
        interface ProductSupplier {
          id: string; product_id: string; vendor_id: string; vendor_name: string;
          vendor_sku: string | null; cost_cents: number | null; lead_time_days: number | null;
          moq: number | null; case_pack: number | null; is_preferred: boolean; notes: string | null;
          created_at: number; updated_at: number;
        }
        const productSuppliers: ProductSupplier[] = [
          { id: "ps_1", product_id: "prod_1", vendor_id: "ven_1", vendor_name: "Acme Distributors",  vendor_sku: "ACM-0042",  cost_cents: 1400, lead_time_days: 3,  moq: 6,  case_pack: 12, is_preferred: true,  notes: "Primary supplier — best pricing at 6+ units", created_at: Date.now() - 864e5 * 30, updated_at: Date.now() - 864e5 * 2 },
          { id: "ps_2", product_id: "prod_1", vendor_id: "ven_2", vendor_name: "Global Supply Co",   vendor_sku: "GS-11209",  cost_cents: 1550, lead_time_days: 7,  moq: 12, case_pack: 12, is_preferred: false, notes: null,                                              created_at: Date.now() - 864e5 * 20, updated_at: Date.now() - 864e5 * 5 },
          { id: "ps_3", product_id: "prod_2", vendor_id: "ven_1", vendor_name: "Acme Distributors",  vendor_sku: "ACM-0088",  cost_cents: 3100, lead_time_days: 5,  moq: 1,  case_pack: 6,  is_preferred: true,  notes: null,                                              created_at: Date.now() - 864e5 * 15, updated_at: Date.now() - 864e5 * 1 },
        ];
        let supSeq = 10;
        return [
          http.get(`${V1}/catalog/:id/suppliers`, async ({ params }) => {
            await lat();
            const pid = String(params["id"]);
            return HttpResponse.json({ items: productSuppliers.filter((s) => s.product_id === pid) });
          }),
          http.post(`${V1}/catalog/:id/suppliers`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const b = (await request.json()) as Partial<ProductSupplier>;
            const now = Date.now();
            const s: ProductSupplier = { id: `ps_${++supSeq}`, product_id: pid, vendor_id: b.vendor_id ?? `ven_${supSeq}`, vendor_name: b.vendor_name ?? "New Vendor", vendor_sku: b.vendor_sku ?? null, cost_cents: b.cost_cents ?? null, lead_time_days: b.lead_time_days ?? null, moq: b.moq ?? null, case_pack: b.case_pack ?? null, is_preferred: b.is_preferred ?? false, notes: b.notes ?? null, created_at: now, updated_at: now };
            if (s.is_preferred) productSuppliers.filter((x) => x.product_id === pid).forEach((x) => { x.is_preferred = false; });
            productSuppliers.push(s);
            return HttpResponse.json(s, { status: 201 });
          }),
          http.patch(`${V1}/catalog/:id/suppliers/:sid`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const idx = productSuppliers.findIndex((s) => s.id === String(params["sid"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const b = (await request.json()) as Partial<ProductSupplier>;
            if (b.is_preferred) productSuppliers.filter((x) => x.product_id === pid).forEach((x) => { x.is_preferred = false; });
            productSuppliers[idx] = { ...productSuppliers[idx], ...b, updated_at: Date.now() };
            return HttpResponse.json(productSuppliers[idx]);
          }),
          http.delete(`${V1}/catalog/:id/suppliers/:sid`, async ({ params }) => {
            await lat();
            const idx = productSuppliers.findIndex((s) => s.id === String(params["sid"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            productSuppliers.splice(idx, 1);
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Catalog: Purchase History per product ─────────────────────────────
      http.get(`${V1}/catalog/:id/purchases`, async ({ params, request }) => {
        await lat();
        const pid = String(params["id"]);
        const url = new URL(request.url);
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const BASE   = Date.now();
        const all = [
          { id: "pol_1", product_id: pid, po_id: "po_101", po_number: "PO-2025-101", vendor_name: "Acme Distributors",  ordered_at: BASE - 864e5 * 60, received_at: BASE - 864e5 * 57, qty_ordered: 48, qty_received: 48, unit_cost_cents: 1400, total_cost_cents: 67200, status: "received" },
          { id: "pol_2", product_id: pid, po_id: "po_089", po_number: "PO-2025-089", vendor_name: "Acme Distributors",  ordered_at: BASE - 864e5 * 90, received_at: BASE - 864e5 * 86, qty_ordered: 24, qty_received: 24, unit_cost_cents: 1420, total_cost_cents: 34080, status: "received" },
          { id: "pol_3", product_id: pid, po_id: "po_112", po_number: "PO-2025-112", vendor_name: "Global Supply Co",   ordered_at: BASE - 864e5 * 14, received_at: null,              qty_ordered: 60, qty_received: 0,  unit_cost_cents: 1550, total_cost_cents: 93000, status: "ordered"  },
        ];
        const items = all.slice(offset, offset + limit);
        const totalQty  = all.reduce((s, r) => s + r.qty_received, 0);
        const totalCost = all.reduce((s, r) => s + (r.qty_received * r.unit_cost_cents), 0);
        return HttpResponse.json({ items, total: all.length, total_qty_received: totalQty, total_cost_cents: totalCost });
      }),

      // ── Catalog: Analytics per product ───────────────────────────────────
      http.get(`${V1}/catalog/:id/analytics`, async ({ params, request }) => {
        await lat();
        const url    = new URL(request.url);
        const period = url.searchParams.get("period") ?? "30d";
        const days   = period === "7d" ? 7 : period === "90d" ? 90 : period === "12m" ? 365 : 30;
        const BASE   = Date.now();
        const trend = Array.from({ length: days }, (_, i) => {
          const date = BASE - 864e5 * (days - 1 - i);
          const units = Math.floor(Math.random() * 15 + 2);
          const revenue_cents = units * (2499 + Math.floor(Math.random() * 200 - 100));
          return { date, units, revenue_cents };
        });
        const totalUnits   = trend.reduce((s, d) => s + d.units, 0);
        const totalRevenue = trend.reduce((s, d) => s + d.revenue_cents, 0);
        const totalCost    = totalUnits * 1400;
        const grossMargin  = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
        return HttpResponse.json({
          period, trend,
          summary: {
            revenue_cents: totalRevenue, units_sold: totalUnits, orders: Math.floor(totalUnits / 3),
            avg_order_qty: 3, return_rate_pct: 1.8, gross_margin_pct: Math.round(grossMargin * 10) / 10,
            inventory_turnover: 4.2, abc_class: "A",
          },
        });
      }),

      // ── Catalog: Audit Log per product ────────────────────────────────────
      http.get(`${V1}/catalog/:id/audit-log`, async ({ params, request }) => {
        await lat();
        const pid = String(params["id"]);
        const url    = new URL(request.url);
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const BASE   = Date.now();
        const all = [
          { id: "pal_1", product_id: pid, actor: "Sarah Kim",      actor_role: "manager", action: "update", field: "price_cents",       old_value: "2299", new_value: "2499", reason: "Q4 price adjustment", ip: "192.168.1.12", device: "MacBook Pro", created_at: BASE - 864e5 * 2  },
          { id: "pal_2", product_id: pid, actor: "Marcus Chen",    actor_role: "manager", action: "update", field: "status",            old_value: "draft", new_value: "active", reason: null,                    ip: "192.168.1.8",  device: "iPad",        created_at: BASE - 864e5 * 5  },
          { id: "pal_3", product_id: pid, actor: "Sarah Kim",      actor_role: "manager", action: "update", field: "raw_cost_price_cents", old_value: "1350", new_value: "1400", reason: "Cost update from PO",   ip: "192.168.1.12", device: "MacBook Pro", created_at: BASE - 864e5 * 12 },
          { id: "pal_4", product_id: pid, actor: "Admin",          actor_role: "owner",   action: "update", field: "reorder_point",     old_value: "10",   new_value: "15",   reason: null,                    ip: "192.168.1.1",  device: "Desktop",     created_at: BASE - 864e5 * 20 },
          { id: "pal_5", product_id: pid, actor: "James Rivera",   actor_role: "staff",   action: "create", field: null,               old_value: null,   new_value: null,   reason: "Initial product creation", ip: "192.168.1.5",  device: "Terminal",    created_at: BASE - 864e5 * 30 },
          { id: "pal_6", product_id: pid, actor: "Sarah Kim",      actor_role: "manager", action: "update", field: "barcode",            old_value: "",     new_value: "0123456789012", reason: null,            ip: "192.168.1.12", device: "MacBook Pro", created_at: BASE - 864e5 * 8  },
          { id: "pal_7", product_id: pid, actor: "Marcus Chen",    actor_role: "manager", action: "update", field: "track_inventory",   old_value: "false", new_value: "true", reason: "Enable tracking",        ip: "192.168.1.8",  device: "iPad",        created_at: BASE - 864e5 * 18 },
        ].sort((a, b) => b.created_at - a.created_at);
        return HttpResponse.json({ items: all.slice(offset, offset + limit), total: all.length });
      }),

      // ── Catalog: Images per product ───────────────────────────────────────
      ...(() => {
        interface ProductImage { id: string; product_id: string; url: string; alt: string | null; sort_order: number; is_primary: boolean; created_at: number; }
        const productImages: ProductImage[] = [
          { id: "img_1", product_id: "prod_1", url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400", alt: "Product front view",  sort_order: 0, is_primary: true,  created_at: Date.now() - 864e5 * 10 },
          { id: "img_2", product_id: "prod_1", url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=60", alt: "Product side view", sort_order: 1, is_primary: false, created_at: Date.now() - 864e5 * 9  },
          { id: "img_3", product_id: "prod_2", url: "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=400", alt: "Product main",       sort_order: 0, is_primary: true,  created_at: Date.now() - 864e5 * 7  },
        ];
        let imgSeq = 10;
        return [
          http.get(`${V1}/catalog/:id/images`, async ({ params }) => {
            await lat();
            const pid = String(params["id"]);
            return HttpResponse.json({ items: productImages.filter((i) => i.product_id === pid).sort((a, b) => a.sort_order - b.sort_order) });
          }),
          http.post(`${V1}/catalog/:id/images`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const b   = (await request.json()) as { url?: string; alt?: string | null };
            if (!b.url) return HttpResponse.json({ error: { code: "bad_request", message: "url required" } }, { status: 400 });
            const existing = productImages.filter((i) => i.product_id === pid);
            const img: ProductImage = { id: `img_${++imgSeq}`, product_id: pid, url: b.url, alt: b.alt ?? null, sort_order: existing.length, is_primary: existing.length === 0, created_at: Date.now() };
            productImages.push(img);
            return HttpResponse.json(img, { status: 201 });
          }),
          http.patch(`${V1}/catalog/:id/images/:imgId`, async ({ params, request }) => {
            await lat();
            const pid = String(params["id"]);
            const idx = productImages.findIndex((i) => i.id === String(params["imgId"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const b = (await request.json()) as Partial<ProductImage>;
            if (b.is_primary) productImages.filter((i) => i.product_id === pid).forEach((i) => { i.is_primary = false; });
            productImages[idx] = { ...productImages[idx], ...b };
            return HttpResponse.json(productImages[idx]);
          }),
          http.delete(`${V1}/catalog/:id/images/:imgId`, async ({ params }) => {
            await lat();
            const idx = productImages.findIndex((i) => i.id === String(params["imgId"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            productImages.splice(idx, 1);
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Catalog: Sales by Customer ────────────────────────────────────────
      http.get(`${V1}/catalog/:id/sales-by-customer`, async ({ params, request }) => {
        await lat();
        const url    = new URL(request.url);
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const BASE   = Date.now();
        const all = [
          { id: "sbc_1", customer_id: "cust_1", customer_name: "Emma Johnson",    customer_type: "retail",    order_id: "ord_201", order_number: "ORD-2026-201", order_date: BASE - 864e5 * 2,  outlet: "Main Store",   qty_bought: 2,  unit_price_cents: 2499, discount_cents: 0,   tax_cents: 399,  total_cents: 5397,  margin_pct: 44.0, returned_qty: 0, last_purchase_date: BASE - 864e5 * 2  },
          { id: "sbc_2", customer_id: "cust_2", customer_name: "Marcus Rodriguez", customer_type: "wholesale", order_id: "ord_189", order_number: "ORD-2026-189", order_date: BASE - 864e5 * 5,  outlet: "Warehouse",    qty_bought: 12, unit_price_cents: 1799, discount_cents: 1000, tax_cents: 0,    total_cents: 20588, margin_pct: 22.2, returned_qty: 0, last_purchase_date: BASE - 864e5 * 5  },
          { id: "sbc_3", customer_id: "cust_3", customer_name: "Priya Patel",      customer_type: "retail",    order_id: "ord_177", order_number: "ORD-2026-177", order_date: BASE - 864e5 * 9,  outlet: "Main Store",   qty_bought: 1,  unit_price_cents: 2499, discount_cents: 250, tax_cents: 180,  total_cents: 2429,  margin_pct: 40.1, returned_qty: 1, last_purchase_date: BASE - 864e5 * 9  },
          { id: "sbc_4", customer_id: "cust_4", customer_name: "James Liu",        customer_type: "retail",    order_id: "ord_165", order_number: "ORD-2026-165", order_date: BASE - 864e5 * 14, outlet: "South Branch", qty_bought: 3,  unit_price_cents: 2499, discount_cents: 0,   tax_cents: 599,  total_cents: 8096,  margin_pct: 44.0, returned_qty: 0, last_purchase_date: BASE - 864e5 * 14 },
          { id: "sbc_5", customer_id: "cust_2", customer_name: "Marcus Rodriguez", customer_type: "wholesale", order_id: "ord_142", order_number: "ORD-2026-142", order_date: BASE - 864e5 * 21, outlet: "Warehouse",    qty_bought: 24, unit_price_cents: 1799, discount_cents: 2400, tax_cents: 0,    total_cents: 40776, margin_pct: 20.8, returned_qty: 0, last_purchase_date: BASE - 864e5 * 5  },
          { id: "sbc_6", customer_id: "cust_5", customer_name: "Olivia Chen",      customer_type: "retail",    order_id: "ord_130", order_number: "ORD-2026-130", order_date: BASE - 864e5 * 28, outlet: "Main Store",   qty_bought: 2,  unit_price_cents: 2499, discount_cents: 0,   tax_cents: 399,  total_cents: 5397,  margin_pct: 44.0, returned_qty: 0, last_purchase_date: BASE - 864e5 * 28 },
        ];
        const totalRevenue = all.reduce((s, r) => s + r.total_cents, 0);
        const totalQty     = all.reduce((s, r) => s + r.qty_bought, 0);
        const totalReturns = all.reduce((s, r) => s + r.returned_qty, 0);
        return HttpResponse.json({ items: all.slice(offset, offset + limit), total: all.length, summary: { total_revenue_cents: totalRevenue, total_qty: totalQty, total_returns: totalReturns, unique_customers: new Set(all.map((r) => r.customer_id)).size } });
      }),

      // ── Catalog: Reorder Suggestions ─────────────────────────────────────
      http.get(`${V1}/catalog/:id/reorder-suggestions`, async () => {
        await lat();
        const BASE = Date.now();
        return HttpResponse.json({
          current_stock: 18,
          reserved_stock: 4,
          available_stock: 14,
          incoming_stock: 0,
          reorder_point: 20,
          safety_stock: 10,
          avg_daily_sales: 3.2,
          days_until_stockout: 4,
          suggested_qty: 48,
          preferred_supplier_id: "ven_1",
          preferred_supplier_name: "Acme Distributors",
          preferred_supplier_lead_days: 3,
          preferred_supplier_cost_cents: 1400,
          best_price_supplier_id: "ven_2",
          best_price_supplier_name: "Global Supply Co",
          best_price_supplier_cost_cents: 1320,
          savings_per_unit_cents: 80,
          reason: "Stock below reorder point (18 < 20). At current sales velocity, stockout in ~4 days.",
          last_reorder_date: BASE - 864e5 * 60,
          open_po_qty: 0,
          status: "suggested",
        });
      }),

      // ── Catalog: Supplier Price Comparison ───────────────────────────────
      http.get(`${V1}/catalog/:id/supplier-price-comparison`, async () => {
        await lat();
        const BASE = Date.now();
        return HttpResponse.json({
          items: [
            { supplier_id: "ven_1", supplier_name: "Acme Distributors",  is_preferred: true,  vendor_sku: "ACM-0042", last_purchase_date: BASE - 864e5 * 12, last_cost_cents: 1400, landed_cost_cents: 1480, moq: 6,  lead_time_days: 3,  price_30d_trend: "stable",   price_history: [{ date: BASE - 864e5 * 90, cost: 1420 }, { date: BASE - 864e5 * 60, cost: 1400 }, { date: BASE - 864e5 * 30, cost: 1400 }, { date: BASE, cost: 1400 }] },
            { supplier_id: "ven_2", supplier_name: "Global Supply Co",   is_preferred: false, vendor_sku: "GS-11209", last_purchase_date: BASE - 864e5 * 5,  last_cost_cents: 1320, landed_cost_cents: 1420, moq: 12, lead_time_days: 7,  price_30d_trend: "down",     price_history: [{ date: BASE - 864e5 * 90, cost: 1550 }, { date: BASE - 864e5 * 60, cost: 1480 }, { date: BASE - 864e5 * 30, cost: 1350 }, { date: BASE, cost: 1320 }] },
            { supplier_id: "ven_3", supplier_name: "Pacific Wholesale",  is_preferred: false, vendor_sku: "PW-8801",  last_purchase_date: BASE - 864e5 * 45, last_cost_cents: 1500, landed_cost_cents: 1560, moq: 24, lead_time_days: 10, price_30d_trend: "up",       price_history: [{ date: BASE - 864e5 * 90, cost: 1450 }, { date: BASE - 864e5 * 60, cost: 1480 }, { date: BASE - 864e5 * 30, cost: 1510 }, { date: BASE, cost: 1500 }] },
          ],
          best_price_supplier_id: "ven_2",
          current_retail_price_cents: 2499,
        });
      }),

    ];
  })(),

  // ── Webhooks (Settings → Webhooks) ────────────────────────────────────────
  http.get(`${V1}/webhooks`, async () => {
    await lat();
    return HttpResponse.json({ items: webhooks });
  }),
  http.post(`${V1}/webhooks`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { url?: string; eventTypes?: string[] };
    if (!b.url) return HttpResponse.json({ error: { code: "bad_request", message: "url required", requestId: rid() } }, { status: 400 });
    const sub = { id: `whk_${Math.random().toString(36).slice(2, 12)}`, tenant_id: "tnt_demo", url: b.url, event_types: b.eventTypes?.join(",") || "*", secret: Math.random().toString(36).slice(2), active: true, created_at: Date.now() };
    webhooks.push(sub);
    return HttpResponse.json(sub, { status: 201 });
  }),
  http.delete(`${V1}/webhooks/:id`, async ({ params }) => {
    await lat();
    webhooks = webhooks.filter((w) => w.id !== String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Fulfillment / WMS (Operations → Locations, Pick & Pack) ───────────────
  http.get(`${V1}/fulfillment/locations`, async () => {
    await lat();
    return HttpResponse.json({ items: [...locations].sort((a, b) => a.code.localeCompare(b.code)) });
  }),
  http.post(`${V1}/fulfillment/locations`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { code?: string; name?: string; kind?: string };
    if (!b.code) return HttpResponse.json({ error: { code: "bad_request", message: "code required", requestId: rid() } }, { status: 400 });
    if (locations.some((l) => l.code === b.code)) return HttpResponse.json({ error: { code: "duplicate", message: `location code '${b.code}' already exists`, requestId: rid() } }, { status: 409 });
    const loc = { id: `loc_${Math.random().toString(36).slice(2, 12)}`, tenant_id: "tnt_demo", code: b.code, name: b.name ?? null, kind: b.kind ?? "bin", created_at: Date.now() };
    locations.push(loc);
    return HttpResponse.json(loc, { status: 201 });
  }),
  http.post(`${V1}/fulfillment/assign`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { productId?: string; locationId?: string };
    if (!locations.some((l) => l.id === b.locationId)) return HttpResponse.json({ error: { code: "not_found", message: `location '${b.locationId}' not found`, requestId: rid() } }, { status: 404 });
    productLocations.set(String(b.productId), String(b.locationId));
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${V1}/fulfillment/pick-lists`, async () => {
    await lat();
    return HttpResponse.json({ items: [...pickLists].sort((a, b) => b.created_at - a.created_at) });
  }),
  http.post(`${V1}/fulfillment/pick-lists`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { orderId?: string };
    const existing = pickLists.find((p) => p.order_id === b.orderId);
    if (existing) return HttpResponse.json({ ...existing, lines: pickLines.get(existing.id) ?? [] });
    const id = `pik_${Math.random().toString(36).slice(2, 12)}`;
    const now = Date.now();
    // Demo: two lines resolved to their assigned location codes, sorted into a pick path.
    const lines = [
      { id: `pkl_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", pick_list_id: id, product_id: "prod_demo_b", name: "Bread", quantity: 3, picked_qty: 0, location_code: codeFor("prod_demo_b"), status: "pending" },
      { id: `pkl_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", pick_list_id: id, product_id: "prod_demo_a", name: "Apple", quantity: 2, picked_qty: 0, location_code: codeFor("prod_demo_a"), status: "pending" },
    ].sort((a, b2) => String(a.location_code ?? "~").localeCompare(String(b2.location_code ?? "~")));
    const pl = { id, tenant_id: "tnt_demo", order_id: String(b.orderId), status: "picking", created_at: now, updated_at: now };
    pickLists.push(pl);
    pickLines.set(id, lines);
    return HttpResponse.json({ ...pl, lines }, { status: 201 });
  }),
  http.get(`${V1}/fulfillment/pick-lists/:id`, async ({ params }) => {
    await lat();
    const pl = pickLists.find((p) => p.id === String(params.id));
    if (!pl) return HttpResponse.json({ error: { code: "not_found", message: "pick list not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json({ ...pl, lines: pickLines.get(pl.id) ?? [] });
  }),
  http.post(`${V1}/fulfillment/pick-lists/:id/lines/:lineId/pick`, async ({ params }) => {
    await lat();
    const pl = pickLists.find((p) => p.id === String(params.id));
    if (!pl) return HttpResponse.json({ error: { code: "not_found", message: "pick list not found", requestId: rid() } }, { status: 404 });
    const lines = pickLines.get(pl.id) ?? [];
    const line = lines.find((l) => l.id === String(params.lineId));
    if (line) { line.picked_qty = line.quantity; line.status = "picked"; }
    if (lines.every((l) => l.status === "picked")) { pl.status = "picked"; pl.updated_at = Date.now(); }
    return HttpResponse.json({ ...pl, lines });
  }),
  http.post(`${V1}/fulfillment/pick-lists/:id/pack`, async ({ params }) => {
    await lat();
    const pl = pickLists.find((p) => p.id === String(params.id));
    if (!pl) return HttpResponse.json({ error: { code: "not_found", message: "pick list not found", requestId: rid() } }, { status: 404 });
    const lines = pickLines.get(pl.id) ?? [];
    if (lines.some((l) => l.status !== "picked")) return HttpResponse.json({ error: { code: "not_picked", message: "all lines must be picked before packing", requestId: rid() } }, { status: 409 });
    pl.status = "packed"; pl.updated_at = Date.now();
    return HttpResponse.json({ ...pl, lines });
  }),
];

function codeFor(productId: string): string | null {
  const locId = productLocations.get(productId);
  return locations.find((l) => l.id === locId)?.code ?? null;
}

// ── Sales mock handlers (appended to the exported `handlers` array) ──────────
function resolveSalesLines(parentId: string, lines: any[], tier: number) {
  const pct = TIER_PCT[tier] ?? 0;
  let subtotal = 0, discount = 0;
  const out = lines.map((l: any) => {
    const unit = l.unitCents ?? 1000;
    const gross = unit * l.quantity;
    const lineDisc = Math.round((gross * pct) / 100);
    subtotal += gross; discount += lineDisc;
    return { id: `sln_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", parent_id: parentId, product_id: l.productId, name: l.name ?? "Item", quantity: l.quantity, unit_cents: unit, line_cents: gross - lineDisc };
  });
  return { out, subtotal, discount };
}

mockHandlers.push(
  http.post(`${V1}/sales/quotations`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const id = `qot_${Math.random().toString(36).slice(2, 12)}`;
    const { out, subtotal, discount } = resolveSalesLines(id, b.lines ?? [], 5);
    const now = Date.now();
    const q = { id, tenant_id: "tnt_demo", quote_number: `QT-${String(++qtSeq).padStart(5, "0")}`, customer_id: b.customerId, status: "draft", subtotal_cents: subtotal, discount_cents: discount, total_cents: subtotal - discount, sales_rep_id: b.salesRepId ?? null, store_id: b.storeId ?? null, valid_until: now + 30 * 86400000, created_at: now, updated_at: now };
    quotations.push(q); quoteLines.set(id, out);
    return HttpResponse.json({ ...q, lines: out }, { status: 201 });
  }),
  http.get(`${V1}/sales/quotations`, async () => { await lat(); return HttpResponse.json({ items: [...quotations].sort((a, b) => b.created_at - a.created_at) }); }),
  http.get(`${V1}/sales/quotations/:id`, async ({ params }) => {
    await lat();
    const q = quotations.find((x) => x.id === String(params.id));
    if (!q) return HttpResponse.json({ error: { code: "not_found", message: "quotation not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json({ ...q, lines: quoteLines.get(q.id) ?? [] });
  }),
  http.post(`${V1}/sales/quotations/:id/send`, async ({ params }) => { await lat(); const q = quotations.find((x) => x.id === String(params.id)); if (q) q.status = "sent"; return HttpResponse.json(q); }),
  http.post(`${V1}/sales/quotations/:id/accept`, async ({ params }) => { await lat(); const q = quotations.find((x) => x.id === String(params.id)); if (q) q.status = "accepted"; return HttpResponse.json(q); }),
  http.post(`${V1}/sales/quotations/:id/cancel`, async ({ params }) => { await lat(); const q = quotations.find((x) => x.id === String(params.id)); if (q) q.status = "cancelled"; return HttpResponse.json(q); }),
  http.post(`${V1}/sales/quotations/:id/convert`, async ({ params }) => {
    await lat();
    const q = quotations.find((x) => x.id === String(params.id));
    if (!q) return HttpResponse.json({ error: { code: "not_found", message: "quotation not found", requestId: rid() } }, { status: 404 });
    let so = salesOrders.find((s) => s.quotation_id === q.id);
    if (!so) {
      const id = `sso_${Math.random().toString(36).slice(2, 12)}`;
      const lines = (quoteLines.get(q.id) ?? []).map((l) => ({ ...l, id: `sln_${Math.random().toString(36).slice(2, 10)}`, parent_id: id }));
      const now = Date.now();
      so = { id, tenant_id: "tnt_demo", so_number: `SO-${String(++soSeq).padStart(5, "0")}`, quotation_id: q.id, customer_id: q.customer_id, status: "pending_approve", subtotal_cents: q.subtotal_cents, discount_cents: q.discount_cents, total_cents: q.total_cents, sales_rep_id: q.sales_rep_id, picker_id: null, store_id: q.store_id, created_at: now, updated_at: now };
      salesOrders.push(so); soLines.set(id, lines); q.status = "accepted";
    }
    return HttpResponse.json({ ...so, lines: soLines.get(so.id) ?? [] }, { status: 201 });
  }),
  http.post(`${V1}/sales/sales-orders`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const id = `sso_${Math.random().toString(36).slice(2, 12)}`;
    const { out, subtotal, discount } = resolveSalesLines(id, b.lines ?? [], 5);
    const now = Date.now();
    const so = { id, tenant_id: "tnt_demo", so_number: `SO-${String(++soSeq).padStart(5, "0")}`, quotation_id: b.quotationId ?? null, customer_id: b.customerId, status: "pending_approve", subtotal_cents: subtotal, discount_cents: discount, total_cents: subtotal - discount, sales_rep_id: b.salesRepId ?? null, picker_id: b.pickerId ?? null, store_id: b.storeId ?? null, created_at: now, updated_at: now };
    salesOrders.push(so); soLines.set(id, out);
    return HttpResponse.json({ ...so, lines: out }, { status: 201 });
  }),
  http.get(`${V1}/sales/sales-orders`, async ({ request }) => {
    await lat();
    const u = new URL(request.url);
    let items = [...salesOrders];
    const st = u.searchParams.get("status"); if (st) items = items.filter((s) => s.status === st);
    const rep = u.searchParams.get("salesRepId"); if (rep) items = items.filter((s) => s.sales_rep_id === rep);
    const pk = u.searchParams.get("pickerId"); if (pk) items = items.filter((s) => s.picker_id === pk);
    return HttpResponse.json({ items: items.sort((a, b) => b.created_at - a.created_at) });
  }),
  http.get(`${V1}/sales/sales-orders/:id`, async ({ params }) => {
    await lat();
    const so = salesOrders.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "sales order not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json({ ...so, lines: soLines.get(so.id) ?? [] });
  }),
  http.post(`${V1}/sales/sales-orders/:id/approve`, async ({ params }) => {
    await lat();
    const so = salesOrders.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "sales order not found", requestId: rid() } }, { status: 404 });
    if (so.status !== "pending_approve") return HttpResponse.json({ error: { code: "conflict", message: `cannot approve a ${so.status} sales order`, requestId: rid() } }, { status: 409 });
    so.status = "approved"; return HttpResponse.json(so);
  }),
  http.post(`${V1}/sales/sales-orders/:id/assign-picker`, async ({ params, request }) => {
    await lat();
    const so = salesOrders.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "sales order not found", requestId: rid() } }, { status: 404 });
    const b = (await request.json()) as any; so.picker_id = b.pickerId; return HttpResponse.json(so);
  }),
  http.post(`${V1}/sales/sales-orders/:id/invoice`, async ({ params }) => {
    await lat();
    const so = salesOrders.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "sales order not found", requestId: rid() } }, { status: 404 });
    if (so.status === "invoiced") return HttpResponse.json({ error: { code: "conflict", message: "already invoiced", requestId: rid() } }, { status: 409 });
    if (so.status === "pending_approve") return HttpResponse.json({ error: { code: "conflict", message: "approve before invoicing", requestId: rid() } }, { status: 409 });
    so.status = "invoiced"; return HttpResponse.json(so);
  }),
  http.post(`${V1}/sales/sales-orders/:id/cancel`, async ({ params }) => {
    await lat();
    const so = salesOrders.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "sales order not found", requestId: rid() } }, { status: 404 });
    if (so.status === "invoiced") return HttpResponse.json({ error: { code: "conflict", message: "cannot cancel an invoiced sales order", requestId: rid() } }, { status: 409 });
    so.status = "cancelled"; return HttpResponse.json(so);
  }),
);

// ── Accounting mock handlers (Chart of Accounts + Batch Deposits) ───────────
mockHandlers.push(
  http.post(`${V1}/accounting/accounts/seed`, async () => {
    await lat();
    if (accounts.length > 0) return HttpResponse.json({ seeded: 0 });
    DEFAULT_COA.forEach(([code, name, type]) => accounts.push({ id: `acct_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", code, name, type, parent_id: null, is_active: 1, created_at: Date.now() }));
    return HttpResponse.json({ seeded: accounts.length });
  }),
  http.post(`${V1}/accounting/accounts`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    if (accounts.some((a) => a.code === b.code)) return HttpResponse.json({ error: { code: "conflict", message: `account code '${b.code}' already exists`, requestId: rid() } }, { status: 409 });
    const a = { id: `acct_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", code: b.code, name: b.name, type: b.type, parent_id: b.parentId ?? null, is_active: 1, created_at: Date.now() };
    accounts.push(a); return HttpResponse.json(a, { status: 201 });
  }),
  http.get(`${V1}/accounting/accounts`, async ({ request }) => {
    await lat();
    const type = new URL(request.url).searchParams.get("type");
    let items = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
    if (type) items = items.filter((a) => a.type === type);
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/accounting/accounts/tree`, async () => {
    await lat();
    const byId = new Map(accounts.map((a) => [a.id, { ...a, children: [] as any[] }]));
    const roots: any[] = [];
    for (const n of byId.values()) { if (n.parent_id && byId.has(n.parent_id)) byId.get(n.parent_id)!.children.push(n); else roots.push(n); }
    return HttpResponse.json({ items: roots.sort((a, b) => a.code.localeCompare(b.code)) });
  }),
  http.patch(`${V1}/accounting/accounts/:id`, async ({ params, request }) => {
    await lat();
    const a = accounts.find((x) => x.id === String(params.id));
    if (!a) return HttpResponse.json({ error: { code: "not_found", message: "account not found", requestId: rid() } }, { status: 404 });
    const b = (await request.json()) as any;
    if (b.name !== undefined) a.name = b.name;
    if (b.isActive !== undefined) a.is_active = b.isActive ? 1 : 0;
    return HttpResponse.json(a);
  }),
  http.post(`${V1}/accounting/deposits`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    if (!accounts.some((a) => a.id === b.accountId)) return HttpResponse.json({ error: { code: "not_found", message: "account not found", requestId: rid() } }, { status: 404 });
    const id = `dep_${Math.random().toString(36).slice(2, 12)}`;
    // Mock: 2000 cents per payment id (real backend sums the ledger).
    const items = (b.paymentIds ?? []).map((pid: string) => ({ id: `dpi_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", batch_id: id, payment_id: pid, amount_cents: 2000 }));
    const total = items.reduce((s: number, i: any) => s + i.amount_cents, 0);
    const dep = { id, tenant_id: "tnt_demo", batch_number: `DEP-${String(++depSeq).padStart(5, "0")}`, description: b.description ?? null, account_id: b.accountId, status: "pending_approval", total_cents: total, deposit_date: b.depositDate ?? null, created_at: Date.now(), decided_at: null };
    deposits.push(dep); depositItems.set(id, items);
    return HttpResponse.json({ ...dep, items }, { status: 201 });
  }),
  http.get(`${V1}/accounting/deposits`, async ({ request }) => {
    await lat();
    const status = new URL(request.url).searchParams.get("status");
    let items = [...deposits].sort((a, b) => b.created_at - a.created_at);
    if (status) items = items.filter((d) => d.status === status);
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/accounting/deposits/:id`, async ({ params }) => {
    await lat();
    const d = deposits.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "batch deposit not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json({ ...d, items: depositItems.get(d.id) ?? [] });
  }),
  http.post(`${V1}/accounting/deposits/:id/approve`, async ({ params }) => {
    await lat();
    const d = deposits.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "batch deposit not found", requestId: rid() } }, { status: 404 });
    if (d.status !== "pending_approval") return HttpResponse.json({ error: { code: "conflict", message: `batch deposit is already ${d.status}`, requestId: rid() } }, { status: 409 });
    d.status = "approved"; d.decided_at = Date.now(); return HttpResponse.json(d);
  }),
  http.post(`${V1}/accounting/deposits/:id/reject`, async ({ params }) => {
    await lat();
    const d = deposits.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "batch deposit not found", requestId: rid() } }, { status: 404 });
    if (d.status !== "pending_approval") return HttpResponse.json({ error: { code: "conflict", message: `batch deposit is already ${d.status}`, requestId: rid() } }, { status: 409 });
    d.status = "rejected"; d.decided_at = Date.now(); return HttpResponse.json(d);
  }),
);

// ── Ecommerce: storefront + checkout + portal ───────────────────────────────
mockHandlers.push(
  // ── Store settings ────────────────────────────────────────────────────────
  http.get(`${V1}/ecommerce/store/settings`, async () => {
    await lat();
    return HttpResponse.json(storeSettings);
  }),
  http.patch(`${V1}/ecommerce/store/settings`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as Partial<typeof storeSettings>;
    Object.assign(storeSettings, b);
    return HttpResponse.json(storeSettings);
  }),

  // ── Customer auth ──────────────────────────────────────────────────────────
  http.post(`${V1}/ecommerce/auth/login`, async ({ request }) => {
    await lat();
    const { email, password } = (await request.json()) as { email: string; password: string };
    const customer = storeCustomers.find((c) => c.email.toLowerCase() === email.toLowerCase() && c.password === password);
    if (!customer) return HttpResponse.json({ error: "Invalid email or password." }, { status: 401 });
    const token = `sct_${Math.random().toString(36).slice(2, 18)}`;
    storeTokens.set(token, customer.id);
    const { password: _pw, ...safe } = customer;
    return HttpResponse.json({ token, customer: safe });
  }),
  http.post(`${V1}/ecommerce/auth/register`, async ({ request }) => {
    await lat();
    const { name, email, password } = (await request.json()) as { name: string; email: string; password: string };
    if (!name?.trim() || !email?.trim() || !password) return HttpResponse.json({ error: "All fields are required." }, { status: 400 });
    if (storeCustomers.find((c) => c.email.toLowerCase() === email.toLowerCase())) {
      return HttpResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    const customer: StoreCustomer = { id: `sc_${++scSeq}`, name: name.trim(), email: email.trim().toLowerCase(), password, created_at: Date.now() };
    storeCustomers.push(customer);
    const token = `sct_${Math.random().toString(36).slice(2, 18)}`;
    storeTokens.set(token, customer.id);
    const { password: _pw, ...safe } = customer;
    return HttpResponse.json({ token, customer: safe }, { status: 201 });
  }),
  http.get(`${V1}/ecommerce/auth/me`, async ({ request }) => {
    await lat();
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.replace("Bearer ", "").trim();
    const cid = storeTokens.get(token);
    const customer = cid ? storeCustomers.find((c) => c.id === cid) : null;
    if (!customer) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { password: _pw, ...safe } = customer;
    return HttpResponse.json(safe);
  }),
  http.post(`${V1}/ecommerce/auth/logout`, async ({ request }) => {
    await lat();
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.replace("Bearer ", "").trim();
    storeTokens.delete(token);
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${V1}/ecommerce/catalog`, async ({ request }) => {
    await lat();
    const u = new URL(request.url);
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    const cat = u.searchParams.get("category");
    let items = [...onlineProducts.values()];
    if (q) items = items.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    if (cat) items = items.filter((p) => p.category === cat);
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/ecommerce/products/:productId`, async ({ params }) => {
    await lat();
    const id = String(params.productId);
    const existing = onlineSettings.get(id) ?? { online: false, online_price_cents: null, online_title: null, online_description: null, seo_slug: null, seo_title: null, seo_description: null, images: [] };
    return HttpResponse.json(existing);
  }),
  http.put(`${V1}/ecommerce/products/:productId/online`, async ({ params, request }) => {
    await lat();
    const id = String(params.productId);
    const b = (await request.json()) as Record<string, unknown>;
    const settings = { ...(onlineSettings.get(id) ?? {}), ...b };
    onlineSettings.set(id, settings);
    if (b.online) onlineProducts.set(id, { id, online: true, ...b });
    else onlineProducts.delete(id);
    return HttpResponse.json({ productId: id, ...settings });
  }),
  http.post(`${V1}/ecommerce/checkout`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const id = `sso_${Math.random().toString(36).slice(2, 12)}`;
    const total = (b.lines ?? []).reduce((s: number, l: any) => s + (l.unitCents ?? 1500) * l.quantity, 0);
    const so = { id, tenant_id: "tnt_demo", so_number: `SO-${String(++ecSoSeq).padStart(5, "0")}`, quotation_id: null, customer_id: b.customerId, status: "pending_approve", subtotal_cents: total, discount_cents: 0, total_cents: total, sales_rep_id: null, picker_id: null, store_id: "ecommerce", created_at: Date.now(), updated_at: Date.now(), lines: [] };
    salesOrders.push(so);
    return HttpResponse.json(so, { status: 201 });
  }),
  http.get(`${V1}/ecommerce/portal/:customerId/orders`, async ({ params }) => {
    await lat();
    const cid = String(params.customerId);
    return HttpResponse.json({
      customer: { id: cid, name: customers.get(cid)?.name ?? "Customer" },
      salesOrders: salesOrders.filter((s) => s.customer_id === cid),
      invoices: [],
    });
  }),
  http.get(`${V1}/ecommerce/orders`, async () => {
    await lat();
    return HttpResponse.json({
      items: [
        { id: "eco_1", so_number: "SO-00001", customer_id: "cust_1", customer_name: "Alice Johnson", status: "pending_approve", fulfillment_status: "unfulfilled", total_cents: 12500, store_id: "ecommerce", created_at: Date.now() - 3600000 },
        { id: "eco_2", so_number: "SO-00002", customer_id: "cust_2", customer_name: "Bob Smith", status: "confirmed", fulfillment_status: "shipped", total_cents: 8750, store_id: "ecommerce", created_at: Date.now() - 7200000 },
        { id: "eco_3", so_number: "SO-00003", customer_id: "cust_3", customer_name: "Carol Davis", status: "invoiced", fulfillment_status: "delivered", total_cents: 22000, store_id: "ecommerce", created_at: Date.now() - 86400000 },
      ],
    });
  }),
);

// ── Settings + global search ────────────────────────────────────────────────
let smSeq = 0, ptSeq = 0, pmSeq = 0, txSeq = 0;
mockHandlers.push(
  http.post(`${V1}/settings/seed`, async () => {
    await lat();
    if (shippingMethods.length === 0) {
      shippingMethods.push({ id: `shm_${++smSeq}`, tenant_id: "tnt_demo", name: "Delivery", amount_cents: 1500, free_limit_cents: null, ecommerce: 1, sequence: 1, credit_account_id: null, debit_account_id: null, active: 1 });
      shippingMethods.push({ id: `shm_${++smSeq}`, tenant_id: "tnt_demo", name: "In-store Pickup", amount_cents: 0, free_limit_cents: null, ecommerce: 1, sequence: 2, credit_account_id: null, debit_account_id: null, active: 1 });
    }
    if (paymentTerms.length === 0) [["COD",0],["Net 15",15],["Net 30",30]].forEach(([n,d]: any) => paymentTerms.push({ id: `pt_${++ptSeq}`, tenant_id: "tnt_demo", name: n, days_due: d, description: null, active: 1 }));
    if (paymentModes.length === 0) ["Cash","Check","ACH","Credit Card","Wire"].forEach((n) => paymentModes.push({ id: `pm_${++pmSeq}`, tenant_id: "tnt_demo", name: n, active: 1 }));
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${V1}/settings/business`, async () => { await lat(); return HttpResponse.json(businessProfile); }),
  http.put(`${V1}/settings/business`, async ({ request }) => { await lat(); businessProfile = { ...businessProfile, ...((await request.json()) as any) }; return HttpResponse.json(businessProfile); }),
  http.get(`${V1}/settings/feature-flags`, async () => { await lat(); return HttpResponse.json(featureFlags); }),
  http.put(`${V1}/settings/feature-flags`, async ({ request }) => { await lat(); featureFlags = { ...featureFlags, ...((await request.json()) as any) }; return HttpResponse.json(featureFlags); }),
  // ── Business profile (module marketplace) ──────────────────────────────────
  http.get(`${V1}/settings/business-profile`, async () => {
    await lat();
    return HttpResponse.json({
      businessType: _bpType,
      locked: _btLocked,
      coreModules: [..._BP_CORE_KEYS],
      modules: _BP_CATALOG.map(m => ({
        ...m,
        enabled: m.core ? true : _bpEnabled.has(m.key),
        flagKey: `module:${m.key}`,
      })),
    });
  }),
  http.post(`${V1}/settings/business-profile`, async ({ request }) => {
    await lat();
    const body = (await request.json()) as { businessType?: string; moduleFlags?: Record<string, boolean>; enabledModules?: string[]; lock?: boolean };

    if (body.businessType && body.businessType !== _bpType) {
      const prevType = _bpType;
      // Apply the bundle for the new business type — this wires the nav immediately.
      _bpType = body.businessType;
      _bpEnabled = new Set(BT_BUNDLES[_bpType] ?? []);
      featureFlags = buildFeatureFlags(_bpType, new Set());
      pushBpAudit("business_profile.type_changed", { businessType: { from: prevType, to: _bpType } });
    }

    // Fine-grained module toggles (within the current type's bundle).
    if (body.moduleFlags) {
      const moduleChanges: Record<string, { from: unknown; to: unknown }> = {};
      for (const [fk, on] of Object.entries(body.moduleFlags)) {
        const key = fk.startsWith("module:") ? fk.slice(7) : fk;
        moduleChanges[key] = { from: _bpEnabled.has(key), to: on };
        if (on) { _bpEnabled.add(key); featureFlags[`module:${key}`] = true; }
        else    { _bpEnabled.delete(key); delete featureFlags[`module:${key}`]; }
      }
      pushBpAudit("business_profile.modules_changed", moduleChanges);
    } else if (body.enabledModules) {
      const extra = new Set(body.enabledModules.filter(k => !_BP_CORE_KEYS.has(k)));
      _bpEnabled = extra;
      featureFlags = buildFeatureFlags(_bpType, extra);
    }

    if (body.lock) _btLocked = true;

    return HttpResponse.json({ ok: true, businessType: _bpType, locked: _btLocked });
  }),

  // ── Capabilities (business-pack control plane) — mirrors the real backend
  //    contract of GET /api/v1/capabilities so mock and real modes render the
  //    same shell/nav and Business Profile settings. Derived from the same
  //    in-memory _bpType/_bpEnabled state the business-profile handlers mutate.
  ...(() => {
    const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

    const buildModules = () =>
      _BP_CATALOG.map((m) => {
        const defaultEnabled = Boolean(m.core) || (BT_BUNDLES[_bpType] ?? []).includes(m.key);
        const enabled = m.core ? true : _bpEnabled.has(m.key);
        const source = m.core
          ? "core"
          : enabled === defaultEnabled
            ? (enabled ? "business_pack" : "not_in_business_pack")
            : "manual_override";
        return {
          ...m,
          flagKey: `module:${m.key}`,
          enabled,
          defaultEnabled,
          source,
          disabledReason: enabled ? null : (source === "manual_override" ? "manual_override_disabled" : "not_in_business_pack"),
        };
      });

    const buildCapabilities = () => ({
      capabilitiesVersion: 1,
      tenant: { id: "tnt_demo" },
      user: {
        id: "usr_demo_owner", role: "owner", customRoleId: null, storeIds: [],
        storeScope: "all", permissions: [], scopes: [], allAccess: true, apiKeyRestricted: false,
      },
      business: {
        type: _bpType, source: "stored", label: label(_bpType),
        description: `${label(_bpType)} business pack`, icon: "🏪",
      },
      plan: { key: "demo", name: "Demo", source: "mock" },
      entitlements: { source: "placeholder", enforced: false, note: "Demo mode — plan entitlements are not enforced." },
      // Mirror the real backend: features carries the derived accountMode +
      // group edition flags (service.ts effectiveFeatures) so the frontend
      // reads one authority in both mock and real modes.
      features: (() => {
        const groupWholesale = _bpEnabled.has("sales_orders") || _bpEnabled.has("purchasing");
        const groupEnterprise = _bpEnabled.has("sso") || _bpEnabled.has("webhooks");
        return {
          ...featureFlags,
          groupRetailPOS: _bpEnabled.has("pos_terminal"),
          groupWholesale,
          groupEnterprise,
          accountMode: groupEnterprise ? "ENTERPRISE" : groupWholesale ? "WHOLESALE" : "RETAIL",
        };
      })(),
      requiredFields: { customer: ["name"], product: ["sku", "name", "price_cents"] },
      workflows: [],
      moduleGroups: {
        common: "Common", retail: "Retail", b2b: "B2B / Wholesale", restaurant: "Restaurant",
        hospitality: "Hospitality", services: "Services", healthcare: "Healthcare",
        manufacturing: "Manufacturing", ecommerce: "Ecommerce", automotive: "Automotive",
        rental: "Rental", entertainment: "Entertainment", education: "Education", golf: "Golf",
      },
      availableBusinessTypes: Object.entries(BT_BUNDLES).map(([key, modules]) => ({
        key, name: label(key), description: `${label(key)} module bundle`, icon: "🏪", modules,
      })),
      modules: buildModules(),
      coreModules: [..._BP_CORE_KEYS],
    });

    const buildImpact = (targetType: string) => {
      const current = new Set<string>([..._BP_CORE_KEYS, ..._bpEnabled]);
      const target = new Set<string>([..._BP_CORE_KEYS, ...(BT_BUNDLES[targetType] ?? [])]);
      const byKey = new Map(_BP_CATALOG.map((m) => [m.key, m]));
      const summarize = (key: string) => {
        const m = byKey.get(key);
        return { key, name: m?.name ?? label(key), group: m?.group ?? "common", route: m?.route ?? null };
      };
      const added = [...target].filter((k) => !current.has(k)).map(summarize);
      const removed = [...current].filter((k) => !target.has(k)).map(summarize);
      return {
        impactVersion: 1,
        readOnly: true,
        from: { businessType: _bpType, label: label(_bpType), enabledModuleCount: current.size },
        to: { businessType: targetType, label: label(targetType), enabledModuleCount: target.size },
        summary: {
          businessTypeChanged: targetType !== _bpType,
          modulesAdded: added.length, modulesRemoved: removed.length,
          requiredFieldEntitiesChanged: 0, workflowsAdded: 0, workflowsRemoved: 0, setupTasksRequired: 0,
        },
        modules: {
          added, removed,
          unchangedEnabled: [...current].filter((k) => target.has(k)),
          targetEnabled: [...target],
        },
      };
    };

    const capabilitiesHandler = async () => { await lat(); return HttpResponse.json(buildCapabilities()); };
    const impactHandler = async ({ request }: { request: Request }) => {
      await lat();
      const url = new URL(request.url);
      const targetType = url.searchParams.get("businessType") ?? _bpType;
      return HttpResponse.json(buildImpact(targetType));
    };

    return [
      http.get(`${V1}/capabilities`, capabilitiesHandler),
      http.get(`${V1}/settings/capabilities`, capabilitiesHandler),
      http.get(`${V1}/capabilities/impact`, impactHandler),
      http.get(`${V1}/settings/capabilities/impact`, impactHandler),
    ];
  })(),

  // ── Support-only: change business type after account setup ─────────────────
  // Requires header X-Finder-Support-Key: finder-support-2026
  http.patch(`${V1}/admin/business-type`, async ({ request }) => {
    await lat();
    if (request.headers.get("X-Finder-Support-Key") !== "finder-support-2026") {
      return HttpResponse.json({ error: { code: "forbidden", message: "Support credentials required." } }, { status: 403 });
    }
    const body = (await request.json()) as { businessType: string };
    if (!BT_BUNDLES[body.businessType]) {
      return HttpResponse.json({ error: { code: "invalid", message: "Unknown business type." } }, { status: 400 });
    }
    _bpType = body.businessType;
    _bpEnabled = new Set(BT_BUNDLES[_bpType]);
    featureFlags = buildFeatureFlags(_bpType, new Set());
    _btLocked = true;
    return HttpResponse.json({ ok: true, businessType: _bpType, locked: true });
  }),
  http.get(`${V1}/settings/shipping-methods`, async () => { await lat(); return HttpResponse.json({ items: shippingMethods }); }),
  http.post(`${V1}/settings/shipping-methods`, async ({ request }) => { await lat(); const b = (await request.json()) as any; const r = { id: `shm_${++smSeq}`, tenant_id: "tnt_demo", name: b.name, amount_cents: b.amountCents, free_limit_cents: b.freeLimitCents ?? null, ecommerce: b.ecommerce ? 1 : 0, sequence: b.sequence ?? 0, credit_account_id: b.creditAccountId ?? null, debit_account_id: b.debitAccountId ?? null, active: 1 }; shippingMethods.push(r); return HttpResponse.json(r, { status: 201 }); }),
  http.delete(`${V1}/settings/shipping-methods/:id`, async ({ params }) => { await lat(); shippingMethods = shippingMethods.filter((s) => s.id !== String(params.id)); return HttpResponse.json({ ok: true }); }),
  http.get(`${V1}/settings/payment-terms`, async () => { await lat(); return HttpResponse.json({ items: paymentTerms }); }),
  http.post(`${V1}/settings/payment-terms`, async ({ request }) => { await lat(); const b = (await request.json()) as any; const r = { id: `pt_${++ptSeq}`, tenant_id: "tnt_demo", name: b.name, days_due: b.daysDue, description: b.description ?? null, active: 1 }; paymentTerms.push(r); return HttpResponse.json(r, { status: 201 }); }),
  http.get(`${V1}/settings/payment-modes`, async () => { await lat(); return HttpResponse.json({ items: paymentModes }); }),
  http.post(`${V1}/settings/payment-modes`, async ({ request }) => { await lat(); const b = (await request.json()) as any; const r = { id: `pm_${++pmSeq}`, tenant_id: "tnt_demo", name: b.name, active: 1 }; paymentModes.push(r); return HttpResponse.json(r, { status: 201 }); }),
  http.get(`${V1}/settings/tax-rates`, async () => { await lat(); return HttpResponse.json({ items: taxRates }); }),
  http.post(`${V1}/settings/tax-rates`, async ({ request }) => { await lat(); const b = (await request.json()) as any; const r = { id: `tax_${++txSeq}`, tenant_id: "tnt_demo", name: b.name, rate_bps: b.rateBps, apply_to_category: b.applyToCategory ?? null, state: b.state ?? null, active: 1 }; taxRates.push(r); return HttpResponse.json(r, { status: 201 }); }),
  http.post(`${V1}/settings/edition`, async ({ request }) => { await lat(); const b = (await request.json()) as { edition: string }; return HttpResponse.json({ ok: true, edition: b.edition }); }),

  http.get(`${V1}/search`, async ({ request }) => {
    await lat();
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const match = (s?: string) => (s ?? "").toLowerCase().includes(q);
    const products = Array.from({ length: 0 }); // products live server-side; demo a couple
    const prodHits = [{ type: "product", id: "prod_demo_a", label: "Apple", sublabel: "SKU-A" }, { type: "product", id: "prod_demo_b", label: "Chips", sublabel: "SKU-B" }].filter((p) => match(p.label) || match(p.sublabel));
    const custHits = Array.from(customers.values()).filter((c: any) => match(c.name) || match(c.company) || match(c.email)).slice(0, 8).map((c: any) => ({ type: "customer", id: c.id, label: c.name, sublabel: c.company ?? c.email }));
    void products;
    return HttpResponse.json({ query: q, results: { products: prodHits, customers: custHits } });
  }),
);

// ── Discounts & Promotions engine ───────────────────────────────────────────
function scopeLines(d: any, lines: any[]): any[] {
  if (d.apply_to === "cart") return lines;
  if (d.apply_to === "product") return lines.filter((l) => l.productId === d.target_id);
  return lines.filter((l) => (l.category ?? "") === d.target_id);
}
mockHandlers.push(
  http.post(`${V1}/discounts`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const d = { id: `dsc_${Math.random().toString(36).slice(2, 12)}`, tenant_id: "tnt_demo", name: b.name, coupon_code: b.couponCode ?? null, rule_type: b.ruleType, discount_type: b.discountType, value: b.value, apply_to: b.applyTo, target_id: b.targetId ?? null, min_order_cents: b.minOrderCents ?? 0, min_qty: b.minQty ?? 0, buy_qty: b.buyQty ?? 0, get_qty: b.getQty ?? 0, tier_restriction: b.tierRestriction?.join(",") ?? null, start_date: b.startDate ?? null, end_date: b.endDate ?? null, status: "active", auto_applicable: b.autoApplicable ? 1 : 0, usage_limit: b.usageLimit ?? null, per_customer_limit: b.perCustomerLimit ?? null, used_count: 0, created_at: Date.now(), updated_at: Date.now() };
    discounts.push(d); return HttpResponse.json(d, { status: 201 });
  }),
  http.get(`${V1}/discounts`, async ({ request }) => {
    await lat();
    const status = new URL(request.url).searchParams.get("status");
    let items = [...discounts].sort((a, b) => b.created_at - a.created_at);
    if (status) items = items.filter((d) => d.status === status);
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/discounts/:id`, async ({ params }) => {
    await lat();
    const d = discounts.find((x) => x.id === String(params.id));
    return d ? HttpResponse.json(d) : HttpResponse.json({ error: { code: "not_found", message: "discount not found", requestId: rid() } }, { status: 404 });
  }),
  http.patch(`${V1}/discounts/:id/status`, async ({ params, request }) => {
    await lat();
    const d = discounts.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "discount not found", requestId: rid() } }, { status: 404 });
    d.status = ((await request.json()) as any).status; return HttpResponse.json(d);
  }),
  http.patch(`${V1}/discounts/:id`, async ({ params, request }) => {
    await lat();
    const d = discounts.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "discount not found", requestId: rid() } }, { status: 404 });
    const b = (await request.json()) as any;
    if (b.name !== undefined) d.name = b.name;
    if (b.couponCode !== undefined) d.coupon_code = b.couponCode || null;
    if (b.ruleType !== undefined) d.rule_type = b.ruleType;
    if (b.discountType !== undefined) d.discount_type = b.discountType;
    if (b.value !== undefined) d.value = b.value;
    if (b.applyTo !== undefined) d.apply_to = b.applyTo;
    if (b.targetId !== undefined) d.target_id = b.targetId || null;
    if (b.minOrderCents !== undefined) d.min_order_cents = b.minOrderCents;
    if (b.minQty !== undefined) d.min_qty = b.minQty;
    if (b.buyQty !== undefined) d.buy_qty = b.buyQty;
    if (b.getQty !== undefined) d.get_qty = b.getQty;
    if (b.tierRestriction !== undefined) d.tier_restriction = b.tierRestriction?.join(",") ?? null;
    if (b.startDate !== undefined) d.start_date = b.startDate;
    if (b.endDate !== undefined) d.end_date = b.endDate;
    if (b.autoApplicable !== undefined) d.auto_applicable = b.autoApplicable ? 1 : 0;
    if (b.usageLimit !== undefined) d.usage_limit = b.usageLimit;
    if (b.perCustomerLimit !== undefined) d.per_customer_limit = b.perCustomerLimit;
    return HttpResponse.json(d);
  }),

  http.post(`${V1}/discounts/:id/redeem`, async ({ params }) => {
    await lat();
    const d = discounts.find((x) => x.id === String(params.id));
    if (!d) return HttpResponse.json({ error: { code: "not_found", message: "discount not found", requestId: rid() } }, { status: 404 });
    if (d.usage_limit !== null && d.used_count >= d.usage_limit) return HttpResponse.json({ error: { code: "conflict", message: "discount usage limit reached", requestId: rid() } }, { status: 409 });
    d.used_count += 1; return HttpResponse.json(d);
  }),
  http.post(`${V1}/discounts/evaluate`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const now = Date.now();
    const subtotal = b.lines.reduce((s: number, l: any) => s + l.unitCents * l.quantity, 0);
    const applied: any[] = [];
    for (const d of discounts) {
      if (d.status !== "active") continue;
      if (d.start_date && now < d.start_date) continue;
      if (d.end_date && now > d.end_date) continue;
      const couponMatch = d.coupon_code && b.couponCode && d.coupon_code === b.couponCode;
      if (d.auto_applicable !== 1 && !couponMatch) continue;
      if (d.tier_restriction) { const t = d.tier_restriction.split(",").map(Number); if (b.customerTier === undefined || !t.includes(b.customerTier)) continue; }
      if (d.min_order_cents > 0 && subtotal < d.min_order_cents) continue;
      const sl = scopeLines(d, b.lines);
      if (sl.length === 0 && d.apply_to !== "cart") continue;
      const sq = sl.reduce((s: number, l: any) => s + l.quantity, 0);
      if (d.min_qty > 0 && sq < d.min_qty) continue;
      if (d.rule_type === "bxgy" && sq < d.buy_qty + d.get_qty) continue;
      const base = d.apply_to === "cart" ? subtotal : sl.reduce((s: number, l: any) => s + l.unitCents * l.quantity, 0);
      let amt = 0;
      if (d.rule_type === "bxgy") { const g = d.buy_qty + d.get_qty; const free = Math.floor(sq / g) * d.get_qty; amt = free * Math.min(...sl.map((l: any) => l.unitCents)); }
      else if (d.discount_type === "fixed") amt = Math.min(base, d.value);
      else amt = Math.round((base * d.value) / 100);
      if (amt > 0) applied.push({ discountId: d.id, name: d.name, ruleType: d.rule_type, amountCents: amt });
    }
    const total = Math.min(subtotal, applied.reduce((s, a) => s + a.amountCents, 0));
    return HttpResponse.json({ subtotalCents: subtotal, discounts: applied, totalDiscountCents: total, netCents: subtotal - total });
  }),
);

// ── Shipping mock handlers (shipping orders from invoices) ──────────────────
mockHandlers.push(
  http.post(`${V1}/shipping`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    let so = shipments.find((s) => s.invoice_id === b.invoiceId);
    if (so) return HttpResponse.json({ ...so, lines: shipLines.get(so.id) ?? [] }, { status: 201 });
    const id = `shp_${Math.random().toString(36).slice(2, 12)}`;
    const lines = (b.lines ?? [{ productId: "prod_demo_a", name: "Item", quantity: 1 }]).map((l: any) => ({ id: `shl_${Math.random().toString(36).slice(2, 10)}`, tenant_id: "tnt_demo", shipping_order_id: id, product_id: l.productId, name: l.name ?? "Item", quantity: l.quantity, packed: 0 }));
    const now = Date.now();
    so = { id, tenant_id: "tnt_demo", ship_number: `SHP-${String(++shpSeq).padStart(5, "0")}`, invoice_id: b.invoiceId, customer_id: "cus_demo_1", status: "pending_shipment", method: b.method ?? "delivery", carrier: null, tracking_number: null, expected_date: b.expectedDate ?? null, shipped_date: null, delivered_date: null, notes: b.notes ?? null, created_at: now, updated_at: now };
    shipments.push(so); shipLines.set(id, lines);
    return HttpResponse.json({ ...so, lines }, { status: 201 });
  }),
  http.get(`${V1}/shipping`, async ({ request }) => {
    await lat();
    const status = new URL(request.url).searchParams.get("status");
    let items = [...shipments].sort((a, b) => b.created_at - a.created_at);
    if (status) items = items.filter((s) => s.status === status);
    return HttpResponse.json({ items });
  }),
  http.get(`${V1}/shipping/:id`, async ({ params }) => {
    await lat();
    const so = shipments.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "shipping order not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json({ ...so, lines: shipLines.get(so.id) ?? [] });
  }),
  http.post(`${V1}/shipping/:id/lines/:lineId/pack`, async ({ params }) => {
    await lat();
    const so = shipments.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "shipping order not found", requestId: rid() } }, { status: 404 });
    const line = (shipLines.get(so.id) ?? []).find((l) => l.id === String(params.lineId));
    if (line) line.packed = 1;
    return HttpResponse.json({ ...so, lines: shipLines.get(so.id) ?? [] });
  }),
  http.post(`${V1}/shipping/:id/ship`, async ({ params, request }) => {
    await lat();
    const so = shipments.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "shipping order not found", requestId: rid() } }, { status: 404 });
    if (so.status === "cancelled" || so.status === "delivered") return HttpResponse.json({ error: { code: "conflict", message: `shipping order is ${so.status}`, requestId: rid() } }, { status: 409 });
    const b = (await request.json().catch(() => ({}))) as any;
    so.status = "shipped"; so.carrier = b.carrier ?? so.carrier; so.tracking_number = b.trackingNumber ?? so.tracking_number; so.shipped_date = b.shippedDate ?? Date.now();
    return HttpResponse.json(so);
  }),
  http.post(`${V1}/shipping/:id/deliver`, async ({ params }) => {
    await lat();
    const so = shipments.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "shipping order not found", requestId: rid() } }, { status: 404 });
    if (so.status !== "shipped") return HttpResponse.json({ error: { code: "conflict", message: `cannot deliver a ${so.status} shipping order`, requestId: rid() } }, { status: 409 });
    so.status = "delivered"; so.delivered_date = Date.now(); return HttpResponse.json(so);
  }),
  http.post(`${V1}/shipping/:id/cancel`, async ({ params }) => {
    await lat();
    const so = shipments.find((x) => x.id === String(params.id));
    if (!so) return HttpResponse.json({ error: { code: "not_found", message: "shipping order not found", requestId: rid() } }, { status: 404 });
    if (so.status === "delivered") return HttpResponse.json({ error: { code: "conflict", message: "cannot cancel a delivered shipping order", requestId: rid() } }, { status: 409 });
    so.status = "cancelled"; return HttpResponse.json(so);
  }),

  // ── Register sessions (open/close cash drawer) ────────────────────────────
  http.get(`${V1}/outlets/registers/:registerId/sessions`, async ({ params }) => {
    await lat();
    const regId = String(params.registerId);
    const sessions = Array.from(registerSessions.values())
      .filter((s) => s.register_id === regId)
      .sort((a, b) => b.opened_at - a.opened_at);
    return HttpResponse.json({ items: sessions });
  }),
  http.get(`${V1}/outlets/registers/:registerId/expected-cash`, async ({ params }) => {
    await lat();
    const regId = String(params.registerId);
    const session = Array.from(registerSessions.values()).find(
      (s) => s.register_id === regId && s.status === "open"
    );
    if (!session) {
      return HttpResponse.json({ openingFloatCents: 0, cashSalesCents: 0, expectedCashCents: 0 });
    }
    const cashSalesCents = 12000;
    return HttpResponse.json({
      openingFloatCents: session.opening_float_cents,
      cashSalesCents,
      expectedCashCents: session.opening_float_cents + cashSalesCents,
    });
  }),
  http.post(`${V1}/outlets/registers/:registerId/open`, async ({ params, request }) => {


    await lat();
    const regId = String(params.registerId);
    const existing = Array.from(registerSessions.values()).find(
      (s) => s.register_id === regId && s.status === "open"
    );
    if (existing) return HttpResponse.json({ error: { code: "conflict", message: "register already open", requestId: rid() } }, { status: 409 });
    const b = (await request.json()) as { openingFloatCents?: number };
    const session = {
      id: `ses_${Math.random().toString(36).slice(2, 12)}`,
      tenant_id: "tnt_demo",
      register_id: regId,
      opened_by: "usr_demo_cashier",
      opening_float_cents: b.openingFloatCents ?? 0,
      closing_float_cents: null,
      counted_cash_cents: null,
      variance_cents: null,
      status: "open",
      opened_at: Date.now(),
      closed_at: null,
    };
    registerSessions.set(session.id, session);
    return HttpResponse.json(session, { status: 201 });
  }),
  http.post(`${V1}/outlets/registers/:registerId/close`, async ({ params, request }) => {
    await lat();
    const regId = String(params.registerId);
    const session = Array.from(registerSessions.values()).find(
      (s) => s.register_id === regId && s.status === "open"
    );
    if (!session) return HttpResponse.json({ error: { code: "not_found", message: "no open session for this register", requestId: rid() } }, { status: 404 });
    const b = (await request.json()) as { countedCashCents?: number; closingFloatCents?: number };
    session.counted_cash_cents = b.countedCashCents ?? 0;
    session.closing_float_cents = b.closingFloatCents ?? 0;
    session.variance_cents = (b.countedCashCents ?? 0) - session.opening_float_cents;
    session.status = "closed";
    session.closed_at = Date.now();
    return HttpResponse.json(session);
  }),

  // ── PO detail (GET /purchasing/orders/:id) — rich with product names + margins ─
  http.get(`${V1}/purchasing/orders/:id`, async ({ params }) => {
    await lat();
    const id = String(params.id);
    const D = 86400000, now = Date.now();
    // Shared product info lookup (matches catalog mock IDs)
    const PRODUCTS: Record<string, { name: string; sku: string; barcode: string; selling_price_cents: number; last_cost_cents: number }> = {
      "prod_1": { name: "Spring Water 500ml",    sku: "BEV-001", barcode: "012345678901", selling_price_cents: 199, last_cost_cents: 80 },
      "prod_2": { name: "Orange Juice 1L",       sku: "BEV-002", barcode: "012345678902", selling_price_cents: 349, last_cost_cents: 140 },
      "prod_3": { name: "Potato Chips 150g",     sku: "SNK-001", barcode: "012345678903", selling_price_cents: 299, last_cost_cents: 110 },
      "prod_4": { name: "Mixed Nuts 200g",       sku: "SNK-002", barcode: "012345678904", selling_price_cents: 599, last_cost_cents: 250 },
      "prod_5": { name: "Classic Cigarettes 20pk",sku: "TOB-001", barcode: "012345678905", selling_price_cents: 1299, last_cost_cents: 850 },
    };
    function enrich(lineId: string, poId: string, productId: string, qty: number, ucost: number, recvd: number, expiry: number | null, lot: string | null, cases: number, upc: number) {
      const p = PRODUCTS[productId] ?? { name: productId, sku: productId, barcode: "", selling_price_cents: ucost * 2, last_cost_cents: ucost };
      const lcost = qty * ucost;
      const margin = p.selling_price_cents > 0 ? Math.round(((p.selling_price_cents - ucost) / p.selling_price_cents) * 100) : 0;
      return { id: lineId, tenant_id: "tnt_demo", po_id: poId, product_id: productId, product_name: p.name, product_sku: p.sku, product_barcode: p.barcode, selling_price_cents: p.selling_price_cents, last_cost_cents: p.last_cost_cents, margin_pct: margin, quantity: qty, unit_cost_cents: ucost, line_cost_cents: lcost, received_qty: recvd, remaining_qty: qty - recvd, expiry_date: expiry, lot_code: lot, cases_ordered: cases, units_per_case: upc };
    }
    const seed: Record<string, any> = {
      po_1: { id: "po_1", tenant_id: "tnt_demo", po_number: 4001, supplier_id: "sup_acme", status: "received", receive_status: "received", total_cost_cents: 24000, freight_cost_cents: 0, other_charges_cents: 0, notes: "Weekly delivery", created_at: now - 2*D, received_at: now - D, lines: [
        enrich("pol_1a","po_1","prod_1",24,600,24,null,"LOT-001",2,12),
        enrich("pol_1b","po_1","prod_2",12,800,12,now+90*D,"LOT-002",1,12),
      ]},
      po_2: { id: "po_2", tenant_id: "tnt_demo", po_number: 4002, supplier_id: "sup_tea", status: "ordered", receive_status: "pending", total_cost_cents: 11250, freight_cost_cents: 0, other_charges_cents: 0, notes: null, created_at: now - 3600000, received_at: null, lines: [
        enrich("pol_2a","po_2","prod_2",15,750,0,null,null,1,15),
        enrich("pol_2b","po_2","prod_3",24,110,0,now+60*D,null,2,12),
      ]},
      po_3: { id: "po_3", tenant_id: "tnt_demo", po_number: 4003, supplier_id: "sup_acme", status: "ordered", receive_status: "partial", total_cost_cents: 43500, freight_cost_cents: 1200, other_charges_cents: 300, notes: "Special order — requires temp check on delivery", created_at: now - 5*D, received_at: null, lines: [
        enrich("pol_3a","po_3","prod_4",12,250,6,now+30*D,"LOT-WN-2026",1,12),
        enrich("pol_3b","po_3","prod_5",24,850,0,null,"LOT-CIG-2026",2,12),
        enrich("pol_3c","po_3","prod_1",60,80,60,null,"LOT-BEV-2026",5,12),
      ]},
    };
    const po = seed[id];
    if (!po) return HttpResponse.json({ error: { code: "not_found", message: "purchase order not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json(po);
  }),

  // ── P&L report ────────────────────────────────────────────────────────────
  http.get(`${V1}/reports/p-l`, async () => {
    await lat();
    return HttpResponse.json({
      revenue: { grossCents: 284600, taxCents: 22768, netCents: 261832 },
      cogs: { costCents: 142300 },
      grossProfit: { cents: 119532, pct: 45.6 },
      opex: { cents: 38400 },
      netProfit: { cents: 81132, pct: 31.0 },
      period: "Last 30 days",
    });
  }),

  // ── Sales-by-rep report ────────────────────────────────────────────────────
  http.get(`${V1}/reports/sales-by-rep`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { repId: "usr_demo_owner", repName: "Demo Owner", orderCount: 48, revenueCents: 142300, avgOrderCents: 2965 },
      { repId: "usr_demo_cashier", repName: "Demo Cashier", orderCount: 31, revenueCents: 89400, avgOrderCents: 2884 },
      { repId: "usr_rep_3", repName: "Sales Rep 3", orderCount: 19, revenueCents: 52900, avgOrderCents: 2784 },
    ]});
  }),

  // ── Sales-by-vendor report ─────────────────────────────────────────────────
  http.get(`${V1}/reports/sales-by-vendor`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { vendorId: "sup_acme", vendorName: "Acme Coffee Co", orderCount: 54, revenueCents: 168400, unitsSold: 312 },
      { vendorId: "sup_tea", vendorName: "Tea Traders", orderCount: 29, revenueCents: 84200, unitsSold: 198 },
      { vendorId: "sup_other", vendorName: "General Goods", orderCount: 15, revenueCents: 32000, unitsSold: 87 },
    ]});
  }),

  // ── Insights: Inventory Forecasting ───────────────────────────────────────
  http.get(`${V1}/insights/reorder`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { productId: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", currentStock: 6, reorderPoint: 8, reorderQuantity: 24, leadTimeDays: 5, velocityPerDay: 1.2, daysOfStock: 5, belowReorderPoint: true, supplierId: null },
      { productId: "prod_4", sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", currentStock: 0, reorderPoint: 4, reorderQuantity: 12, leadTimeDays: 7, velocityPerDay: 0.8, daysOfStock: 0, belowReorderPoint: true, supplierId: null },
      { productId: "prod_3", sku: "APP-TSHIRT-001", name: "Ascend Logo T-Shirt", currentStock: 17, reorderPoint: 5, reorderQuantity: 20, leadTimeDays: 14, velocityPerDay: 1.5, daysOfStock: 11, belowReorderPoint: false, supplierId: null },
    ]});
  }),
  http.get(`${V1}/insights/order-recommendations`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { productId: "prod_1", sku: "GRO-COFFEE-001", name: "Organic Dark Roast Beans", totalUnitsSold: 186, revenueGrossCents: 278814, rank: 1, belowReorderPoint: false },
      { productId: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", totalUnitsSold: 102, revenueGrossCents: 91698, rank: 2, belowReorderPoint: true },
      { productId: "prod_3", sku: "APP-TSHIRT-001", name: "Ascend Logo T-Shirt", totalUnitsSold: 87, revenueGrossCents: 191400, rank: 3, belowReorderPoint: false },
      { productId: "prod_4", sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", totalUnitsSold: 64, revenueGrossCents: 76800, rank: 4, belowReorderPoint: true },
    ]});
  }),
);

// ── Receiving Pipeline: price history, documents, billing-adj, credits, bulk ─

// In-memory stores for pipeline docs and adjustments
const poDocs: Map<string, any[]> = new Map([
  ["po_1", [{ id: "doc_1", po_id: "po_1", name: "Invoice-ACM-4001.pdf", type: "invoice", size_bytes: 248320, uploaded_at: Date.now() - 80000 }]],
  ["po_2", []],
  ["po_3", [{ id: "doc_3", po_id: "po_3", name: "DeliveryNote-4003.pdf", type: "delivery_note", size_bytes: 51200, uploaded_at: Date.now() - 300000 }]],
]);
let docSeq = 10;

const billingAdjs: Map<string, any[]> = new Map([
  ["po_3", [
    { id: "badj_1", po_id: "po_3", line_id: "pol_3a", reason: "Overcharge correction", amount_cents: -300, created_at: Date.now() - 3600000 },
  ]],
]);
let badjSeq = 10;

const vendorCreditsStore: any[] = [
  { id: "vcr_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", type: "chargeback",  amount_cents: 5000, reason: "expired stock return", po_id: null, status: "open",    created_at: Date.now() - 86400000, updated_at: Date.now() - 86400000 },
  { id: "vcr_2", tenant_id: "tnt_demo", supplier_id: "sup_acme", type: "credit_memo", amount_cents: 2200, reason: "price adjustment",    po_id: "po_3", status: "applied", created_at: Date.now() - 3 * 86400000, updated_at: Date.now() - 3 * 86400000 },
];
let vcrSeq = 10;

mockHandlers.push(
  // Price history: last 3 received costs for this vendor × product
  http.get(`${V1}/purchasing/orders/:id/price-history`, async ({ request }) => {
    await lat();
    const D = 86400000, now = Date.now();
    const url = new URL(request.url);
    const from = Number(url.searchParams.get("from")) || 0;
    const to = Number(url.searchParams.get("to")) || Number.MAX_SAFE_INTEGER;
    type Hist = { unit_cost_cents: number; received_at: number; po_id: string; supplier_id: string; supplier_name: string };
    const build = (
      product_id: string, product_name: string, sku: string,
      invoiced_cents: number, ordered_qty: number,
      suggested_qty: number, current_stock: number, velocity_per_day: number,
      raw: Hist[],
    ) => {
      const hist = raw.filter((h) => h.received_at >= from && h.received_at <= to);
      const last = hist.find((h) => h.supplier_id === "sup_self") ?? null;
      const best = hist.reduce<Hist | null>((b, h) => (!b || h.unit_cost_cents < b.unit_cost_cents ? h : b), null);
      return {
        product_id, product_name, sku, ordered_qty, invoiced_cents,
        last_from_supplier: last ? { unit_cost_cents: last.unit_cost_cents, received_at: last.received_at } : null,
        best_across_suppliers: best
          ? { unit_cost_cents: best.unit_cost_cents, received_at: best.received_at, supplier_id: best.supplier_id, supplier_name: best.supplier_name }
          : null,
        suggested_qty, velocity_per_day, current_stock,
        history: hist.slice(0, 5).map((h) => ({ unit_cost_cents: h.unit_cost_cents, received_at: h.received_at, po_id: h.po_id })),
      };
    };
    return HttpResponse.json({ items: [
      build("prod_1", "Spring Water 500ml", "BEV-001", 80, 48, 72, 12, 1.4, [
        { unit_cost_cents: 80, received_at: now - 30*D, po_id: "po_1", supplier_id: "sup_self", supplier_name: "Acme Distribution" },
        { unit_cost_cents: 75, received_at: now - 60*D, po_id: "po_hist_a", supplier_id: "sup_b", supplier_name: "BevSource Co" },
        { unit_cost_cents: 78, received_at: now - 90*D, po_id: "po_hist_b", supplier_id: "sup_self", supplier_name: "Acme Distribution" },
      ]),
      build("prod_2", "Orange Juice 1L", "BEV-002", 140, 24, 0, 60, 0.3, [
        { unit_cost_cents: 140, received_at: now - 30*D, po_id: "po_1", supplier_id: "sup_self", supplier_name: "Acme Distribution" },
        { unit_cost_cents: 135, received_at: now - 60*D, po_id: "po_hist_a", supplier_id: "sup_b", supplier_name: "BevSource Co" },
      ]),
      build("prod_3", "Potato Chips 150g", "SNK-001", 110, 36, 36, 4, 0.8, [
        { unit_cost_cents: 110, received_at: now - 45*D, po_id: "po_hist_c", supplier_id: "sup_c", supplier_name: "Snack Partners" },
      ]),
    ]});
  }),

  // PO documents: list
  http.get(`${V1}/purchasing/orders/:id/documents`, async ({ params }) => {
    await lat();
    const docs = poDocs.get(String(params.id)) ?? [];
    return HttpResponse.json({ items: docs });
  }),

  // PO documents: upload (mock — just records metadata)
  http.post(`${V1}/purchasing/orders/:id/documents`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { name: string; type?: string; size_bytes?: number };
    const doc = { id: `doc_${docSeq++}`, po_id: String(params.id), name: b.name.trim(), type: b.type ?? "other", size_bytes: b.size_bytes ?? 0, uploaded_at: Date.now() };
    const list = poDocs.get(String(params.id)) ?? [];
    list.push(doc);
    poDocs.set(String(params.id), list);
    return HttpResponse.json(doc, { status: 201 });
  }),

  // PO documents: delete
  http.delete(`${V1}/purchasing/orders/:id/documents/:docId`, async ({ params }) => {
    await lat();
    const poId = String(params.id);
    const docId = String(params.docId);
    const list = (poDocs.get(poId) ?? []).filter((d: any) => d.id !== docId);
    poDocs.set(poId, list);
    return HttpResponse.json({ ok: true });
  }),

  // Landed costs: apply freight + other charges to PO
  http.post(`${V1}/purchasing/orders/:id/landed-costs`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { freightCents: number; otherChargesCents?: number };
    return HttpResponse.json({ id: String(params.id), freight_cost_cents: b.freightCents, other_charges_cents: b.otherChargesCents ?? 0 });
  }),

  // Billing adjustments: list
  http.get(`${V1}/purchasing/orders/:id/billing-adj`, async ({ params }) => {
    await lat();
    return HttpResponse.json({ items: billingAdjs.get(String(params.id)) ?? [] });
  }),

  // Billing adjustments: create (price adjustment or chargeback on a line)
  http.post(`${V1}/purchasing/orders/:id/billing-adj`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { lineId?: string; reason: string; amountCents: number };
    const adj = { id: `badj_${badjSeq++}`, po_id: String(params.id), line_id: b.lineId ?? null, reason: b.reason, amount_cents: b.amountCents, created_at: Date.now() };
    const list = billingAdjs.get(String(params.id)) ?? [];
    list.push(adj);
    billingAdjs.set(String(params.id), list);
    return HttpResponse.json(adj, { status: 201 });
  }),

  // PO bills · 3-way match (#42). Dev store; the real backend computes the match
  // against actual ordered/received quantities.
  http.get(`${V1}/purchasing/orders/:id/bills`, async ({ params }) => {
    await lat();
    const items = [...poBills.values()]
      .filter((b) => b.po_id === String(params.id))
      .map((b) => ({ id: b.id, po_id: b.po_id, invoice_number: b.invoice_number, invoice_date: b.invoice_date, total_cents: b.total_cents, status: b.status, created_at: b.created_at }))
      .sort((a, b) => b.created_at - a.created_at);
    return HttpResponse.json({ items });
  }),

  http.post(`${V1}/purchasing/orders/:id/bills`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as { invoiceNumber: string; invoiceDate?: number | null; documentId?: string | null; taxCents?: number; lines: Array<{ lineId?: string | null; productId: string; productName?: string | null; invoicedQty: number; invoicedUnitCostCents: number }> };
    const now = Date.now();
    const id = `bill_${poBillSeq++}`;
    const subtotal = b.lines.reduce((s, l) => s + l.invoicedQty * l.invoicedUnitCostCents, 0);
    const tax = b.taxCents ?? 0;
    const total = subtotal + tax;
    // Dev match: with no PO reference here, treat invoiced as expected (matched).
    const lines = b.lines.map((l) => ({
      line_id: l.lineId ?? null, product_id: l.productId, product_name: l.productName ?? l.productId,
      ordered_qty: l.invoicedQty, received_qty: l.invoicedQty, invoiced_qty: l.invoicedQty,
      po_unit_cost_cents: l.invoicedUnitCostCents, invoiced_unit_cost_cents: l.invoicedUnitCostCents,
      expected_cents: l.invoicedQty * l.invoicedUnitCostCents, invoiced_cents: l.invoicedQty * l.invoicedUnitCostCents,
      variance_cents: 0, flags: [] as string[], matched: true,
    }));
    const bill = {
      id, po_id: String(params.id), invoice_number: b.invoiceNumber, invoice_date: b.invoiceDate ?? null,
      document_id: b.documentId ?? null, subtotal_cents: subtotal, tax_cents: tax, total_cents: total,
      status: "draft", created_at: now, updated_at: now,
      match: { match_status: "matched", expected_cents: subtotal, invoiced_subtotal_cents: subtotal, total_variance_cents: tax, lines },
    };
    poBills.set(id, bill);
    return HttpResponse.json(bill, { status: 201 });
  }),

  http.get(`${V1}/purchasing/bills/:billId`, async ({ params }) => {
    await lat();
    const bill = poBills.get(String(params.billId));
    if (!bill) return HttpResponse.json({ error: { code: "not_found", message: "bill not found", requestId: rid() } }, { status: 404 });
    return HttpResponse.json(bill);
  }),

  http.post(`${V1}/purchasing/bills/:billId/status`, async ({ params, request }) => {
    await lat();
    const bill = poBills.get(String(params.billId));
    if (!bill) return HttpResponse.json({ error: { code: "not_found", message: "bill not found", requestId: rid() } }, { status: 404 });
    if (bill.status === "posted") return HttpResponse.json({ error: { code: "already_posted", message: "a posted bill cannot be changed", requestId: rid() } }, { status: 409 });
    const b = (await request.json()) as { status: "approved" | "held" };
    bill.status = b.status; bill.updated_at = Date.now();
    return HttpResponse.json(bill);
  }),

  http.post(`${V1}/purchasing/bills/:billId/post`, async ({ params }) => {
    await lat();
    const bill = poBills.get(String(params.billId));
    if (!bill) return HttpResponse.json({ error: { code: "not_found", message: "bill not found", requestId: rid() } }, { status: 404 });
    if (bill.status === "posted") return HttpResponse.json({ error: { code: "already_posted", message: "bill is already posted", requestId: rid() } }, { status: 409 });
    if (bill.status !== "approved") return HttpResponse.json({ error: { code: "not_approved", message: "bill must be approved before it can be posted", requestId: rid() } }, { status: 409 });
    bill.status = "posted"; bill.updated_at = Date.now();
    return HttpResponse.json(bill);
  }),

  // Vendor credits: override GET to support poId filter and use shared store
  http.get(`${V1}/purchasing/vendor-credits`, async ({ request }) => {
    await lat();
    const url = new URL(request.url);
    const supplierId = url.searchParams.get("supplierId");
    const poId = url.searchParams.get("poId");
    let items = [...vendorCreditsStore];
    if (supplierId) items = items.filter((c) => c.supplier_id === supplierId);
    if (poId) items = items.filter((c) => c.po_id === poId);
    return HttpResponse.json({ items });
  }),

  // Vendor credits: create
  http.post(`${V1}/purchasing/vendor-credits`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { supplierId: string; type: string; amountCents: number; reason?: string; poId?: string };
    const vc = { id: `vcr_${vcrSeq++}`, tenant_id: "tnt_demo", supplier_id: b.supplierId, type: b.type, amount_cents: b.amountCents, reason: b.reason ?? null, po_id: b.poId ?? null, status: "open", created_at: Date.now(), updated_at: Date.now() };
    vendorCreditsStore.push(vc);
    return HttpResponse.json(vc, { status: 201 });
  }),

  // Vendor credits: void
  http.post(`${V1}/purchasing/vendor-credits/:id/void`, async ({ params }) => {
    await lat();
    const idx = vendorCreditsStore.findIndex((c) => c.id === String(params.id));
    if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
    vendorCreditsStore[idx] = { ...vendorCreditsStore[idx], status: "void", updated_at: Date.now() };
    return HttpResponse.json(vendorCreditsStore[idx]);
  }),

  // Bulk expiry update: PATCH /inventory/lots/bulk-expiry
  // Body: { updates: [{ lotId, expiryDate }] }
  http.patch(`${V1}/inventory/lots/bulk-expiry`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { updates: Array<{ lotId: string; expiryDate: number | null }> };
    return HttpResponse.json({ updated: b.updates.length });
  }),

  // Bulk location assignment: PATCH /inventory/bulk-location
  // Body: { productIds: string[]; locationId: string }
  http.patch(`${V1}/inventory/bulk-location`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { productIds: string[]; locationId: string };
    return HttpResponse.json({ updated: b.productIds.length, locationId: b.locationId });
  }),

  // Vendor returns: override GET to include supplier name
  http.get(`${V1}/purchasing/returns`, async () => {
    await lat();
    const D = 86400000, now = Date.now();
    return HttpResponse.json({ items: [
      { id: "ret_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", supplier_name: "Acme Coffee Co", reason: "expired", total_cost_cents: 1200, credit_id: "vcr_1", status: "recorded", created_at: now - D },
      { id: "ret_2", tenant_id: "tnt_demo", supplier_id: "sup_tea", supplier_name: "Tea Traders", reason: "damaged", total_cost_cents: 450, credit_id: null, status: "recorded", created_at: now - 2*D },
    ]});
  }),
);

// ── Sprint 9A: Sync / Integrations / Import-Export handlers ─────────────────

// In-memory stores for sync module
let companyIntegrations: any[] = [];
const importBatches: any[] = [
  { id: "imp_1", import_type: "customers", file_name: "customers-jan.csv", status: "completed", total_rows: 142, success_rows: 140, failed_rows: 2, created_at: Date.now() - 3 * 86_400_000, completed_at: Date.now() - 3 * 86_400_000 + 120_000 },
  { id: "imp_2", import_type: "products", file_name: "catalog-q1.csv", status: "failed", total_rows: 88, success_rows: 0, failed_rows: 88, created_at: Date.now() - 86_400_000, completed_at: null },
];
const exportBatches: any[] = [
  { id: "exp_1", export_type: "products", status: "completed", total_rows: 312, file_url: "/api/v1/catalog/export", created_at: Date.now() - 2 * 86_400_000 },
];
let importSeq = 3;

mockHandlers.push(
  // ── Integration providers ──────────────────────────────────────────────────
  http.get(`${V1}/sync/integration-providers`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "prov_ecommerce", name: "Ecommerce Platform", provider_type: "ecommerce", is_active: true },
      { id: "prov_quickbooks", name: "QuickBooks", provider_type: "accounting", is_active: true },
      { id: "prov_stripe", name: "Stripe", provider_type: "payment", is_active: true },
      { id: "prov_avalara", name: "Avalara", provider_type: "tax", is_active: true },
      { id: "prov_shipstation", name: "ShipStation", provider_type: "shipping", is_active: true },
      { id: "prov_sendgrid", name: "SendGrid", provider_type: "email", is_active: true },
    ] });
  }),

  // ── Company integrations ───────────────────────────────────────────────────
  http.get(`${V1}/sync/integrations`, async () => {
    await lat();
    return HttpResponse.json({ items: companyIntegrations });
  }),
  http.post(`${V1}/sync/integrations`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { providerId: string; status: string };
    // Update or insert
    const idx = companyIntegrations.findIndex((i: any) => i.provider_id === b.providerId);
    if (idx >= 0) {
      companyIntegrations[idx] = { ...companyIntegrations[idx], status: b.status };
    } else {
      companyIntegrations.push({ id: `int_${Math.random().toString(36).slice(2, 10)}`, provider_id: b.providerId, status: b.status, last_sync_at: null });
    }
    return HttpResponse.json({ ok: true }, { status: 200 });
  }),

  // ── Import batches ─────────────────────────────────────────────────────────
  http.get(`${V1}/sync/import-batches`, async () => {
    await lat();
    return HttpResponse.json({ items: importBatches });
  }),
  http.post(`${V1}/sync/import-batches`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { importType: string; fileName: string };
    const batch = { id: `imp_${importSeq++}`, import_type: b.importType, file_name: b.fileName, status: "pending", total_rows: 0, success_rows: 0, failed_rows: 0, created_at: Date.now(), completed_at: null };
    importBatches.unshift(batch);
    return HttpResponse.json(batch, { status: 201 });
  }),

  // ── Export batches ─────────────────────────────────────────────────────────
  http.get(`${V1}/sync/export-batches`, async () => {
    await lat();
    return HttpResponse.json({ items: exportBatches });
  }),
);

// ── Sprint 10B: Customer sub-panels + Inventory Locations ────────────────────

const customerAddresses = new Map<string, any[]>();
const customerContacts = new Map<string, any[]>();
const customerNotes = new Map<string, any[]>();

// Seed demo data for cus_demo_1
const _now = Date.now();
customerAddresses.set("cus_demo_1", [
  { id: "addr_1", customer_id: "cus_demo_1", address_type: "billing",  address_line1: "123 Main St",     city: "Houston",  state: "TX", zip: "77001", country: "US", county: "Harris",  is_default: true,  created_at: _now, updated_at: _now },
  { id: "addr_2", customer_id: "cus_demo_1", address_type: "shipping", address_line1: "456 Warehouse Rd", city: "Pasadena", state: "TX", zip: "77502", country: "US", county: "Harris",  is_default: false, created_at: _now, updated_at: _now },
]);
customerContacts.set("cus_demo_1", [
  { id: "con_1", customer_id: "cus_demo_1", contact_name: "John Smith",    title: "Owner",   email: "john@acmewholesale.com", phone: "713-555-0101", is_primary: true,  created_at: _now, updated_at: _now },
  { id: "con_2", customer_id: "cus_demo_1", contact_name: "Maria Garcia",  title: "Buyer",   email: "maria@acmewholesale.com", phone: "713-555-0102", is_primary: false, created_at: _now, updated_at: _now },
  { id: "con_3", customer_id: "cus_demo_1", contact_name: "David Lee",     title: "Manager", email: "david@acmewholesale.com", phone: "713-555-0103", is_primary: false, created_at: _now, updated_at: _now },
]);
customerNotes.set("cus_demo_1", []);

let invLocSeq = 2;
const inventoryLocations: any[] = [
  { id: "invloc_1", code: "MAIN-FLR", name: "Main Floor (CA)", location_type: "floor", outlet_id: "otl_main", state: "CA", is_sellable: true, is_receiving_location: false, is_active: true },
  { id: "invloc_2", code: "BACK-WH", name: "Back Warehouse", location_type: "warehouse", outlet_id: "otl_main", state: "CA", is_sellable: false, is_receiving_location: true, is_active: true },
];

mockHandlers.push(
  // ── Customer addresses ────────────────────────────────────────────────────
  http.get(`${V1}/customers/:id/addresses`, async ({ params }) => {
    await lat();
    const items = customerAddresses.get(String(params.id)) ?? [];
    return HttpResponse.json({ items });
  }),
  http.post(`${V1}/customers/:id/addresses`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as any;
    const addr = { id: `addr_${Math.random().toString(36).slice(2, 10)}`, ...b, country: b.country ?? "US" };
    const list = customerAddresses.get(String(params.id)) ?? [];
    list.push(addr);
    customerAddresses.set(String(params.id), list);
    return HttpResponse.json(addr, { status: 201 });
  }),
  http.patch(`${V1}/customers/:id/addresses/:addressId`, async ({ params, request }) => {
    await lat();
    const list = customerAddresses.get(String(params.id)) ?? [];
    const idx = list.findIndex((a) => a.id === String(params.addressId));
    if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
    const b = (await request.json()) as any;
    list[idx] = { ...list[idx], ...b, updated_at: Date.now() };
    customerAddresses.set(String(params.id), list);
    return HttpResponse.json(list[idx]);
  }),
  http.delete(`${V1}/customers/:id/addresses/:addrId`, async ({ params }) => {
    await lat();
    const list = (customerAddresses.get(String(params.id)) ?? []).filter((a) => a.id !== String(params.addrId));
    customerAddresses.set(String(params.id), list);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Customer contacts ─────────────────────────────────────────────────────
  http.get(`${V1}/customers/:id/contacts`, async ({ params }) => {
    await lat();
    const items = customerContacts.get(String(params.id)) ?? [];
    return HttpResponse.json({ items });
  }),
  http.post(`${V1}/customers/:id/contacts`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as any;
    const contact = { id: `con_${Math.random().toString(36).slice(2, 10)}`, customer_id: String(params.id), ...b, created_at: Date.now(), updated_at: Date.now() };
    const list = customerContacts.get(String(params.id)) ?? [];
    list.push(contact);
    customerContacts.set(String(params.id), list);
    return HttpResponse.json(contact, { status: 201 });
  }),
  http.patch(`${V1}/customers/:id/contacts/:contactId`, async ({ params, request }) => {
    await lat();
    const list = customerContacts.get(String(params.id)) ?? [];
    const idx = list.findIndex((c) => c.id === String(params.contactId));
    if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
    const b = (await request.json()) as any;
    list[idx] = { ...list[idx], ...b, updated_at: Date.now() };
    customerContacts.set(String(params.id), list);
    return HttpResponse.json(list[idx]);
  }),
  http.delete(`${V1}/customers/:id/contacts/:contactId`, async ({ params }) => {
    await lat();
    const list = (customerContacts.get(String(params.id)) ?? []).filter((c) => c.id !== String(params.contactId));
    customerContacts.set(String(params.id), list);
    return new HttpResponse(null, { status: 204 });
  }),

  // ── Customer notes ────────────────────────────────────────────────────────
  http.get(`${V1}/customers/:id/notes`, async ({ params }) => {
    await lat();
    const items = customerNotes.get(String(params.id)) ?? [];
    return HttpResponse.json({ items });
  }),
  http.post(`${V1}/customers/:id/notes`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as any;
    const note = { id: `note_${Math.random().toString(36).slice(2, 10)}`, ...b, created_at: new Date().toISOString() };
    const list = customerNotes.get(String(params.id)) ?? [];
    list.push(note);
    customerNotes.set(String(params.id), list);
    return HttpResponse.json(note, { status: 201 });
  }),

  // ── Inventory locations (Sprint 8 physical stock locations) ───────────────
  http.get(`${V1}/inventory/locations`, async () => {
    await lat();
    return HttpResponse.json({ items: [...inventoryLocations] });
  }),
  http.post(`${V1}/inventory/locations`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as any;
    const loc = { id: `invloc_${++invLocSeq}`, code: b.code, name: b.name, location_type: b.location_type ?? "floor", outlet_id: b.outlet_id ?? null, is_sellable: !!b.is_sellable, is_receiving_location: !!b.is_receiving_location, is_active: true };
    inventoryLocations.push(loc);
    return HttpResponse.json(loc, { status: 201 });
  }),
  http.patch(`${V1}/inventory/locations/:id`, async ({ params, request }) => {
    await lat();
    const b = (await request.json()) as any;
    const idx = inventoryLocations.findIndex((l) => l.id === String(params.id));
    if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
    inventoryLocations[idx] = { ...inventoryLocations[idx], ...b };
    return HttpResponse.json(inventoryLocations[idx]);
  }),
  http.get(`${V1}/inventory/locations/:id/stock`, async ({ params }) => {
    await lat();
    return HttpResponse.json({
      locationId: params.id as string,
      locationName: "Main Floor",
      items: [
        { product_id: "prod_1", product_name: "Coca-Cola 12oz", sku: "COKE12", quantity_on_hand: 48, quantity_reserved: 6, quantity_available: 42 },
        { product_id: "prod_2", product_name: "Marlboro Red King", sku: "MARL-RK", quantity_on_hand: 10, quantity_reserved: 0, quantity_available: 10 },
        { product_id: "prod_3", product_name: "Newport Menthol 100s", sku: "NEWP-M100", quantity_on_hand: 3, quantity_reserved: 3, quantity_available: 0 },
      ],
    });
  }),

  // ── Vendor Quotes (Sprint 16) ─────────────────────────────────────────────
  ...(() => {
    const VQ_BASE = Date.now();
    let vqItems: Array<{
      id: string; vendor: string; status: "pending" | "accepted" | "rejected";
      expires_at: number; line_items: Array<{ product: string; qty: number; unit_price_cents: number }>;
      total_cents: number; created_at: number;
    }> = [
      { id: "vq_001", vendor: "Altria Group", status: "pending", expires_at: VQ_BASE + 7 * 86400000,
        line_items: [{ product: "Marlboro Red Box 20s", qty: 500, unit_price_cents: 670 }, { product: "Marlboro Gold Box 20s", qty: 300, unit_price_cents: 650 }],
        total_cents: 530000, created_at: VQ_BASE - 86400000 },
      { id: "vq_002", vendor: "Swedish Match", status: "accepted", expires_at: VQ_BASE + 3 * 86400000,
        line_items: [{ product: "General Snus Original Portion", qty: 200, unit_price_cents: 480 }],
        total_cents: 96000, created_at: VQ_BASE - 2 * 86400000 },
      { id: "vq_003", vendor: "Standard General", status: "pending", expires_at: VQ_BASE + 14 * 86400000,
        line_items: [{ product: "Camel Filters Box 20s", qty: 400, unit_price_cents: 660 }],
        total_cents: 264000, created_at: VQ_BASE - 3600000 },
    ];
    let vqSeq = 3;
    return [
      http.get(`${V1}/purchasing/vendor-quotes`, async () => {
        await lat();
        return HttpResponse.json({ items: vqItems, total: vqItems.length });
      }),
      http.post(`${V1}/purchasing/vendor-quotes`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as any;
        const lines: Array<{ product: string; qty: number; unit_price_cents: number }> = (b.line_items ?? []).map((l: any) => ({
          product: String(l.product), qty: Number(l.qty), unit_price_cents: Number(l.unit_price_cents),
        }));
        const total = lines.reduce((s, l) => s + l.qty * l.unit_price_cents, 0);
        const q = {
          id: `vq_${String(++vqSeq).padStart(3, "0")}`,
          vendor: String(b.vendor ?? "Unknown"),
          status: "pending" as const,
          expires_at: Number(b.expires_at ?? Date.now() + 7 * 86400000),
          line_items: lines,
          total_cents: total,
          created_at: Date.now(),
        };
        vqItems.push(q);
        return HttpResponse.json(q, { status: 201 });
      }),
      http.patch(`${V1}/purchasing/vendor-quotes/:id/accept`, async ({ params }) => {
        await lat();
        const q = vqItems.find((x) => x.id === String(params.id));
        if (!q) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        q.status = "accepted";
        return HttpResponse.json({ ...q });
      }),
      http.patch(`${V1}/purchasing/vendor-quotes/:id/reject`, async ({ params }) => {
        await lat();
        const q = vqItems.find((x) => x.id === String(params.id));
        if (!q) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        q.status = "rejected";
        return HttpResponse.json({ ...q });
      }),
    ];
  })(),

  // ── Gift Cards ────────────────────────────────────────────────────────────
  ...(() => {
    let gcSeq = 4;
    const GC_BASE = Date.now();
    interface GiftCardRecord {
      id: string;
      code: string;
      initial_cents: number;
      balance_cents: number;
      status: "active" | "redeemed" | "void";
      issued_by: string;
      created_at: number;
    }
    let giftCards: GiftCardRecord[] = [
      { id: "gc_demo_1", code: "GC-ABCD-1234", initial_cents: 5000,  balance_cents: 5000,  status: "active",   issued_by: "staff_demo", created_at: GC_BASE - 86400000 * 3  },
      { id: "gc_demo_2", code: "GC-EFGH-5678", initial_cents: 10000, balance_cents: 3250,  status: "active",   issued_by: "staff_demo", created_at: GC_BASE - 86400000 * 7  },
      { id: "gc_demo_3", code: "GC-IJKL-9012", initial_cents: 2500,  balance_cents: 0,     status: "redeemed", issued_by: "staff_demo", created_at: GC_BASE - 86400000 * 14 },
      { id: "gc_demo_4", code: "GC-MNOP-3456", initial_cents: 7500,  balance_cents: 7500,  status: "void",     issued_by: "staff_demo", created_at: GC_BASE - 86400000 * 21 },
    ];

    function genCode(): string {
      const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const s = () => Array.from({ length: 4 }, () => c[Math.floor(Math.random() * c.length)]).join("");
      return `GC-${s()}-${s()}`;
    }

    return [
      // GET list
      http.get(`${V1}/giftcards`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const q = url.searchParams.get("q");
        let filtered = giftCards;
        if (status && status !== "all") filtered = filtered.filter(c => c.status === status);
        if (q) filtered = filtered.filter(c => c.code.toLowerCase().includes(q.toLowerCase()));
        return HttpResponse.json({ items: [...filtered].sort((a, b) => b.created_at - a.created_at), total: filtered.length });
      }),

      // GET by code lookup — must be before /:id
      http.get(`${V1}/giftcards/lookup`, async ({ request }) => {
        await lat();
        const code = new URL(request.url).searchParams.get("code") ?? "";
        const card = giftCards.find(c => c.code.toLowerCase() === code.toLowerCase());
        if (!card) return HttpResponse.json({ error: { code: "not_found", message: "Gift card not found." } }, { status: 404 });
        return HttpResponse.json(card);
      }),

      // GET by id
      http.get(`${V1}/giftcards/:id`, async ({ params }) => {
        await lat();
        const card = giftCards.find(c => c.id === String(params["id"]));
        if (!card) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(card);
      }),

      // POST issue new card
      http.post(`${V1}/giftcards`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { amountCents?: number; amount_cents?: number };
        const cents = body.amountCents ?? body.amount_cents ?? 0;
        if (!cents || cents <= 0) {
          return HttpResponse.json({ error: { code: "invalid_amount", message: "Amount must be greater than zero." } }, { status: 400 });
        }
        const card: GiftCardRecord = {
          id: `gc_${++gcSeq}`,
          code: genCode(),
          initial_cents: cents,
          balance_cents: cents,
          status: "active",
          issued_by: "staff_demo",
          created_at: Date.now(),
        };
        giftCards.push(card);
        return HttpResponse.json(card, { status: 201 });
      }),

      // POST void
      http.post(`${V1}/giftcards/:id/void`, async ({ params }) => {
        await lat();
        const idx = giftCards.findIndex(c => c.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        if (giftCards[idx].status !== "active") {
          return HttpResponse.json({ error: { code: "not_active", message: "Only active cards can be voided." } }, { status: 422 });
        }
        giftCards[idx] = { ...giftCards[idx], status: "void" };
        return HttpResponse.json(giftCards[idx]);
      }),

      // POST redeem partial balance
      http.post(`${V1}/giftcards/:id/redeem`, async ({ request, params }) => {
        await lat();
        const idx = giftCards.findIndex(c => c.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { amount_cents: number };
        const card = giftCards[idx];
        if (card.status !== "active") return HttpResponse.json({ error: { code: "not_active" } }, { status: 422 });
        const deduct = Math.min(body.amount_cents, card.balance_cents);
        const newBalance = card.balance_cents - deduct;
        giftCards[idx] = { ...card, balance_cents: newBalance, status: newBalance === 0 ? "redeemed" : "active" };
        return HttpResponse.json({ ...giftCards[idx], amount_deducted_cents: deduct });
      }),
    ];
  })(),

  // ── Payments ledger ───────────────────────────────────────────────────────
  ...(() => {
    const PAY_BASE = Date.now();
    interface PaymentRecord {
      id: string;
      order_id: string;
      method: "cash" | "card" | "split";
      amount_cents: number;
      status: "captured" | "declined" | "refunded";
      card_last4: string | null;
      card_brand: string | null;
      created_at: number;
    }
    const payments: PaymentRecord[] = [
      { id: "pay_001", order_id: "ord_001", method: "card",  amount_cents: 4599,  status: "captured", card_last4: "4242", card_brand: "Visa",       created_at: PAY_BASE - 86400000 * 1  },
      { id: "pay_002", order_id: "ord_002", method: "cash",  amount_cents: 2150,  status: "captured", card_last4: null,   card_brand: null,          created_at: PAY_BASE - 86400000 * 2  },
      { id: "pay_003", order_id: "ord_003", method: "card",  amount_cents: 8900,  status: "refunded", card_last4: "1234", card_brand: "Mastercard",  created_at: PAY_BASE - 86400000 * 3  },
      { id: "pay_004", order_id: "ord_004", method: "split", amount_cents: 6250,  status: "captured", card_last4: "5678", card_brand: "Amex",        created_at: PAY_BASE - 86400000 * 4  },
      { id: "pay_005", order_id: "ord_005", method: "card",  amount_cents: 1099,  status: "declined", card_last4: "9999", card_brand: "Visa",        created_at: PAY_BASE - 86400000 * 5  },
      { id: "pay_006", order_id: "ord_006", method: "cash",  amount_cents: 3300,  status: "captured", card_last4: null,   card_brand: null,          created_at: PAY_BASE - 86400000 * 6  },
      { id: "pay_007", order_id: "ord_007", method: "card",  amount_cents: 7499,  status: "captured", card_last4: "4444", card_brand: "Discover",    created_at: PAY_BASE - 86400000 * 7  },
      { id: "pay_008", order_id: "ord_008", method: "card",  amount_cents: 5500,  status: "captured", card_last4: "3333", card_brand: "Visa",        created_at: PAY_BASE - 86400000 * 8  },
      { id: "pay_009", order_id: "ord_009", method: "cash",  amount_cents: 900,   status: "captured", card_last4: null,   card_brand: null,          created_at: PAY_BASE - 86400000 * 9  },
      { id: "pay_010", order_id: "ord_010", method: "card",  amount_cents: 12000, status: "refunded", card_last4: "2222", card_brand: "Mastercard",  created_at: PAY_BASE - 86400000 * 10 },
    ];

    return [
      // GET payments — filterable by method, status, orderId, date range
      http.get(`${V1}/payments`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const method = url.searchParams.get("method");
        const status = url.searchParams.get("status");
        const orderId = url.searchParams.get("orderId");
        const from   = url.searchParams.get("from")  ? Number(url.searchParams.get("from"))  : null;
        const to     = url.searchParams.get("to")    ? Number(url.searchParams.get("to"))    : null;
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);

        let filtered = payments;
        if (method  && method  !== "all") filtered = filtered.filter(p => p.method  === method);
        if (status  && status  !== "all") filtered = filtered.filter(p => p.status  === status);
        if (orderId) filtered = filtered.filter(p => p.order_id === orderId);
        if (from)    filtered = filtered.filter(p => p.created_at >= from);
        if (to)      filtered = filtered.filter(p => p.created_at <= to);

        const total = filtered.length;
        const total_cents = filtered.reduce((s, p) => s + (p.status !== "declined" ? p.amount_cents : 0), 0);
        const page = filtered.slice(offset, offset + limit);
        return HttpResponse.json({ items: page, total, total_cents, limit, offset });
      }),

      // GET single payment
      http.get(`${V1}/payments/:id`, async ({ params }) => {
        await lat();
        const payment = payments.find(p => p.id === String(params["id"]));
        if (!payment) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(payment);
      }),
    ];
  })(),

  // ── Notifications ──────────────────────────────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    interface NotifRecord {
      id: string; type: string; severity: string;
      title: string; body: string;
      resource_id: string | null; resource_type: string | null;
      read: boolean; created_at: number;
    }
    let seq = 0;
    let notifs: NotifRecord[] = [
      { id: "notif_1", type: "low_stock", severity: "warning", title: "Low stock: Blue Widget", body: "Only 3 units remaining at Main Floor.", resource_id: "prod_demo_1", resource_type: "product", read: false, created_at: BASE - 600000 },
      { id: "notif_2", type: "payment_failed", severity: "critical", title: "Payment failed", body: "Card declined on order ORD-0042.", resource_id: "ord_demo_42", resource_type: "order", read: false, created_at: BASE - 1800000 },
      { id: "notif_3", type: "new_order", severity: "info", title: "New online order", body: "Order ORD-0043 placed via ecommerce.", resource_id: "ord_demo_43", resource_type: "order", read: false, created_at: BASE - 3600000 },
      { id: "notif_4", type: "order_fulfilled", severity: "info", title: "Order fulfilled", body: "Order ORD-0039 shipped via DHL.", resource_id: "ord_demo_39", resource_type: "order", read: true, created_at: BASE - 86400000 },
      { id: "notif_5", type: "purchase_order_received", severity: "info", title: "PO received", body: "Purchase order PO-0011 fully received at Warehouse.", resource_id: "po_demo_11", resource_type: "purchase_order", read: true, created_at: BASE - 86400000 * 2 },
      { id: "notif_6", type: "low_stock", severity: "warning", title: "Low stock: Red T-Shirt (L)", body: "Only 1 unit remaining at Main Floor.", resource_id: "prod_demo_5", resource_type: "product", read: false, created_at: BASE - 7200000 },
      { id: "notif_7", type: "sync_error", severity: "critical", title: "Sync error: Ecommerce Platform", body: "Product sync failed with HTTP 503. Retry scheduled.", resource_id: null, resource_type: null, read: false, created_at: BASE - 300000 },
    ];

    return [
      http.get(`${V1}/notifications`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const unreadOnly = url.searchParams.get("unread") === "true";
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        let filtered = unreadOnly ? notifs.filter(n => !n.read) : [...notifs];
        filtered.sort((a, b) => b.created_at - a.created_at);
        const unread_count = notifs.filter(n => !n.read).length;
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total: filtered.length, unread_count });
      }),

      http.patch(`${V1}/notifications/:id/read`, async ({ params }) => {
        await lat();
        const idx = notifs.findIndex(n => n.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        notifs[idx] = { ...notifs[idx], read: true };
        return new HttpResponse(null, { status: 204 });
      }),

      http.post(`${V1}/notifications/mark-all-read`, async () => {
        await lat();
        notifs = notifs.map(n => ({ ...n, read: true }));
        return new HttpResponse(null, { status: 204 });
      }),

      http.post(`${V1}/notifications`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<NotifRecord>;
        const n: NotifRecord = {
          id: `notif_${++seq}`,
          type: b.type ?? "system",
          severity: b.severity ?? "info",
          title: b.title ?? "Notification",
          body: b.body ?? "",
          resource_id: b.resource_id ?? null,
          resource_type: b.resource_type ?? null,
          read: false,
          created_at: Date.now(),
        };
        notifs.unshift(n);
        return HttpResponse.json(n, { status: 201 });
      }),

      // ── Preferences ─────────────────────────────────────────────────────────
      ...(() => {
        type Channel = "in_app" | "email" | "sms" | "push";
        interface PrefRow { type: string; label: string; in_app: boolean; email: boolean; sms: boolean; push: boolean; min_severity: "info" | "warning" | "critical" }
        const prefs: PrefRow[] = [
          { type: "low_stock",              label: "Low Stock Alerts",          in_app: true,  email: true,  sms: false, push: true,  min_severity: "warning"  },
          { type: "payment_failed",         label: "Payment Failures",          in_app: true,  email: true,  sms: true,  push: true,  min_severity: "critical" },
          { type: "new_order",              label: "New Orders",                in_app: true,  email: false, sms: false, push: false, min_severity: "info"     },
          { type: "order_fulfilled",        label: "Order Fulfillment",         in_app: true,  email: true,  sms: false, push: false, min_severity: "info"     },
          { type: "purchase_order_received",label: "PO Received",               in_app: true,  email: false, sms: false, push: false, min_severity: "info"     },
          { type: "sync_error",             label: "Sync Errors",               in_app: true,  email: true,  sms: false, push: true,  min_severity: "warning"  },
          { type: "system",                 label: "System Alerts",             in_app: true,  email: true,  sms: true,  push: true,  min_severity: "warning"  },
          { type: "refund_requested",       label: "Refund Requests",           in_app: true,  email: true,  sms: false, push: false, min_severity: "warning"  },
          { type: "price_override",         label: "Price Override Approvals",  in_app: true,  email: false, sms: false, push: false, min_severity: "info"     },
          { type: "reorder_suggestion",     label: "Reorder Suggestions",       in_app: true,  email: true,  sms: false, push: false, min_severity: "info"     },
        ];
        return [
          http.get(`${V1}/notifications/preferences`, async () => {
            await lat();
            return HttpResponse.json({ items: prefs });
          }),
          http.patch(`${V1}/notifications/preferences`, async ({ request }) => {
            await lat();
            const body = (await request.json()) as Array<{ type: string; channel: Channel; enabled: boolean }>;
            for (const update of body) {
              const row = prefs.find(p => p.type === update.type);
              if (row) (row as unknown as Record<string, unknown>)[update.channel] = update.enabled;
            }
            return HttpResponse.json({ ok: true });
          }),
          http.patch(`${V1}/notifications/preferences/:type/severity`, async ({ params, request }) => {
            await lat();
            const row = prefs.find(p => p.type === String(params["type"]));
            if (!row) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const b = (await request.json()) as { min_severity: PrefRow["min_severity"] };
            row.min_severity = b.min_severity;
            return HttpResponse.json(row);
          }),
        ];
      })(),

      // ── Alert Rules ──────────────────────────────────────────────────────────
      ...(() => {
        let ruleSeq = 10;
        interface AlertRule {
          id: string; name: string; trigger: string; condition: string; threshold: number | null;
          channels: string[]; enabled: boolean; fires_count: number; last_fired_at: number | null; created_at: number;
        }
        const rules: AlertRule[] = [
          { id: "ar_1", name: "Low Stock — Reorder Point", trigger: "inventory", condition: "qty_lte_reorder_point", threshold: null,   channels: ["in_app","email"],        enabled: true,  fires_count: 34, last_fired_at: Date.now() - 3600000,    created_at: Date.now() - 30 * 86400000 },
          { id: "ar_2", name: "Critical Stock — 0 Units",  trigger: "inventory", condition: "qty_eq",                threshold: 0,      channels: ["in_app","email","sms"],  enabled: true,  fires_count: 7,  last_fired_at: Date.now() - 7 * 3600000, created_at: Date.now() - 25 * 86400000 },
          { id: "ar_3", name: "Large Refund",               trigger: "payment",   condition: "amount_gte",            threshold: 10000,  channels: ["in_app","email"],        enabled: true,  fires_count: 3,  last_fired_at: Date.now() - 86400000,    created_at: Date.now() - 20 * 86400000 },
          { id: "ar_4", name: "Payment Failure",            trigger: "payment",   condition: "status_eq_failed",      threshold: null,   channels: ["in_app","email","push"], enabled: true,  fires_count: 12, last_fired_at: Date.now() - 1800000,     created_at: Date.now() - 15 * 86400000 },
          { id: "ar_5", name: "Daily Sales Drop > 20%",     trigger: "sales",     condition: "pct_drop_gte",          threshold: 20,     channels: ["email"],                 enabled: false, fires_count: 0,  last_fired_at: null,                     created_at: Date.now() - 5 * 86400000  },
          { id: "ar_6", name: "Overdue Invoice > 7 Days",   trigger: "invoice",   condition: "overdue_days_gte",      threshold: 7,      channels: ["in_app","email"],        enabled: true,  fires_count: 8,  last_fired_at: Date.now() - 2 * 86400000,created_at: Date.now() - 10 * 86400000 },
        ];
        return [
          http.get(`${V1}/notifications/rules`, async () => {
            await lat();
            return HttpResponse.json({ items: rules });
          }),
          http.post(`${V1}/notifications/rules`, async ({ request }) => {
            await lat();
            const b = (await request.json()) as Partial<AlertRule>;
            const r: AlertRule = { id: `ar_${++ruleSeq}`, name: b.name ?? "New Rule", trigger: b.trigger ?? "inventory", condition: b.condition ?? "qty_lte_reorder_point", threshold: b.threshold ?? null, channels: b.channels ?? ["in_app"], enabled: true, fires_count: 0, last_fired_at: null, created_at: Date.now() };
            rules.push(r);
            return HttpResponse.json(r, { status: 201 });
          }),
          http.patch(`${V1}/notifications/rules/:id`, async ({ params, request }) => {
            await lat();
            const idx = rules.findIndex(r => r.id === String(params["id"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const b = (await request.json()) as Partial<AlertRule>;
            rules[idx] = { ...rules[idx]!, ...b };
            return HttpResponse.json(rules[idx]);
          }),
          http.delete(`${V1}/notifications/rules/:id`, async ({ params }) => {
            await lat();
            const idx = rules.findIndex(r => r.id === String(params["id"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            rules.splice(idx, 1);
            return new HttpResponse(null, { status: 204 });
          }),
        ];
      })(),

      // ── Digest ───────────────────────────────────────────────────────────────
      ...(() => {
        interface DigestConfig {
          enabled: boolean; frequency: "daily" | "weekly"; day_of_week: number; hour: number;
          include: string[]; recipient_emails: string[];
        }
        const digest: DigestConfig = {
          enabled: true, frequency: "daily", day_of_week: 1, hour: 8,
          include: ["low_stock", "payment_failed", "new_order", "sync_error"],
          recipient_emails: ["owner@store.example.com"],
        };
        return [
          http.get(`${V1}/notifications/digest`, async () => {
            await lat();
            return HttpResponse.json(digest);
          }),
          http.patch(`${V1}/notifications/digest`, async ({ request }) => {
            await lat();
            const b = (await request.json()) as Partial<DigestConfig>;
            Object.assign(digest, b);
            return HttpResponse.json(digest);
          }),
        ];
      })(),
    ];
  })(),

  // ── Audit Log ──────────────────────────────────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    interface AuditRecord {
      id: string;
      actor: { id: string; email: string; role: string };
      action: string; resource_type: string; resource_id: string; resource_label: string;
      changes: Record<string, { from: unknown; to: unknown }> | null;
      ip_address: string | null; created_at: number;
    }
    const events: AuditRecord[] = [
      { id: "aud_1", actor: { id: "usr_owner", email: "owner@example.com", role: "owner" }, action: "login", resource_type: "session", resource_id: "sess_1", resource_label: "Session", changes: null, ip_address: "192.168.1.10", created_at: BASE - 300000 },
      { id: "aud_2", actor: { id: "usr_owner", email: "owner@example.com", role: "owner" }, action: "updated", resource_type: "product", resource_id: "prod_demo_1", resource_label: "Blue Widget", changes: { price_cents: { from: 2499, to: 2999 } }, ip_address: "192.168.1.10", created_at: BASE - 600000 },
      { id: "aud_3", actor: { id: "usr_mgr1", email: "manager@example.com", role: "manager" }, action: "approved", resource_type: "purchase_order", resource_id: "po_demo_11", resource_label: "PO-0011", changes: null, ip_address: "192.168.1.15", created_at: BASE - 3600000 },
      { id: "aud_4", actor: { id: "usr_cash1", email: "cashier@example.com", role: "cashier" }, action: "refunded", resource_type: "order", resource_id: "ord_demo_39", resource_label: "ORD-0039", changes: null, ip_address: "192.168.1.22", created_at: BASE - 7200000 },
      { id: "aud_5", actor: { id: "usr_owner", email: "owner@example.com", role: "owner" }, action: "created", resource_type: "discount", resource_id: "disc_demo_1", resource_label: "Summer Sale 10%", changes: null, ip_address: "192.168.1.10", created_at: BASE - 86400000 },
      { id: "aud_6", actor: { id: "usr_mgr1", email: "manager@example.com", role: "manager" }, action: "deleted", resource_type: "custom_role", resource_id: "role_demo_1", resource_label: "Stockroom Staff", changes: null, ip_address: "192.168.1.15", created_at: BASE - 86400000 * 2 },
      { id: "aud_7", actor: { id: "usr_owner", email: "owner@example.com", role: "owner" }, action: "exported", resource_type: "report", resource_id: "rpt_sales_2025_q1", resource_label: "Sales Q1 2025", changes: null, ip_address: "192.168.1.10", created_at: BASE - 86400000 * 3 },
      { id: "aud_8", actor: { id: "usr_cash2", email: "cashier2@example.com", role: "cashier" }, action: "voided", resource_type: "order", resource_id: "ord_demo_41", resource_label: "ORD-0041", changes: null, ip_address: "192.168.1.30", created_at: BASE - 86400000 * 4 },
      { id: "aud_9", actor: { id: "usr_owner", email: "owner@example.com", role: "owner" }, action: "updated", resource_type: "settings", resource_id: "settings_tax", resource_label: "Tax Settings", changes: { tax_rate: { from: 0.08, to: 0.0875 } }, ip_address: "192.168.1.10", created_at: BASE - 86400000 * 5 },
      { id: "aud_10", actor: { id: "usr_mgr1", email: "manager@example.com", role: "manager" }, action: "login", resource_type: "session", resource_id: "sess_2", resource_label: "Session", changes: null, ip_address: "192.168.1.15", created_at: BASE - 86400000 * 6 },
    ];

    return [
      http.get(`${V1}/audit-log`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const actor = url.searchParams.get("actor");
        const resource_type = url.searchParams.get("resource_type");
        const action = url.searchParams.get("action");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        // Include live business-profile change events (see pushBpAudit).
        let filtered = [...events, ...(_bpAuditEvents as unknown as typeof events)];
        if (actor) filtered = filtered.filter(e => e.actor.email.includes(actor));
        if (resource_type) filtered = filtered.filter(e => e.resource_type === resource_type);
        if (action) filtered = filtered.filter(e => e.action === action);
        filtered.sort((a, b) => b.created_at - a.created_at);
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
      }),
    ];
  })(),

  // ── Terminal: Orders, Payments, Register Sessions ─────────────────────────
  ...(() => {
    let orderSeq = 100;
    let paymentSeq = 1;

    interface TermOrder {
      id: string; orderNumber: string; stateCode: string; status: string;
      subtotalCents: number; discountCents: number; taxCents: number; totalCents: number;
      customerId?: string;
      customer_name?: string; outlet_name?: string; cashier_name?: string; channel?: string; notes?: string;
      lines: Array<{ id: string; orderId: string; productId: string; name: string; quantity: number; unitCents: number; taxCents: number; lineCents: number; taxable: boolean }>;
      payments?: Array<{ id: string; method: string; amountCents: number; cardLast4?: string; authCode?: string; status: string; createdAt: number }>;
      createdAt: number; updatedAt: number;
    }

    const termOrders = new Map<string, TermOrder>();

    // ── Seed orders ───────────────────────────────────────────────────────────
    (() => {
      const D = 86_400_000;
      const N = Date.now();
      const seed: TermOrder[] = [
        {
          id: "ord_s_1", orderNumber: "FP-0001", stateCode: "TX", status: "completed",
          customerId: "cust_1", customer_name: "Emma Johnson", outlet_name: "Main Store", cashier_name: "Alex T.", channel: "in-store",
          subtotalCents: 7497, discountCents: 0, taxCents: 656, totalCents: 8153,
          lines: [
            { id: "ol_s_1_0", orderId: "ord_s_1", productId: "prod_1", name: "Premium Whiskey 750ml", quantity: 3, unitCents: 2499, taxCents: 655, lineCents: 7497, taxable: true },
          ],
          payments: [{ id: "pay_s_1", method: "card", amountCents: 8153, cardLast4: "4242", authCode: "AUTH123456", status: "captured", createdAt: N - 2 * D }],
          createdAt: N - 2 * D, updatedAt: N - 2 * D,
        },
        {
          id: "ord_s_2", orderNumber: "FP-0002", stateCode: "TX", status: "completed",
          customerId: "cust_2", customer_name: "Marcus Rodriguez", outlet_name: "South Branch", cashier_name: "Maria S.", channel: "in-store",
          subtotalCents: 14990, discountCents: 1000, taxCents: 1226, totalCents: 15216,
          lines: [
            { id: "ol_s_2_0", orderId: "ord_s_2", productId: "prod_3", name: "House Red Wine", quantity: 2, unitCents: 1299, taxCents: 227, lineCents: 2598, taxable: true },
            { id: "ol_s_2_1", orderId: "ord_s_2", productId: "prod_2", name: "Craft Beer 6-Pack", quantity: 4, unitCents: 1299, taxCents: 454, lineCents: 5196, taxable: true },
            { id: "ol_s_2_2", orderId: "ord_s_2", productId: "prod_4", name: "Sparkling Water 1L", quantity: 12, unitCents: 599, taxCents: 628, lineCents: 7188, taxable: false },
          ],
          payments: [
            { id: "pay_s_2a", method: "cash", amountCents: 10000, status: "captured", createdAt: N - 3 * D },
            { id: "pay_s_2b", method: "card", amountCents: 5216, cardLast4: "9876", authCode: "AUTH654321", status: "captured", createdAt: N - 3 * D },
          ],
          createdAt: N - 3 * D, updatedAt: N - 3 * D,
        },
        {
          id: "ord_s_3", orderNumber: "FP-0003", stateCode: "TX", status: "refunded",
          customerId: "cust_3", customer_name: "Sarah Chen", outlet_name: "Main Store", cashier_name: "John D.", channel: "in-store",
          subtotalCents: 4998, discountCents: 0, taxCents: 437, totalCents: 5435,
          lines: [
            { id: "ol_s_3_0", orderId: "ord_s_3", productId: "prod_5", name: "Aged Cheddar 200g", quantity: 2, unitCents: 2499, taxCents: 437, lineCents: 4998, taxable: true },
          ],
          payments: [{ id: "pay_s_3", method: "card", amountCents: 5435, cardLast4: "1111", authCode: "AUTH789012", status: "refunded", createdAt: N - 5 * D }],
          notes: "Customer returned — wrong flavour. Full refund issued.",
          createdAt: N - 5 * D, updatedAt: N - 4 * D,
        },
        {
          id: "ord_s_4", orderNumber: "FP-0004", stateCode: "TX", status: "open",
          customer_name: undefined, outlet_name: "Main Store", cashier_name: "Sara K.", channel: "in-store",
          subtotalCents: 2998, discountCents: 300, taxCents: 235, totalCents: 2933,
          lines: [
            { id: "ol_s_4_0", orderId: "ord_s_4", productId: "prod_6", name: "Trail Mix 500g", quantity: 2, unitCents: 1499, taxCents: 262, lineCents: 2998, taxable: true },
          ],
          payments: [],
          createdAt: N - 1 * D, updatedAt: N - 1 * D,
        },
        {
          id: "ord_s_5", orderNumber: "FP-0005", stateCode: "CA", status: "voided",
          customerId: "cust_4", customer_name: "Linda Park", outlet_name: "South Branch", cashier_name: "Alex T.", channel: "in-store",
          subtotalCents: 8997, discountCents: 0, taxCents: 787, totalCents: 9784,
          lines: [
            { id: "ol_s_5_0", orderId: "ord_s_5", productId: "prod_1", name: "Premium Whiskey 750ml", quantity: 3, unitCents: 2999, taxCents: 787, lineCents: 8997, taxable: true },
          ],
          payments: [],
          notes: "Duplicate order — voided by cashier.",
          createdAt: N - 6 * D, updatedAt: N - 6 * D,
        },
        {
          id: "ord_s_6", orderNumber: "FP-0006", stateCode: "TX", status: "completed",
          customer_name: undefined, outlet_name: "Online", cashier_name: "System", channel: "ecommerce",
          subtotalCents: 5995, discountCents: 500, taxCents: 479, totalCents: 5974,
          lines: [
            { id: "ol_s_6_0", orderId: "ord_s_6", productId: "prod_7", name: "Organic Green Tea 100g", quantity: 5, unitCents: 1199, taxCents: 524, lineCents: 5995, taxable: false },
          ],
          payments: [{ id: "pay_s_6", method: "card", amountCents: 5974, cardLast4: "3399", authCode: "AUTH345678", status: "captured", createdAt: N }],
          createdAt: N, updatedAt: N,
        },
      ];
      seed.forEach((o) => termOrders.set(o.id, o));
    })();

    const buildOrder = (id: string, num: number, body: Record<string, unknown>, status = "open"): TermOrder => {
      const lines = (Array.isArray(body.lines) ? body.lines : []) as Array<{ productId: string; quantity: number; name?: string; unitCents?: number }>;
      const now = Date.now();
      const orderLines = lines.map((l, i) => {
        const qty = l.quantity ?? 1;
        const unit = l.unitCents ?? 999;
        const line = qty * unit;
        const tax = Math.round(line * 0.0875);
        return { id: `ol_${num}_${i}`, orderId: id, productId: l.productId, name: l.name ?? l.productId, quantity: qty, unitCents: unit, taxCents: tax, lineCents: line, taxable: true };
      });
      const subtotal = orderLines.reduce((s, l) => s + l.lineCents, 0);
      const tax = orderLines.reduce((s, l) => s + l.taxCents, 0);
      return { id, orderNumber: `FP-${String(num).padStart(4, "0")}`, stateCode: String(body.stateCode ?? "TX"), status, subtotalCents: subtotal, discountCents: 0, taxCents: tax, totalCents: subtotal + tax, customerId: body.customerId as string | undefined, lines: orderLines, createdAt: now, updatedAt: now };
    };

    const registerSessions = new Map<string, { id: string; registerId: string; status: string; openingFloatCents: number; openedAt: number }>();

    return [
      // Orders CRUD
      http.post(`${V1}/orders`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Record<string, unknown>;
        const num = ++orderSeq;
        const id = `ord_t_${num}`;
        const order = buildOrder(id, num, b);
        termOrders.set(id, order);
        return HttpResponse.json(order, { status: 201 });
      }),

      http.put(`${V1}/orders/:id`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const b = (await request.json()) as Record<string, unknown>;
        const existing = termOrders.get(id);
        if (!existing) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const updated = buildOrder(id, orderSeq, b, existing.status);
        termOrders.set(id, updated);
        return HttpResponse.json(updated);
      }),

      http.get(`${V1}/orders`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        let all = Array.from(termOrders.values());
        if (status) all = all.filter(o => o.status === status);
        all.sort((a, b) => b.createdAt - a.createdAt);
        return HttpResponse.json({ items: all.slice(offset, offset + limit), total: all.length });
      }),

      http.get(`${V1}/orders/:id`, async ({ params }) => {
        await lat();
        const order = termOrders.get(String(params["id"]));
        if (!order) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(order);
      }),

      http.post(`${V1}/orders/:id/refund`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const order = termOrders.get(id);
        if (!order) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const updated = { ...order, status: "refunded", updatedAt: Date.now() };
        termOrders.set(id, updated);
        return HttpResponse.json(updated);
      }),

      http.post(`${V1}/orders/:id/void`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const order = termOrders.get(id);
        if (!order) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const updated = { ...order, status: "voided", updatedAt: Date.now() };
        termOrders.set(id, updated);
        return HttpResponse.json(updated);
      }),

      http.post(`${V1}/orders/:id/email-receipt`, async () => {
        await lat();
        return HttpResponse.json({ ok: true });
      }),

      http.get(`${V1}/orders/:id/timeline`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const order = termOrders.get(id);
        if (!order) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const events: Array<{ id: string; type: string; label: string; actor: string; ts: number; meta?: Record<string, unknown> }> = [
          { id: "ev_1", type: "created",   label: "Order created",   actor: order.cashier_name ?? "System",  ts: order.createdAt },
        ];
        if (order.status === "completed" || order.status === "refunded") {
          events.push({ id: "ev_2", type: "payment",   label: "Payment captured",  actor: order.cashier_name ?? "System",  ts: order.createdAt + 60_000 });
          events.push({ id: "ev_3", type: "completed", label: "Order completed",   actor: order.cashier_name ?? "System",  ts: order.createdAt + 61_000 });
        }
        if (order.status === "refunded") {
          events.push({ id: "ev_4", type: "refunded",  label: "Refund issued",     actor: "Manager",   ts: order.updatedAt });
        }
        if (order.status === "voided") {
          events.push({ id: "ev_4", type: "voided",    label: "Order voided",      actor: order.cashier_name ?? "Cashier",  ts: order.updatedAt });
        }
        return HttpResponse.json({ items: events });
      }),

      // Payments
      http.post(`${V1}/payments`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { orderId: string; method: string; cashCents?: number; cardCents?: number; cardLast4?: string; amountCents?: number };
        const order = termOrders.get(b.orderId);
        const total = order?.totalCents ?? b.amountCents ?? 0;
        const cashCents = b.cashCents ?? (b.method === "cash" ? total : 0);
        const cardCents = b.cardCents ?? (b.method === "card" ? total : 0);
        const change = Math.max(0, cashCents - total);
        const payment = {
          id: `pay_${++paymentSeq}`,
          orderId: b.orderId,
          method: b.method,
          amountCents: total,
          cashCents: Math.min(cashCents, total + change),
          cardCents,
          changeCents: change,
          cardLast4: b.cardLast4,
          authCode: b.method !== "cash" ? `AUTH${Math.floor(Math.random() * 999999).toString().padStart(6, "0")}` : undefined,
          status: "captured",
          createdAt: Date.now(),
        };
        if (order) {
          termOrders.set(b.orderId, { ...order, status: "completed", updatedAt: Date.now() });
        }
        return HttpResponse.json(payment, { status: 201 });
      }),

      // Register sessions (for RegisterSessionGuard)
      http.get(`${V1}/outlets/registers/:registerId/sessions`, async ({ params }) => {
        await lat();
        const reg = String(params["registerId"]);
        const session = registerSessions.get(reg);
        return HttpResponse.json({ items: session ? [session] : [] });
      }),

      http.post(`${V1}/outlets/registers/:registerId/open`, async ({ params, request }) => {
        await lat();
        const reg = String(params["registerId"]);
        const b = (await request.json()) as { openingFloatCents?: number };
        const session = { id: `sess_${reg}_${Date.now()}`, registerId: reg, status: "open", openingFloatCents: b.openingFloatCents ?? 0, openedAt: Date.now() };
        registerSessions.set(reg, session);
        return HttpResponse.json(session, { status: 201 });
      }),

      http.post(`${V1}/outlets/registers/:registerId/close`, async ({ params }) => {
        await lat();
        const reg = String(params["registerId"]);
        const session = registerSessions.get(reg);
        if (!session) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const closed = { ...session, status: "closed", closedAt: Date.now() };
        registerSessions.set(reg, closed);
        return HttpResponse.json(closed);
      }),
    ];
  })(),

  // ── Sync / Integrations status endpoints ──────────────────────────────────
  http.get(`${V1}/sync/status`, async () => {
    await lat();
    return HttpResponse.json({ online: true, pending: 2, synced: 1847, failed: 0 });
  }),
  http.get(`${V1}/sync/queue`, async () => {
    await lat();
    const now = Date.now();
    return HttpResponse.json({ items: [
      { id: 1, event_type: "order.created", status: "pending", attempts: 0, created_at: now - 30000, last_attempted_at: null },
      { id: 2, event_type: "product.updated", status: "pending", attempts: 1, created_at: now - 120000, last_attempted_at: now - 60000 },
      { id: 3, event_type: "customer.created", status: "synced", attempts: 1, created_at: now - 600000, last_attempted_at: now - 590000 },
    ] });
  }),
  http.post(`${V1}/sync/push`, async () => {
    await lat();
    return HttpResponse.json({ ok: true, queued: 2 });
  }),

  // ── Customer loyalty tiers (settings) ────────────────────────────────────
  ...(() => {
    let loyaltyTiers = [
      { id: "ltier_1", tier_level: 1, name: "Bronze",   min_points: 0,    point_multiplier: 1.0, discount_pct: 0  },
      { id: "ltier_2", tier_level: 2, name: "Silver",   min_points: 500,  point_multiplier: 1.25, discount_pct: 2 },
      { id: "ltier_3", tier_level: 3, name: "Gold",     min_points: 1500, point_multiplier: 1.5, discount_pct: 5  },
      { id: "ltier_4", tier_level: 4, name: "Platinum", min_points: 5000, point_multiplier: 2.0, discount_pct: 10 },
    ];
    return [
      http.get(`${V1}/customers/loyalty-tiers`, async () => {
        await lat();
        return HttpResponse.json({ items: loyaltyTiers });
      }),
      http.put(`${V1}/customers/loyalty-tiers/:level`, async ({ params, request }) => {
        await lat();
        const level = Number(params["level"]);
        const b = (await request.json()) as Partial<typeof loyaltyTiers[0]>;
        const idx = loyaltyTiers.findIndex(t => t.tier_level === level);
        if (idx !== -1) loyaltyTiers[idx] = { ...loyaltyTiers[idx], ...b };
        return HttpResponse.json(loyaltyTiers[idx] ?? b);
      }),
    ];
  })(),

  // ── Imports (product CSV import) ──────────────────────────────────────────
  http.post(`${V1}/imports/products`, async () => {
    await lat();
    return HttpResponse.json({ batch_id: `batch_${Date.now()}`, total: 12, status: "queued" }, { status: 201 });
  }),

  // ── Store Locations ───────────────────────────────────────────────────────
  ...(() => {
    let seq = 0;
    const BASE = Date.now();
    interface SL { id: string; tenant_id: string; outlet_id: string | null; aisle: string; shelf: string; bin: string; label: string; description: string | null; created_at: number; updated_at: number; }
    interface PL { id: string; product_id: string; location_id: string; qty_at_location: number; notes: string | null; aisle: string; shelf: string; bin: string; label: string; product_name: string; product_sku: string; created_at: number; updated_at: number; }

    let locations: SL[] = [
      { id: "loc_A1A", tenant_id: "t1", outlet_id: null, aisle: "A", shelf: "1", bin: "A", label: "A-1-A", description: "Beverages — water & soda", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_A1B", tenant_id: "t1", outlet_id: null, aisle: "A", shelf: "1", bin: "B", label: "A-1-B", description: "Beverages — energy drinks", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_A2A", tenant_id: "t1", outlet_id: null, aisle: "A", shelf: "2", bin: "A", label: "A-2-A", description: "Snacks — chips", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_B1A", tenant_id: "t1", outlet_id: null, aisle: "B", shelf: "1", bin: "A", label: "B-1-A", description: "Tobacco — cigarettes", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_B1B", tenant_id: "t1", outlet_id: null, aisle: "B", shelf: "1", bin: "B", label: "B-1-B", description: "Tobacco — cigars", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_B2A", tenant_id: "t1", outlet_id: null, aisle: "B", shelf: "2", bin: "A", label: "B-2-A", description: "Vape — disposables", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_C1A", tenant_id: "t1", outlet_id: null, aisle: "C", shelf: "1", bin: "A", label: "C-1-A", description: "Candy & gum", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
      { id: "loc_FRZE1", tenant_id: "t1", outlet_id: null, aisle: "Freezer", shelf: "1", bin: "", label: "FREEZER-1", description: "Frozen foods & ice cream", created_at: BASE - 864e5, updated_at: BASE - 864e5 },
    ];

    let productLocs: PL[] = [
      { id: "pl_1", product_id: "prod_1", location_id: "loc_A1A", qty_at_location: 48, notes: null, aisle: "A", shelf: "1", bin: "A", label: "A-1-A", product_name: "Niagara Water 24pk", product_sku: "005008", created_at: BASE, updated_at: BASE },
      { id: "pl_2", product_id: "prod_2", location_id: "loc_A1B", qty_at_location: 24, notes: null, aisle: "A", shelf: "1", bin: "B", label: "A-1-B", product_name: "Monster Energy 16oz", product_sku: "005020", created_at: BASE, updated_at: BASE },
      { id: "pl_3", product_id: "prod_3", location_id: "loc_B1A", qty_at_location: 120, notes: "Marlboro Red", aisle: "B", shelf: "1", bin: "A", label: "B-1-A", product_name: "Marlboro Red King", product_sku: "005050", created_at: BASE, updated_at: BASE },
      { id: "pl_4", product_id: "prod_4", location_id: "loc_B2A", qty_at_location: 60, notes: null, aisle: "B", shelf: "2", bin: "A", label: "B-2-A", product_name: "Elf Bar BC5000 Mango", product_sku: "005100", created_at: BASE, updated_at: BASE },
    ];

    const buildMap = (locs: SL[], pls: PL[]) => {
      const plByLoc = new Map<string, PL[]>();
      for (const pl of pls) { const a = plByLoc.get(pl.location_id) ?? []; a.push(pl); plByLoc.set(pl.location_id, a); }
      const aisleMap = new Map<string, Map<string, SL[]>>();
      for (const loc of locs) {
        if (!aisleMap.has(loc.aisle)) aisleMap.set(loc.aisle, new Map());
        const sm = aisleMap.get(loc.aisle)!;
        const sk = loc.shelf || "(none)"; const bins = sm.get(sk) ?? []; bins.push(loc); sm.set(sk, bins);
      }
      const aisles = [];
      for (const [aisle, sm] of aisleMap) {
        const shelves = [];
        for (const [shelf, ls] of sm) shelves.push({ name: shelf, bins: ls.map(l => ({ location: l, products: plByLoc.get(l.id) ?? [] })) });
        aisles.push({ name: aisle, shelves });
      }
      return { aisles };
    };

    return [
      http.get(`${V1}/store-locations`, async () => { await lat(); return HttpResponse.json({ items: locations }); }),
      http.get(`${V1}/store-locations/map`, async () => { await lat(); return HttpResponse.json(buildMap(locations, productLocs)); }),
      http.post(`${V1}/store-locations`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<SL>;
        const shelf = b.shelf ?? ""; const bin = b.bin ?? "";
        let label = (b.aisle ?? "").toUpperCase(); if (shelf) label += `-${shelf}`; if (bin) label += `-${bin}`;
        const now = Date.now();
        const loc: SL = { id: `loc_${++seq}`, tenant_id: "t1", outlet_id: b.outlet_id ?? null, aisle: b.aisle ?? "", shelf, bin, label, description: b.description ?? null, created_at: now, updated_at: now };
        locations.push(loc);
        return HttpResponse.json(loc, { status: 201 });
      }),
      http.patch(`${V1}/store-locations/:id`, async ({ params, request }) => {
        await lat();
        const idx = locations.findIndex(l => l.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<SL>;
        locations[idx] = { ...locations[idx], ...b, updated_at: Date.now() };
        return HttpResponse.json(locations[idx]);
      }),
      http.delete(`${V1}/store-locations/:id`, async ({ params }) => {
        await lat();
        locations = locations.filter(l => l.id !== String(params["id"]));
        productLocs = productLocs.filter(pl => pl.location_id !== String(params["id"]));
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${V1}/product-locations`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const locationId = url.searchParams.get("location_id");
        const productId = url.searchParams.get("product_id");
        let filtered = productLocs;
        if (locationId) filtered = filtered.filter(pl => pl.location_id === locationId);
        if (productId) filtered = filtered.filter(pl => pl.product_id === productId);
        return HttpResponse.json({ items: filtered });
      }),
      http.post(`${V1}/product-locations`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { product_id: string; location_id: string; qty_at_location?: number; notes?: string | null };
        const loc = locations.find(l => l.id === b.location_id);
        const now = Date.now();
        const existing = productLocs.findIndex(pl => pl.product_id === b.product_id && pl.location_id === b.location_id);
        if (existing !== -1) {
          productLocs[existing] = { ...productLocs[existing], qty_at_location: b.qty_at_location ?? productLocs[existing].qty_at_location, notes: b.notes ?? productLocs[existing].notes, updated_at: now };
          return HttpResponse.json(productLocs[existing], { status: 201 });
        }
        const pl: PL = { id: `pl_${++seq}`, product_id: b.product_id, location_id: b.location_id, qty_at_location: b.qty_at_location ?? 0, notes: b.notes ?? null, aisle: loc?.aisle ?? "", shelf: loc?.shelf ?? "", bin: loc?.bin ?? "", label: loc?.label ?? "", product_name: "Product", product_sku: b.product_id, created_at: now, updated_at: now };
        productLocs.push(pl);
        return HttpResponse.json(pl, { status: 201 });
      }),
      http.post(`${V1}/product-locations/bulk`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { assignments: Array<{ product_id: string; location_id: string }> };
        return HttpResponse.json({ assigned: b.assignments.length });
      }),
      http.delete(`${V1}/product-locations`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const pid = url.searchParams.get("product_id"); const lid = url.searchParams.get("location_id");
        productLocs = productLocs.filter(pl => !(pl.product_id === pid && pl.location_id === lid));
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Product Batches / Expiry ──────────────────────────────────────────────
  ...(() => {
    let seq = 0;
    const BASE = Date.now();
    const DAY = 86400000;
    interface PB { id: string; product_id: string; batch_number: string; expiry_date: number | null; qty: number; cost_cents: number; received_at: number; supplier_name: string | null; notes: string | null; product_name: string; product_sku: string; category: string; expiry_status: string | undefined; days_until_expiry: number | null; created_at: number; updated_at: number; }

    const calcStatus = (expiry: number | null) => {
      if (!expiry) return undefined;
      const d = Math.floor((expiry - Date.now()) / DAY);
      if (d < 0) return "expired"; if (d <= 7) return "critical"; if (d <= 30) return "warning"; return "ok";
    };
    const calcDays = (expiry: number | null) => expiry == null ? null : Math.floor((expiry - Date.now()) / DAY);

    let batches: PB[] = [
      { id: "batch_1", product_id: "prod_5", batch_number: "LOT-2024-001", expiry_date: BASE - 2 * DAY, qty: 12, cost_cents: 180, received_at: BASE - 60 * DAY, supplier_name: "Core-Mark", notes: null, product_name: "Nature Valley Bars 12pk", product_sku: "005200", category: "Snacks", expiry_status: "expired", days_until_expiry: -2, created_at: BASE - 60 * DAY, updated_at: BASE - 60 * DAY },
      { id: "batch_2", product_id: "prod_6", batch_number: "LOT-2024-002", expiry_date: BASE + 4 * DAY, qty: 36, cost_cents: 240, received_at: BASE - 30 * DAY, supplier_name: "KeHE", notes: "Check dates", product_name: "Chobani Greek Yogurt", product_sku: "005210", category: "Dairy", expiry_status: "critical", days_until_expiry: 4, created_at: BASE - 30 * DAY, updated_at: BASE - 30 * DAY },
      { id: "batch_3", product_id: "prod_7", batch_number: "LOT-2024-003", expiry_date: BASE + 18 * DAY, qty: 24, cost_cents: 320, received_at: BASE - 10 * DAY, supplier_name: "Core-Mark", notes: null, product_name: "Red Bull 8.4oz 4pk", product_sku: "005220", category: "Beverages", expiry_status: "warning", days_until_expiry: 18, created_at: BASE - 10 * DAY, updated_at: BASE - 10 * DAY },
      { id: "batch_4", product_id: "prod_8", batch_number: "LOT-2024-004", expiry_date: BASE + 6 * DAY, qty: 8, cost_cents: 150, received_at: BASE - 45 * DAY, supplier_name: "McLane", notes: "Near expired — discount", product_name: "Lays Classic Chips 1oz", product_sku: "005230", category: "Snacks", expiry_status: "critical", days_until_expiry: 6, created_at: BASE - 45 * DAY, updated_at: BASE - 45 * DAY },
      { id: "batch_5", product_id: "prod_9", batch_number: "LOT-2025-001", expiry_date: BASE + 120 * DAY, qty: 48, cost_cents: 95, received_at: BASE - 5 * DAY, supplier_name: "Core-Mark", notes: null, product_name: "Marlboro Red King 1ct", product_sku: "005050", category: "Tobacco", expiry_status: "ok", days_until_expiry: 120, created_at: BASE - 5 * DAY, updated_at: BASE - 5 * DAY },
      { id: "batch_6", product_id: "prod_10", batch_number: "LOT-2024-005", expiry_date: BASE - 10 * DAY, qty: 6, cost_cents: 200, received_at: BASE - 90 * DAY, supplier_name: "KeHE", notes: null, product_name: "Silk Almond Milk 64oz", product_sku: "005240", category: "Dairy", expiry_status: "expired", days_until_expiry: -10, created_at: BASE - 90 * DAY, updated_at: BASE - 90 * DAY },
      { id: "batch_7", product_id: "prod_11", batch_number: "LOT-2025-002", expiry_date: BASE + 25 * DAY, qty: 60, cost_cents: 110, received_at: BASE - 2 * DAY, supplier_name: "McLane", notes: null, product_name: "Snickers Bar 1.86oz", product_sku: "005250", category: "Candy", expiry_status: "warning", days_until_expiry: 25, created_at: BASE - 2 * DAY, updated_at: BASE - 2 * DAY },
    ];

    return [
      http.get(`${V1}/product-batches/summary`, async () => {
        await lat();
        const now = Date.now();
        const activeQty = batches.filter(b => b.qty > 0);
        return HttpResponse.json({
          expired: activeQty.filter(b => b.expiry_date != null && b.expiry_date < now).length,
          critical: activeQty.filter(b => b.expiry_date != null && b.expiry_date >= now && b.expiry_date < now + 7 * DAY).length,
          warning: activeQty.filter(b => b.expiry_date != null && b.expiry_date >= now + 7 * DAY && b.expiry_date < now + 30 * DAY).length,
          ok: activeQty.filter(b => b.expiry_date == null || b.expiry_date >= now + 30 * DAY).length,
          expired_qty: activeQty.filter(b => b.expiry_date != null && b.expiry_date < now).reduce((s, b) => s + b.qty, 0),
          critical_qty: activeQty.filter(b => b.expiry_date != null && b.expiry_date >= now && b.expiry_date < now + 7 * DAY).reduce((s, b) => s + b.qty, 0),
          warning_qty: activeQty.filter(b => b.expiry_date != null && b.expiry_date >= now + 7 * DAY && b.expiry_date < now + 30 * DAY).reduce((s, b) => s + b.qty, 0),
        });
      }),
      http.get(`${V1}/product-batches`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const productId = url.searchParams.get("product_id");
        const now = Date.now();
        let filtered = batches.filter(b => b.qty > 0);
        if (productId) filtered = filtered.filter(b => b.product_id === productId);
        if (status === "expired") filtered = filtered.filter(b => b.expiry_date != null && b.expiry_date < now);
        else if (status === "critical") filtered = filtered.filter(b => b.expiry_date != null && b.expiry_date >= now && b.expiry_date < now + 7 * DAY);
        else if (status === "warning") filtered = filtered.filter(b => b.expiry_date != null && b.expiry_date >= now + 7 * DAY && b.expiry_date < now + 30 * DAY);
        else if (status === "ok") filtered = filtered.filter(b => b.expiry_date == null || b.expiry_date >= now + 30 * DAY);
        return HttpResponse.json({ items: filtered.map(b => ({ ...b, expiry_status: calcStatus(b.expiry_date), days_until_expiry: calcDays(b.expiry_date) })) });
      }),
      http.post(`${V1}/product-batches`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<PB>;
        const now = Date.now();
        const batch: PB = { id: `batch_${++seq}`, product_id: b.product_id ?? "", batch_number: b.batch_number ?? "", expiry_date: b.expiry_date ?? null, qty: b.qty ?? 0, cost_cents: b.cost_cents ?? 0, received_at: b.received_at ?? now, supplier_name: b.supplier_name ?? null, notes: b.notes ?? null, product_name: "Product", product_sku: b.product_id ?? "", category: "", expiry_status: calcStatus(b.expiry_date ?? null), days_until_expiry: calcDays(b.expiry_date ?? null), created_at: now, updated_at: now };
        batches.push(batch);
        return HttpResponse.json(batch, { status: 201 });
      }),
      http.patch(`${V1}/product-batches/:id`, async ({ params, request }) => {
        await lat();
        const idx = batches.findIndex(b => b.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<PB>;
        batches[idx] = { ...batches[idx], ...b, expiry_status: calcStatus(b.expiry_date ?? batches[idx].expiry_date), days_until_expiry: calcDays(b.expiry_date ?? batches[idx].expiry_date), updated_at: Date.now() };
        return HttpResponse.json(batches[idx]);
      }),
      http.delete(`${V1}/product-batches/:id`, async ({ params }) => {
        await lat();
        batches = batches.filter(b => b.id !== String(params["id"]));
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Customer Invoices ─────────────────────────────────────────────────────
  ...(() => {
    let seq = 1000;
    const BASE = Date.now();
    const DAY = 86400000;
    type IStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "void";
    interface CIL { id: string; invoice_id: string; product_id: string | null; upc: string | null; sku: string | null; name: string; quantity: number; unit_price_cents: number; discount_cents: number; tax_rate_pct: number; line_total_cents: number; sort_order: number; }
    interface CI { id: string; invoice_number: string; customer_id: string | null; customer_name: string; customer_email: string | null; customer_phone: string | null; billing_address: string | null; status: IStatus; subtotal_cents: number; tax_cents: number; discount_cents: number; total_cents: number; paid_cents: number; due_date: number | null; paid_at: number | null; notes: string | null; created_at: number; updated_at: number; lines?: CIL[]; }

    const makeLines = (inv_id: string, lines: Omit<CIL, "id" | "invoice_id">[]): CIL[] =>
      lines.map((l, i) => ({ ...l, id: `cil_${inv_id}_${i}`, invoice_id: inv_id }));

    let invoices: CI[] = [
      { id: "cinv_1", invoice_number: "INV-01001", customer_id: "cust_1", customer_name: "Alice Johnson", customer_email: "alice@example.com", customer_phone: "555-0101", billing_address: "123 Main St, Austin TX 78701", status: "paid", subtotal_cents: 4599, tax_cents: 380, discount_cents: 0, total_cents: 4979, paid_cents: 4979, due_date: BASE + 30 * DAY, paid_at: BASE - 5 * DAY, notes: null, created_at: BASE - 10 * DAY, updated_at: BASE - 5 * DAY },
      { id: "cinv_2", invoice_number: "INV-01002", customer_id: "cust_2", customer_name: "Bob Martinez", customer_email: "bob@example.com", customer_phone: "555-0102", billing_address: "456 Oak Ave, Dallas TX 75201", status: "sent", subtotal_cents: 12750, tax_cents: 1052, discount_cents: 500, total_cents: 13302, paid_cents: 0, due_date: BASE + 15 * DAY, paid_at: null, notes: "Net 15 terms", created_at: BASE - 3 * DAY, updated_at: BASE - 3 * DAY },
      { id: "cinv_3", invoice_number: "INV-01003", customer_id: null, customer_name: "Walk-in Customer", customer_email: null, customer_phone: null, billing_address: null, status: "draft", subtotal_cents: 2340, tax_cents: 193, discount_cents: 0, total_cents: 2533, paid_cents: 0, due_date: null, paid_at: null, notes: null, created_at: BASE - 1 * DAY, updated_at: BASE - 1 * DAY },
      { id: "cinv_4", invoice_number: "INV-01004", customer_id: "cust_3", customer_name: "Carol White", customer_email: "carol@example.com", customer_phone: "555-0103", billing_address: "789 Pine Rd, Houston TX 77001", status: "overdue", subtotal_cents: 8900, tax_cents: 735, discount_cents: 0, total_cents: 9635, paid_cents: 5000, due_date: BASE - 5 * DAY, paid_at: null, notes: "Partial payment received", created_at: BASE - 45 * DAY, updated_at: BASE - 5 * DAY },
    ];
    const linesByInv: Record<string, CIL[]> = {
      cinv_1: makeLines("cinv_1", [{ product_id: "prod_1", upc: "123123123", sku: "005008", name: "Niagara Water 24pk", quantity: 3, unit_price_cents: 325, discount_cents: 0, tax_rate_pct: 8.25, line_total_cents: 1056, sort_order: 0 }, { product_id: "prod_3", upc: "456456456", sku: "005050", name: "Marlboro Red King", quantity: 12, unit_price_cents: 299, discount_cents: 0, tax_rate_pct: 8.25, line_total_cents: 3923, sort_order: 1 }]),
      cinv_2: makeLines("cinv_2", [{ product_id: "prod_4", upc: "789789789", sku: "005100", name: "Elf Bar BC5000 Mango", quantity: 10, unit_price_cents: 1275, discount_cents: 500, tax_rate_pct: 8.25, line_total_cents: 13302, sort_order: 0 }]),
      cinv_3: makeLines("cinv_3", [{ product_id: "prod_2", upc: "111222333", sku: "005020", name: "Monster Energy 16oz", quantity: 6, unit_price_cents: 390, discount_cents: 0, tax_rate_pct: 8.25, line_total_cents: 2533, sort_order: 0 }]),
      cinv_4: makeLines("cinv_4", [{ product_id: null, upc: null, sku: null, name: "Custom Repair Service", quantity: 1, unit_price_cents: 8900, discount_cents: 0, tax_rate_pct: 8.25, line_total_cents: 9635, sort_order: 0 }]),
    };

    const upcCatalog: Record<string, { product_id: string; name: string; price_cents: number; sku: string }> = {
      "123123123": { product_id: "prod_1", name: "Niagara Water 24pk", price_cents: 325, sku: "005008" },
      "456456456": { product_id: "prod_3", name: "Marlboro Red King", price_cents: 299, sku: "005050" },
      "789789789": { product_id: "prod_4", name: "Elf Bar BC5000 Mango", price_cents: 1275, sku: "005100" },
      "111222333": { product_id: "prod_2", name: "Monster Energy 16oz", price_cents: 390, sku: "005020" },
      "005008": { product_id: "prod_1", name: "Niagara Water 24pk", price_cents: 325, sku: "005008" },
      "005050": { product_id: "prod_3", name: "Marlboro Red King", price_cents: 299, sku: "005050" },
      "005100": { product_id: "prod_4", name: "Elf Bar BC5000 Mango", price_cents: 1275, sku: "005100" },
    };

    return [
      http.get(`${V1}/customer-invoices/lookup-upc`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const upc = url.searchParams.get("upc") ?? "";
        const item = upcCatalog[upc];
        if (!item) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(item);
      }),
      http.get(`${V1}/customer-invoices`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const customerId = url.searchParams.get("customer_id");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        let filtered = invoices;
        if (status) filtered = filtered.filter(i => i.status === status);
        if (customerId) filtered = filtered.filter(i => i.customer_id === customerId);
        const total = filtered.length;
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total });
      }),
      http.get(`${V1}/customer-invoices/:id`, async ({ params }) => {
        await lat();
        const inv = invoices.find(i => i.id === String(params["id"]));
        if (!inv) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ ...inv, lines: linesByInv[inv.id] ?? [] });
      }),
      http.post(`${V1}/customer-invoices`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<CI & { lines: CIL[] }>;
        const now = Date.now();
        const lines = (b.lines ?? []) as CIL[];
        const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price_cents, 0);
        const discount = lines.reduce((s, l) => s + (l.discount_cents ?? 0), 0);
        const tax = Math.round((subtotal - discount) * 0.0825);
        const total = subtotal - discount + tax;
        const id = `cinv_${++seq}`;
        const inv: CI = { id, invoice_number: `INV-0${seq}`, customer_id: b.customer_id ?? null, customer_name: b.customer_name ?? "Walk-in Customer", customer_email: b.customer_email ?? null, customer_phone: b.customer_phone ?? null, billing_address: b.billing_address ?? null, status: "draft", subtotal_cents: subtotal, tax_cents: tax, discount_cents: discount, total_cents: total, paid_cents: 0, due_date: b.due_date ?? null, paid_at: null, notes: b.notes ?? null, created_at: now, updated_at: now };
        invoices.unshift(inv);
        linesByInv[id] = makeLines(id, lines.map((l, i) => ({ ...l, sort_order: i, line_total_cents: l.quantity * l.unit_price_cents - (l.discount_cents ?? 0) + Math.round((l.quantity * l.unit_price_cents - (l.discount_cents ?? 0)) * 0.0825) })));
        return HttpResponse.json({ ...inv, lines: linesByInv[id] }, { status: 201 });
      }),
      http.patch(`${V1}/customer-invoices/:id/status`, async ({ params, request }) => {
        await lat();
        const idx = invoices.findIndex(i => i.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { status: IStatus; paid_cents?: number };
        const now = Date.now();
        invoices[idx] = { ...invoices[idx], status: b.status, paid_cents: b.paid_cents ?? invoices[idx].paid_cents, paid_at: b.status === "paid" ? now : invoices[idx].paid_at, updated_at: now };
        return HttpResponse.json({ ...invoices[idx], lines: linesByInv[String(params["id"])] ?? [] });
      }),
    ];
  })(),

  // ─── Serial Numbers (FE-17 / BE-24) ─────────────────────────────────────────
  ...(() => {
    type SN = {
      id: string; product_id: string; product_name: string | null; product_sku: string | null;
      serial: string; status: "in_stock" | "sold" | "returned" | "service";
      sold_at: number | null; service_order_id: string | null;
      received_at: number; notes: string | null; created_at: number;
    };

    const base = Date.now();
    const day = 86_400_000;
    let seq = 0;

    const serials: SN[] = [
      { id: "sn_001", product_id: "prod_001", product_name: "Apple iPad Pro 12.9\"", product_sku: "IPAD-PRO-129", serial: "DMPXQ123ABC1", status: "in_stock", sold_at: null, service_order_id: null, received_at: base - 10 * day, notes: null, created_at: base - 10 * day },
      { id: "sn_002", product_id: "prod_001", product_name: "Apple iPad Pro 12.9\"", product_sku: "IPAD-PRO-129", serial: "DMPXQ456DEF2", status: "in_stock", sold_at: null, service_order_id: null, received_at: base - 10 * day, notes: null, created_at: base - 10 * day },
      { id: "sn_003", product_id: "prod_002", product_name: "Sony WH-1000XM5 Headphones", product_sku: "SONY-WH1000XM5", serial: "5012345600001", status: "sold", sold_at: base - 2 * day, service_order_id: null, received_at: base - 30 * day, notes: null, created_at: base - 30 * day },
      { id: "sn_004", product_id: "prod_002", product_name: "Sony WH-1000XM5 Headphones", product_sku: "SONY-WH1000XM5", serial: "5012345600002", status: "returned", sold_at: base - 5 * day, service_order_id: null, received_at: base - 20 * day, notes: "Customer returned — defective hinge", created_at: base - 20 * day },
      { id: "sn_005", product_id: "prod_003", product_name: "Garmin Fenix 7X Pro Watch", product_sku: "GARMIN-FENIX7X", serial: "GRX7890123001", status: "service", sold_at: null, service_order_id: "so_1", received_at: base - 15 * day, notes: "Screen damage", created_at: base - 15 * day },
      { id: "sn_006", product_id: "prod_003", product_name: "Garmin Fenix 7X Pro Watch", product_sku: "GARMIN-FENIX7X", serial: "GRX7890123002", status: "in_stock", sold_at: null, service_order_id: null, received_at: base - 8 * day, notes: null, created_at: base - 8 * day },
      { id: "sn_007", product_id: "prod_004", product_name: "DJI Mini 4 Pro Drone", product_sku: "DJI-MINI4PRO", serial: "DJI20240001001", status: "sold", sold_at: base - 1 * day, service_order_id: null, received_at: base - 25 * day, notes: null, created_at: base - 25 * day },
    ];

    return [
      http.get(`${V1}/inventory/serials`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const status = url.searchParams.get("status");
        const product_id = url.searchParams.get("product_id");
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        let filtered = [...serials];
        if (status) filtered = filtered.filter(s => s.status === status);
        if (product_id) filtered = filtered.filter(s => s.product_id === product_id);
        if (q) filtered = filtered.filter(s =>
          s.serial.toLowerCase().includes(q) ||
          (s.product_name ?? "").toLowerCase().includes(q) ||
          (s.product_sku ?? "").toLowerCase().includes(q)
        );
        const total = filtered.length;
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total, limit, offset });
      }),

      http.post(`${V1}/inventory/serials`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<SN>;
        if (!b.serial) return HttpResponse.json({ error: { code: "validation" } }, { status: 400 });
        if (serials.some(s => s.serial === b.serial)) {
          return HttpResponse.json({ error: { code: "duplicate_serial" } }, { status: 409 });
        }
        const now = Date.now();
        const sn: SN = {
          id: `sn_${++seq}`,
          product_id: b.product_id ?? "",
          product_name: b.product_name ?? null,
          product_sku: b.product_sku ?? null,
          serial: b.serial ?? "",
          status: "in_stock",
          sold_at: null,
          service_order_id: null,
          received_at: now,
          notes: b.notes ?? null,
          created_at: now,
        };
        serials.unshift(sn);
        return HttpResponse.json(sn, { status: 201 });
      }),

      http.get(`${V1}/inventory/serials/:id`, async ({ params }) => {
        await lat();
        const sn = serials.find(s => s.id === String(params["id"]));
        if (!sn) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(sn);
      }),

      http.patch(`${V1}/inventory/serials/:id`, async ({ params, request }) => {
        await lat();
        const idx = serials.findIndex(s => s.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<SN>;
        const prev = serials[idx]!;
        serials[idx] = {
          ...prev,
          status: b.status ?? prev.status,
          sold_at: b.status === "sold" && !prev.sold_at ? Date.now() : prev.sold_at,
          service_order_id: b.service_order_id ?? prev.service_order_id,
          notes: b.notes !== undefined ? b.notes : prev.notes,
        };
        return HttpResponse.json(serials[idx]);
      }),
    ];
  })(),

  // ── Reorder Suggestions (BE-27 / FE-23) ──────────────────────────────────
  ...(() => {
    const D = 86400000;
    const now = Date.now();

    interface RS {
      product_id: string; product_name: string; sku: string | null;
      stock_qty: number; reorder_pt: number; suggested_qty: number;
      preferred_vendor_id: string | null; preferred_vendor_name: string | null;
      last_unit_cost_cents: number | null; last_ordered_at: number | null; last_ordered_qty: number | null;
    }

    const suggestions: RS[] = [
      { product_id: "prod_001", product_name: "Marlboro Red King",     sku: "MRL-RED-K", stock_qty: 3, reorder_pt: 10, suggested_qty: 20, preferred_vendor_id: "sup_001", preferred_vendor_name: "Core-Mark North", last_unit_cost_cents: 450, last_ordered_at: now - 14*D, last_ordered_qty: 20 },
      { product_id: "prod_002", product_name: "Newport Menthol 100s",  sku: "NWP-M100",  stock_qty: 1, reorder_pt: 8,  suggested_qty: 16, preferred_vendor_id: "sup_001", preferred_vendor_name: "Core-Mark North", last_unit_cost_cents: 380, last_ordered_at: now - 14*D, last_ordered_qty: 16 },
      { product_id: "prod_003", product_name: "Camel Blue Box",        sku: "CAM-BLU",   stock_qty: 0, reorder_pt: 6,  suggested_qty: 12, preferred_vendor_id: "sup_001", preferred_vendor_name: "Core-Mark North", last_unit_cost_cents: 410, last_ordered_at: now - 28*D, last_ordered_qty: 12 },
      { product_id: "prod_004", product_name: "Swisher Sweets Original",sku: "SWI-OG",   stock_qty: 4, reorder_pt: 15, suggested_qty: 30, preferred_vendor_id: "sup_002", preferred_vendor_name: "McLane Company",  last_unit_cost_cents: 200, last_ordered_at: now - 21*D, last_ordered_qty: 30 },
      { product_id: "prod_005", product_name: "White Owl Cigarillos",  sku: "WOW-CIG",   stock_qty: 2, reorder_pt: 12, suggested_qty: 24, preferred_vendor_id: "sup_002", preferred_vendor_name: "McLane Company",  last_unit_cost_cents: 175, last_ordered_at: now - 21*D, last_ordered_qty: 24 },
      { product_id: "prod_006", product_name: "Backwoods Honey Berry", sku: "BKW-HB",    stock_qty: 0, reorder_pt: 10, suggested_qty: 20, preferred_vendor_id: "sup_002", preferred_vendor_name: "McLane Company",  last_unit_cost_cents: 180, last_ordered_at: now - 35*D, last_ordered_qty: 20 },
      { product_id: "prod_007", product_name: "5-Hour Energy Berry",   sku: "5HR-BRY",   stock_qty: 5, reorder_pt: 24, suggested_qty: 48, preferred_vendor_id: "sup_003", preferred_vendor_name: "Eby-Brown",       last_unit_cost_cents: 320, last_ordered_at: now -  7*D, last_ordered_qty: 48 },
      { product_id: "prod_008", product_name: "Monster Energy Original",sku: "MON-OG",   stock_qty: 3, reorder_pt: 12, suggested_qty: 24, preferred_vendor_id: null,       preferred_vendor_name: null,              last_unit_cost_cents: null, last_ordered_at: null, last_ordered_qty: null },
    ];

    const vendorHistory: Record<string, { po_id: string; po_number: number; created_at: number; total_cost_cents: number; item_count: number; status: string }[]> = {
      sup_001: [
        { po_id: "vh_1a", po_number: 3990, created_at: now - 14*D, total_cost_cents: 17600, item_count: 3, status: "received" },
        { po_id: "vh_1b", po_number: 3975, created_at: now - 28*D, total_cost_cents: 14820, item_count: 3, status: "received" },
        { po_id: "vh_1c", po_number: 3960, created_at: now - 42*D, total_cost_cents: 16200, item_count: 3, status: "received" },
      ],
      sup_002: [
        { po_id: "vh_2a", po_number: 3985, created_at: now - 21*D, total_cost_cents: 12900, item_count: 3, status: "received" },
        { po_id: "vh_2b", po_number: 3968, created_at: now - 35*D, total_cost_cents: 11500, item_count: 2, status: "received" },
      ],
      sup_003: [
        { po_id: "vh_3a", po_number: 3994, created_at: now -  7*D, total_cost_cents: 15360, item_count: 1, status: "received" },
        { po_id: "vh_3b", po_number: 3980, created_at: now - 21*D, total_cost_cents: 14080, item_count: 1, status: "received" },
      ],
    };

    return [
      http.get(`${V1}/inventory/reorder-suggestions`, async () => {
        await lat();
        return HttpResponse.json({ items: suggestions });
      }),

      http.get(`${V1}/purchasing/vendor-history`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const vendorId = url.searchParams.get("vendorId");
        if (vendorId) return HttpResponse.json({ items: vendorHistory[vendorId] ?? [] });
        return HttpResponse.json({ history: vendorHistory });
      }),

      http.post(`${V1}/inventory/reorder-suggestions/create-po`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { lines: { productId: string; vendorId: string; quantity: number; unitCostCents: number }[] };
        const vendorIds = [...new Set(body.lines.map(l => l.vendorId))];
        const orders = vendorIds.map((vid, i) => ({
          id: `po_reorder_${Date.now()}_${i}`,
          supplier_id: vid,
          status: "ordered",
          lines: body.lines.filter(l => l.vendorId === vid),
          created_at: Date.now(),
        }));
        return HttpResponse.json({ orders }, { status: 201 });
      }),
    ];
  })(),

  // ── Cycle Count Sessions (BE-10 / FE-26) ─────────────────────────────────
  ...(() => {
    interface CCLine {
      id: string; session_id: string; product_id: string;
      product_name: string; sku: string | null;
      expected_qty: number; counted_qty: number | null;
      variance: number | null; recorded_at: number | null;
    }
    interface CCSession {
      id: string; status: "open" | "closed"; opened_by: string;
      opened_at: number; closed_at: number | null; note: string | null;
    }
    const BASE_TS = Date.now();
    let ccSeq = 0;
    let clSeq = 0;

    const SEED_PRODUCTS = [
      { id: "prod_001", name: "Marlboro Red King",      sku: "MRL-RED-K", qty: 3  },
      { id: "prod_002", name: "Newport Menthol 100s",   sku: "NWP-M100",  qty: 1  },
      { id: "prod_003", name: "Camel Blue Box",         sku: "CAM-BLU",   qty: 0  },
      { id: "prod_004", name: "Swisher Sweets Original",sku: "SWI-OG",    qty: 4  },
      { id: "prod_005", name: "White Owl Cigarillos",   sku: "WOW-CIG",   qty: 2  },
      { id: "prod_006", name: "Backwoods Honey Berry",  sku: "BKW-HB",    qty: 0  },
      { id: "prod_007", name: "5-Hour Energy Berry",    sku: "5HR-BRY",   qty: 5  },
      { id: "prod_008", name: "Monster Energy Original",sku: "MON-OG",    qty: 3  },
    ];

    const closedLines: CCLine[] = SEED_PRODUCTS.map((p, i) => ({
      id: `ccl_demo_${i}`,
      session_id: "cc_demo_closed",
      product_id: p.id,
      product_name: p.name,
      sku: p.sku,
      expected_qty: p.qty,
      counted_qty: p.qty + (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1),
      variance: i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1,
      recorded_at: BASE_TS - 7 * 86400_000 + 1800_000,
    }));

    const sessions: CCSession[] = [
      {
        id: "cc_demo_closed",
        status: "closed",
        opened_by: "admin@example.com",
        opened_at: BASE_TS - 7 * 86400_000,
        closed_at: BASE_TS - 7 * 86400_000 + 3600_000,
        note: "Weekly count — main stockroom",
      },
    ];
    const linesMap = new Map<string, CCLine[]>([["cc_demo_closed", closedLines]]);

    return [
      http.get(`${V1}/inventory/counts`, async () => {
        await lat();
        return HttpResponse.json({ items: [...sessions].reverse() });
      }),

      // sub-path BEFORE /:id
      http.post(`${V1}/inventory/counts`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { note?: string };
        const id = `cc_${++ccSeq}_${Date.now()}`;
        const session: CCSession = {
          id, status: "open", opened_by: "admin@example.com",
          opened_at: Date.now(), closed_at: null, note: body.note ?? null,
        };
        const newLines: CCLine[] = SEED_PRODUCTS.map(p => ({
          id: `ccl_${++clSeq}`,
          session_id: id,
          product_id: p.id,
          product_name: p.name,
          sku: p.sku,
          expected_qty: p.qty,
          counted_qty: null,
          variance: null,
          recorded_at: null,
        }));
        sessions.push(session);
        linesMap.set(id, newLines);
        return HttpResponse.json(session, { status: 201 });
      }),

      http.get(`${V1}/inventory/counts/:id/lines`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        return HttpResponse.json({ items: linesMap.get(id) ?? [] });
      }),

      http.post(`${V1}/inventory/counts/:id/lines`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const body = (await request.json()) as { productId: string; countedQty: number };
        const sessionLines = linesMap.get(id);
        if (!sessionLines) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const idx = sessionLines.findIndex(l => l.product_id === body.productId);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const line = sessionLines[idx]!;
        sessionLines[idx] = {
          ...line,
          counted_qty: body.countedQty,
          variance: body.countedQty - line.expected_qty,
          recorded_at: Date.now(),
        };
        return HttpResponse.json(sessionLines[idx], { status: 201 });
      }),

      http.post(`${V1}/inventory/counts/:id/close`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const idx = sessions.findIndex(s => s.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const s = sessions[idx]!;
        if (s.status === "closed") {
          return HttpResponse.json({ error: { code: "already_closed" } }, { status: 409 });
        }
        const sessionLines = linesMap.get(id) ?? [];
        const adjustments = sessionLines.filter(l => l.variance !== null && l.variance !== 0).length;
        sessions[idx] = { ...s, status: "closed", closed_at: Date.now() };
        return HttpResponse.json({ session: sessions[idx], adjustments });
      }),
    ];
  })(),

  // ── Sales Reps (BE-29) ────────────────────────────────────────────────────
  ...(() => {
    interface SR {
      id: string; name: string; email: string | null;
      commission_pct: number; active: boolean; created_at: number;
    }
    const BASE_TS = Date.now();
    let repSeq = 0;

    let reps: SR[] = [
      { id: "rep_001", name: "Jordan Walsh",    email: "jordan@demo.com", commission_pct: 5,   active: true,  created_at: BASE_TS - 180 * 86400_000 },
      { id: "rep_002", name: "Maya Patel",      email: "maya@demo.com",   commission_pct: 6.5, active: true,  created_at: BASE_TS - 120 * 86400_000 },
      { id: "rep_003", name: "Chris Nguyen",    email: "chris@demo.com",  commission_pct: 4.5, active: false, created_at: BASE_TS - 365 * 86400_000 },
      { id: "rep_004", name: "Dana Okonkwo",    email: null,              commission_pct: 5,   active: true,  created_at: BASE_TS - 60 * 86400_000  },
    ];

    const PERF_SEED: Record<string, { revenue: number; orders: number }> = {
      rep_001: { revenue: 4_820_00,  orders: 18 },
      rep_002: { revenue: 7_340_00,  orders: 26 },
      rep_003: { revenue: 1_100_00,  orders:  5 },
      rep_004: { revenue: 2_550_00,  orders: 11 },
    };

    return [
      http.get(`${V1}/sales/reps`, async ({ request }) => {
        await lat();
        const active = new URL(request.url).searchParams.get("active");
        const items = active === "true" ? reps.filter(r => r.active) : reps;
        return HttpResponse.json({ items });
      }),

      http.post(`${V1}/sales/reps`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<SR>;
        const rep: SR = {
          id: `rep_${++repSeq}_${Date.now()}`,
          name: b.name ?? "New Rep",
          email: b.email ?? null,
          commission_pct: b.commission_pct ?? 0,
          active: true,
          created_at: Date.now(),
        };
        reps.push(rep);
        return HttpResponse.json(rep, { status: 201 });
      }),

      http.get(`${V1}/sales/reps/:id/performance`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const rep = reps.find(r => r.id === id);
        if (!rep) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const url = new URL(request.url);
        const from = Number(url.searchParams.get("from") ?? Date.now() - 30 * 86400_000);
        const to   = Number(url.searchParams.get("to")   ?? Date.now());
        const seed = PERF_SEED[id] ?? { revenue: 0, orders: 0 };
        return HttpResponse.json({
          rep_id: id,
          rep_name: rep.name,
          total_revenue_cents: seed.revenue,
          order_count: seed.orders,
          avg_deal_cents: seed.orders > 0 ? Math.round(seed.revenue / seed.orders) : 0,
          from_ts: from,
          to_ts: to,
        });
      }),

      http.patch(`${V1}/sales/reps/:id`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const idx = reps.findIndex(r => r.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<SR>;
        reps[idx] = { ...reps[idx]!, ...b };
        return HttpResponse.json(reps[idx]);
      }),
    ];
  })(),

  // ── UX-3 widget stubs (restaurant tables, appointments, automotive WOs) ──────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;
    const tables = [
      { id: "tbl_1", table_number: "T1", status: "occupied",  seats: 4 },
      { id: "tbl_2", table_number: "T2", status: "available", seats: 2 },
      { id: "tbl_3", table_number: "T3", status: "reserved",  seats: 6 },
      { id: "tbl_4", table_number: "T4", status: "occupied",  seats: 4 },
      { id: "tbl_5", table_number: "T5", status: "available", seats: 8 },
    ];
    const appts = [
      { id: "appt_1", service: "Haircut & Style", customer_name: "Jane Doe",  starts_at: BASE - 3600_000, status: "completed" },
      { id: "appt_2", service: "Color Treatment", customer_name: "John Smith", starts_at: BASE + 1800_000, status: "confirmed" },
      { id: "appt_3", service: "Beard Trim",       customer_name: "Mike Wu",   starts_at: BASE + 5400_000, status: "scheduled" },
      { id: "appt_4", service: "Deep Conditioning",customer_name: "Sara Lee",  starts_at: BASE + 7200_000, status: "scheduled" },
    ];
    const workOrders = [
      { id: "wo_1", description: "Oil change + tyre rotation",  status: "in_progress", make: "Toyota",  model: "Camry",  total_cents: 8500  },
      { id: "wo_2", description: "Brake pad replacement",        status: "in_progress", make: "Honda",   model: "Civic",  total_cents: 22000 },
      { id: "wo_3", description: "Transmission fluid service",   status: "pending",     make: "Ford",    model: "F-150",  total_cents: 15000 },
      { id: "wo_4", description: "A/C recharge + inspection",    status: "in_progress", make: "BMW",     model: "3 Series", total_cents: 35000 },
    ];
    return [
      http.get(`${V1}/appointments`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const items = status ? appts.filter(a => a.status === status) : appts;
        return HttpResponse.json({ items, total: items.length });
      }),
      http.post(`${V1}/appointments`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { service?: string; customer_name?: string; starts_at?: number };
        const appt = { id: `appt_${Date.now()}`, service: body.service ?? "", customer_name: body.customer_name ?? "", starts_at: body.starts_at ?? BASE + DAY, status: "scheduled" };
        appts.push(appt);
        return HttpResponse.json(appt, { status: 201 });
      }),
      http.get(`${V1}/automotive/work-orders`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const items = status ? workOrders.filter(w => w.status === status) : workOrders;
        return HttpResponse.json({ items, total: items.length });
      }),
    ];
  })(),

  // ── Automotive — vehicles + work orders ──────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Veh { id: string; make: string; model: string; year: number | null; license_plate: string | null; vin: string | null; color: string | null; mileage: number | null; customer_id: string | null; }
    interface WO  { id: string; vehicle_id: string; description: string; status: string; labour_cents: number; parts_cents: number; total_cents: number; mileage_in: number | null; mileage_out: number | null; started_at: number | null; completed_at: number | null; created_at: number; }

    let vehicles: Veh[] = [
      { id: "veh_1", make: "Toyota",  model: "Camry",    year: 2019, license_plate: "ABC-1234", vin: "1HGBH41JXMN109186", color: "Silver",  mileage: 62400,  customer_id: "cust_1" },
      { id: "veh_2", make: "Honda",   model: "Civic",    year: 2021, license_plate: "XYZ-9876", vin: "2HGFC2F62MH509234", color: "Blue",    mileage: 28100,  customer_id: "cust_2" },
      { id: "veh_3", make: "Ford",    model: "F-150",    year: 2020, license_plate: "LMN-5678", vin: "1FTFW1E57LKF16923", color: "Black",   mileage: 81300,  customer_id: "cust_3" },
      { id: "veh_4", make: "BMW",     model: "3 Series", year: 2022, license_plate: "QRS-2345", vin: "WBA8E9G50JNU20157", color: "White",   mileage: 15200,  customer_id: "cust_4" },
      { id: "veh_5", make: "Subaru",  model: "Outback",  year: 2018, license_plate: "DEF-7890", vin: "4S4BSAJC8J3299741", color: "Green",   mileage: 104700, customer_id: null     },
    ];

    let wos: WO[] = [
      { id: "wo_1", vehicle_id: "veh_1", description: "Oil change + tyre rotation",     status: "in_progress", labour_cents: 4500,  parts_cents: 4000,  total_cents: 8500,  mileage_in: 62400,  mileage_out: null,  started_at: BASE - DAY * 1, completed_at: null,             created_at: BASE - DAY * 1 },
      { id: "wo_2", vehicle_id: "veh_2", description: "Brake pad replacement (front)",  status: "in_progress", labour_cents: 9000,  parts_cents: 13000, total_cents: 22000, mileage_in: 28100,  mileage_out: null,  started_at: BASE - DAY * 2, completed_at: null,             created_at: BASE - DAY * 2 },
      { id: "wo_3", vehicle_id: "veh_3", description: "Transmission fluid service",     status: "open",        labour_cents: 7500,  parts_cents: 7500,  total_cents: 15000, mileage_in: 81300,  mileage_out: null,  started_at: null,           completed_at: null,             created_at: BASE - DAY * 0 },
      { id: "wo_4", vehicle_id: "veh_4", description: "A/C recharge + full inspection", status: "in_progress", labour_cents: 18000, parts_cents: 17000, total_cents: 35000, mileage_in: 15200,  mileage_out: null,  started_at: BASE - DAY * 3, completed_at: null,             created_at: BASE - DAY * 3 },
      { id: "wo_5", vehicle_id: "veh_1", description: "Spark plug replacement",         status: "completed",   labour_cents: 8000,  parts_cents: 6000,  total_cents: 14000, mileage_in: 58200,  mileage_out: 58200, started_at: BASE - DAY * 30,completed_at: BASE - DAY * 29, created_at: BASE - DAY * 30 },
    ];

    return [
      http.get(`${V1}/automotive/vehicles`, async ({ request }) => {
        await lat();
        const q = new URL(request.url).searchParams.get("q")?.toLowerCase();
        const filtered = q
          ? vehicles.filter(v => `${v.make} ${v.model} ${v.license_plate ?? ""}`.toLowerCase().includes(q))
          : vehicles;
        return HttpResponse.json({ items: filtered });
      }),

      http.get(`${V1}/automotive/vehicles/:id`, async ({ params }) => {
        await lat();
        const veh = vehicles.find(v => v.id === String(params["id"]));
        if (!veh) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const workOrders = wos.filter(w => w.vehicle_id === veh.id);
        return HttpResponse.json({ ...veh, workOrders });
      }),

      http.post(`${V1}/automotive/vehicles`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Veh>;
        const veh: Veh = { id: `veh_${Date.now()}`, make: body.make ?? "Unknown", model: body.model ?? "Unknown", year: body.year ?? null, license_plate: body.license_plate ?? null, vin: body.vin ?? null, color: body.color ?? null, mileage: body.mileage ?? null, customer_id: body.customer_id ?? null };
        vehicles.push(veh);
        return HttpResponse.json(veh, { status: 201 });
      }),

      http.post(`${V1}/automotive/work-orders`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<WO> & { vehicleId?: string };
        const now = Date.now();
        const wo: WO = { id: `wo_${now}`, vehicle_id: body.vehicleId ?? body.vehicle_id ?? "", description: body.description ?? "", status: "open", labour_cents: body.labour_cents ?? 0, parts_cents: body.parts_cents ?? 0, total_cents: (body.labour_cents ?? 0) + (body.parts_cents ?? 0), mileage_in: body.mileage_in ?? null, mileage_out: null, started_at: null, completed_at: null, created_at: now };
        wos.push(wo);
        return HttpResponse.json(wo, { status: 201 });
      }),

      http.patch(`${V1}/automotive/work-orders/:id`, async ({ request, params }) => {
        await lat();
        const idx = wos.findIndex(w => w.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<WO>;
        const now = Date.now();
        wos[idx] = { ...wos[idx]!, ...body, completed_at: body.status === "completed" ? now : wos[idx]!.completed_at };
        return HttpResponse.json(wos[idx]);
      }),
    ];
  })(),

  // ── Healthcare — patients + prescriptions ─────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Patient { id: string; name: string; dob: string | null; gender: string | null; phone: string | null; email: string | null; allergies: string | null; created_at: number; }
    interface Rx { id: string; drug_name: string; dosage: string; prescriber: string | null; quantity: number; refills_remaining: number; dispensed_at: number | null; expiry_date: number | null; created_at: number; }

    let patients: Patient[] = [
      { id: "pat_1", name: "Eleanor Vance",  dob: "1962-04-15", gender: "F", phone: "555-0101", email: "e.vance@email.com", allergies: "Penicillin",      created_at: BASE - DAY * 200 },
      { id: "pat_2", name: "Marcus Webb",    dob: "1988-09-22", gender: "M", phone: "555-0202", email: null,                allergies: null,               created_at: BASE - DAY * 120 },
      { id: "pat_3", name: "Aiko Tanaka",    dob: "1975-01-08", gender: "F", phone: "555-0303", email: "aiko@example.com",  allergies: "Sulfa, Aspirin",   created_at: BASE - DAY * 85  },
      { id: "pat_4", name: "Carlos Mendez",  dob: "2001-11-30", gender: "M", phone: null,       email: "c.mendez@mail.com", allergies: null,               created_at: BASE - DAY * 30  },
    ];

    const rxByPatient: Record<string, Rx[]> = {
      pat_1: [
        { id: "rx_1", drug_name: "Lisinopril 10mg",   dosage: "1 tablet daily",    prescriber: "Dr. Okafor",  quantity: 30, refills_remaining: 5, dispensed_at: BASE - DAY * 14, expiry_date: BASE + DAY * 365, created_at: BASE - DAY * 14 },
        { id: "rx_2", drug_name: "Metformin 500mg",    dosage: "1 tablet twice/day",prescriber: "Dr. Okafor",  quantity: 60, refills_remaining: 2, dispensed_at: null,            expiry_date: BASE + DAY * 180, created_at: BASE - DAY * 3  },
      ],
      pat_2: [
        { id: "rx_3", drug_name: "Amoxicillin 500mg",  dosage: "1 capsule 3x/day",  prescriber: "Dr. Patel",   quantity: 21, refills_remaining: 0, dispensed_at: BASE - DAY * 2,  expiry_date: BASE + DAY * 14,  created_at: BASE - DAY * 2  },
      ],
      pat_3: [],
      pat_4: [
        { id: "rx_4", drug_name: "Salbutamol inhaler", dosage: "2 puffs as needed", prescriber: "Dr. Leung",   quantity: 1,  refills_remaining: 3, dispensed_at: BASE - DAY * 7,  expiry_date: BASE + DAY * 365, created_at: BASE - DAY * 7  },
      ],
    };

    return [
      http.get(`${V1}/healthcare/patients`, async ({ request }) => {
        await lat();
        const q = new URL(request.url).searchParams.get("q")?.toLowerCase();
        const filtered = q ? patients.filter(p => p.name.toLowerCase().includes(q) || (p.phone ?? "").includes(q)) : patients;
        return HttpResponse.json({ items: filtered });
      }),

      http.get(`${V1}/healthcare/patients/:id`, async ({ params }) => {
        await lat();
        const p = patients.find(x => x.id === String(params["id"]));
        if (!p) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ ...p, prescriptions: rxByPatient[p.id] ?? [] });
      }),

      http.post(`${V1}/healthcare/patients`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Patient>;
        const p: Patient = { id: `pat_${Date.now()}`, name: body.name ?? "New Patient", dob: body.dob ?? null, gender: body.gender ?? null, phone: body.phone ?? null, email: body.email ?? null, allergies: null, created_at: Date.now() };
        patients.push(p);
        rxByPatient[p.id] = [];
        return HttpResponse.json(p, { status: 201 });
      }),

      http.post(`${V1}/healthcare/prescriptions/:id/dispense`, async ({ params }) => {
        await lat();
        for (const rxs of Object.values(rxByPatient)) {
          const rx = rxs.find(r => r.id === String(params["id"]));
          if (rx) { rx.dispensed_at = Date.now(); return HttpResponse.json(rx); }
        }
        return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
      }),
    ];
  })(),

  // ── Hospitality — rooms, charges, settle ──────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Room { id: string; room_number: string; type: string; floor: string | null; rate_cents: number; status: "available" | "occupied" | "checkout" | "cleaning" | "maintenance"; notes: string | null; }
    interface Charge { id: string; room_id: string; description: string; amount_cents: number; posted_at: number; settled_at: number | null; }

    let rooms: Room[] = [
      { id: "room_1", room_number: "101", type: "standard",  floor: "1", rate_cents: 12900, status: "occupied",    notes: null },
      { id: "room_2", room_number: "102", type: "standard",  floor: "1", rate_cents: 12900, status: "available",   notes: null },
      { id: "room_3", room_number: "201", type: "deluxe",    floor: "2", rate_cents: 18900, status: "checkout",    notes: "Late checkout approved" },
      { id: "room_4", room_number: "202", type: "deluxe",    floor: "2", rate_cents: 18900, status: "cleaning",    notes: null },
      { id: "room_5", room_number: "301", type: "suite",     floor: "3", rate_cents: 35900, status: "occupied",    notes: "VIP guest - J. Smith" },
      { id: "room_6", room_number: "302", type: "suite",     floor: "3", rate_cents: 35900, status: "maintenance", notes: "A/C repair scheduled" },
    ];

    let charges: Charge[] = [
      { id: "chg_1", room_id: "room_1", description: "Room service - dinner",  amount_cents: 4800, posted_at: BASE - DAY,     settled_at: null },
      { id: "chg_2", room_id: "room_1", description: "Mini-bar",               amount_cents: 1200, posted_at: BASE - 3600_000, settled_at: null },
      { id: "chg_3", room_id: "room_5", description: "Spa treatment",          amount_cents: 9500, posted_at: BASE - DAY * 2,  settled_at: null },
      { id: "chg_4", room_id: "room_5", description: "Room service - champagne",amount_cents: 7800, posted_at: BASE - DAY,     settled_at: null },
    ];

    return [
      http.get(`${V1}/hospitality/rooms`, async () => {
        await lat();
        return HttpResponse.json({ items: rooms });
      }),

      http.post(`${V1}/hospitality/rooms`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Room> & { roomNumber?: string; rateCents?: number; };
        const room: Room = { id: `room_${Date.now()}`, room_number: body.roomNumber ?? body.room_number ?? "000", type: body.type ?? "standard", floor: body.floor ?? null, rate_cents: body.rateCents ?? body.rate_cents ?? 9900, status: "available", notes: null };
        rooms.push(room);
        return HttpResponse.json(room, { status: 201 });
      }),

      http.patch(`${V1}/hospitality/rooms/:id/status`, async ({ request, params }) => {
        await lat();
        const idx = rooms.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { status: Room["status"] };
        rooms[idx] = { ...rooms[idx]!, status: body.status };
        return HttpResponse.json(rooms[idx]);
      }),

      http.get(`${V1}/hospitality/rooms/:id/charges`, async ({ params }) => {
        await lat();
        const roomId = String(params["id"]);
        return HttpResponse.json({ items: charges.filter(c => c.room_id === roomId && !c.settled_at) });
      }),

      http.post(`${V1}/hospitality/rooms/:id/charge`, async ({ request, params }) => {
        await lat();
        const body = (await request.json()) as { description?: string; amountCents?: number; amount_cents?: number };
        const charge: Charge = { id: `chg_${Date.now()}`, room_id: String(params["id"]), description: body.description ?? "Miscellaneous", amount_cents: body.amountCents ?? body.amount_cents ?? 0, posted_at: Date.now(), settled_at: null };
        charges.push(charge);
        return HttpResponse.json(charge, { status: 201 });
      }),

      http.post(`${V1}/hospitality/rooms/:id/settle`, async ({ params }) => {
        await lat();
        const roomId = String(params["id"]);
        const now = Date.now();
        charges.filter(c => c.room_id === roomId && !c.settled_at).forEach(c => { c.settled_at = now; });
        return HttpResponse.json({ settled: true });
      }),
    ];
  })(),

  // ── Education — students, fees, fee collection ────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Student { id: string; name: string; email: string | null; phone: string | null; course: string | null; enrolled_at: number | null; status: "active" | "inactive"; notes: string | null; outstanding?: number; fees?: Fee[]; }
    interface Fee { id: string; description: string; amount_cents: number; due_date: number | null; paid_at: number | null; method: string | null; order_id: string | null; created_at: number; }

    let students: Student[] = [
      { id: "stu_1", name: "Lily Carter",    email: "lily@email.com",  phone: "555-3001", course: "Photography Fundamentals", enrolled_at: BASE - DAY * 60,  status: "active",   notes: null },
      { id: "stu_2", name: "Ethan Brooks",   email: null,              phone: "555-3002", course: "Digital Marketing",        enrolled_at: BASE - DAY * 45,  status: "active",   notes: "Scholarship recipient" },
      { id: "stu_3", name: "Naomi Singh",    email: "naomi@email.com", phone: null,       course: "Web Design Bootcamp",       enrolled_at: BASE - DAY * 90,  status: "active",   notes: null },
      { id: "stu_4", name: "Tyler Mason",    email: "tyler@email.com", phone: "555-3004", course: "Photography Fundamentals", enrolled_at: BASE - DAY * 120, status: "inactive", notes: "On leave" },
    ];

    const feesByStudent: Record<string, Fee[]> = {
      stu_1: [
        { id: "fee_1", description: "Tuition — Term 2",  amount_cents: 125000, due_date: BASE + DAY * 14,  paid_at: null,            method: null,   order_id: null, created_at: BASE - DAY * 10 },
        { id: "fee_2", description: "Materials fee",      amount_cents: 15000,  due_date: BASE - DAY * 5,   paid_at: BASE - DAY * 7,  method: "card", order_id: null, created_at: BASE - DAY * 30 },
      ],
      stu_2: [
        { id: "fee_3", description: "Tuition — Term 1",  amount_cents: 98000,  due_date: BASE - DAY * 30,  paid_at: BASE - DAY * 28, method: "cash", order_id: null, created_at: BASE - DAY * 45 },
      ],
      stu_3: [
        { id: "fee_4", description: "Tuition — Term 2",  amount_cents: 185000, due_date: BASE + DAY * 7,   paid_at: null,            method: null,   order_id: null, created_at: BASE - DAY * 5  },
        { id: "fee_5", description: "Lab access fee",     amount_cents: 8500,   due_date: BASE + DAY * 7,   paid_at: null,            method: null,   order_id: null, created_at: BASE - DAY * 5  },
      ],
      stu_4: [],
    };

    function outstanding(id: string) { return (feesByStudent[id] ?? []).filter(f => !f.paid_at).reduce((s, f) => s + f.amount_cents, 0); }

    return [
      http.get(`${V1}/education/students`, async () => {
        await lat();
        return HttpResponse.json({ items: students.map(s => ({ ...s, outstanding: outstanding(s.id) })) });
      }),

      http.get(`${V1}/education/students/:id`, async ({ params }) => {
        await lat();
        const s = students.find(x => x.id === String(params["id"]));
        if (!s) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ ...s, outstanding: outstanding(s.id), fees: feesByStudent[s.id] ?? [] });
      }),

      http.post(`${V1}/education/students`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Student>;
        const s: Student = { id: `stu_${Date.now()}`, name: body.name ?? "New Student", email: body.email ?? null, phone: body.phone ?? null, course: body.course ?? null, enrolled_at: Date.now(), status: "active", notes: body.notes ?? null };
        students.push(s);
        feesByStudent[s.id] = [];
        return HttpResponse.json(s, { status: 201 });
      }),

      http.patch(`${V1}/education/students/:id`, async ({ request, params }) => {
        await lat();
        const idx = students.findIndex(s => s.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Student>;
        students[idx] = { ...students[idx]!, ...body };
        return HttpResponse.json(students[idx]);
      }),

      http.post(`${V1}/education/students/:id/fees`, async ({ request, params }) => {
        await lat();
        const sid = String(params["id"]);
        const body = (await request.json()) as { description?: string; amountCents?: number; amount_cents?: number; dueDate?: string; due_date?: string; };
        const fee: Fee = { id: `fee_${Date.now()}`, description: body.description ?? "Fee", amount_cents: body.amountCents ?? body.amount_cents ?? 0, due_date: body.dueDate || body.due_date ? new Date(body.dueDate ?? body.due_date ?? "").getTime() : null, paid_at: null, method: null, order_id: null, created_at: Date.now() };
        if (!feesByStudent[sid]) feesByStudent[sid] = [];
        feesByStudent[sid]!.push(fee);
        return HttpResponse.json(fee, { status: 201 });
      }),

      http.post(`${V1}/education/fees/:id/collect`, async ({ params }) => {
        await lat();
        for (const fees of Object.values(feesByStudent)) {
          const fee = fees.find(f => f.id === String(params["id"]));
          if (fee) { fee.paid_at = Date.now(); fee.method = "cash"; return HttpResponse.json(fee); }
        }
        return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
      }),
    ];
  })(),

  // ── Entertainment — events + ticket sales + QR redeem ─────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;
    const HOUR = 3_600_000;

    interface FEvent { id: string; name: string; venue: string | null; starts_at: number; ends_at: number; capacity: number; sold: number; available: number; price_cents: number; status: string; description: string | null; }

    const issuedQR = new Set<string>();

    let events: FEvent[] = [
      { id: "evt_1", name: "Summer Jazz Night",     venue: "Rooftop Terrace",   starts_at: BASE + DAY * 3,  ends_at: BASE + DAY * 3  + HOUR * 3,  capacity: 150, sold: 112, available: 38, price_cents: 4500, status: "on_sale",  description: "Live jazz under the stars." },
      { id: "evt_2", name: "Comedy Showcase",        venue: "Main Stage",        starts_at: BASE + DAY * 7,  ends_at: BASE + DAY * 7  + HOUR * 2,  capacity: 200, sold: 200, available: 0,  price_cents: 3000, status: "sold_out", description: null },
      { id: "evt_3", name: "Acoustic Sessions Vol.3",venue: "Lounge Bar",        starts_at: BASE + DAY * 14, ends_at: BASE + DAY * 14 + HOUR * 2,  capacity: 80,  sold: 35,  available: 45, price_cents: 2000, status: "on_sale",  description: "Intimate acoustic evening." },
      { id: "evt_4", name: "New Year's Eve Gala",    venue: "Grand Ballroom",    starts_at: BASE - DAY * 10, ends_at: BASE - DAY * 10 + HOUR * 5,  capacity: 500, sold: 500, available: 0,  price_cents: 12000,status: "ended",    description: null },
    ];

    return [
      http.get(`${V1}/entertainment/events`, async () => {
        await lat();
        return HttpResponse.json({ items: events });
      }),

      http.post(`${V1}/entertainment/events`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { name?: string; venue?: string; startsAt?: string; starts_at?: string; endsAt?: string; ends_at?: string; capacity?: string | number; priceCents?: string | number; price_cents?: number; description?: string };
        const starts = body.startsAt ? new Date(body.startsAt).getTime() : body.starts_at ? new Date(String(body.starts_at)).getTime() : Date.now() + DAY;
        const ends   = body.endsAt   ? new Date(body.endsAt).getTime()   : body.ends_at   ? new Date(String(body.ends_at)).getTime()   : starts + HOUR * 2;
        const cap    = Number(body.capacity ?? 100);
        const price  = Number(body.priceCents ?? body.price_cents ?? 0);
        const evt: FEvent = { id: `evt_${Date.now()}`, name: body.name ?? "New Event", venue: body.venue ?? null, starts_at: starts, ends_at: ends, capacity: cap, sold: 0, available: cap, price_cents: price, status: "on_sale", description: body.description ?? null };
        events.push(evt);
        return HttpResponse.json(evt, { status: 201 });
      }),

      http.post(`${V1}/entertainment/events/:id/tickets`, async ({ request, params }) => {
        await lat();
        const body = (await request.json()) as { quantity?: string | number };
        const idx = events.findIndex(e => e.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const qty = Number(body.quantity ?? 1);
        const evt = events[idx]!;
        if (evt.available < qty) return HttpResponse.json({ error: { code: "sold_out" } }, { status: 422 });
        events[idx] = { ...evt, sold: evt.sold + qty, available: evt.available - qty, status: evt.available - qty === 0 ? "sold_out" : evt.status };
        const tickets = Array.from({ length: qty }, (_, i) => {
          const qr = `QR-${evt.id}-${Date.now()}-${i}`;
          issuedQR.add(qr);
          return { id: `tkt_${Date.now()}_${i}`, qr_code: qr };
        });
        return HttpResponse.json({ tickets }, { status: 201 });
      }),

      // Sub-path before /:id
      http.post(`${V1}/entertainment/tickets/redeem`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { qrCode?: string; qr_code?: string };
        const code = body.qrCode ?? body.qr_code ?? "";
        if (!code || !issuedQR.has(code)) return HttpResponse.json({ success: false, message: "Invalid or already-used ticket." });
        issuedQR.delete(code);
        return HttpResponse.json({ success: true, message: "Ticket accepted. Entry granted." });
      }),
    ];
  })(),

  // ── Manufacturing — production orders + BOM ───────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface BomLine { id: string; raw_material_id: string; qty_required: number; qty_consumed: number; unit: string; }
    interface PO { id: string; product_id: string; quantity: number; status: string; started_at: number | null; completed_at: number | null; notes: string | null; created_at: number; bom?: BomLine[]; }

    const bomByOrder: Record<string, BomLine[]> = {
      mo_1: [
        { id: "bom_1_1", raw_material_id: "mat_wood_oak",  qty_required: 4,  qty_consumed: 4,  unit: "sheet" },
        { id: "bom_1_2", raw_material_id: "mat_screws_m4", qty_required: 48, qty_consumed: 48, unit: "pcs"   },
      ],
      mo_2: [
        { id: "bom_2_1", raw_material_id: "mat_steel_rod", qty_required: 12, qty_consumed: 8, unit: "m"   },
        { id: "bom_2_2", raw_material_id: "mat_grease",    qty_required: 2,  qty_consumed: 1, unit: "tube" },
      ],
      mo_3: [
        { id: "bom_3_1", raw_material_id: "mat_pcb_blank", qty_required: 50, qty_consumed: 0, unit: "pcs" },
        { id: "bom_3_2", raw_material_id: "mat_solder",    qty_required: 1,  qty_consumed: 0, unit: "roll" },
      ],
    };

    let orders: PO[] = [
      { id: "mo_1", product_id: "prod_bookshelf", quantity: 10, status: "completed",   started_at: BASE - DAY * 7, completed_at: BASE - DAY * 2, notes: null,             created_at: BASE - DAY * 10 },
      { id: "mo_2", product_id: "prod_gear_asm",  quantity: 5,  status: "in_progress", started_at: BASE - DAY * 2, completed_at: null,           notes: "Rush order",     created_at: BASE - DAY * 3  },
      { id: "mo_3", product_id: "prod_pcb_rev2",  quantity: 50, status: "draft",       started_at: null,           completed_at: null,           notes: "Awaiting parts", created_at: BASE - DAY * 0  },
    ];

    return [
      http.get(`${V1}/manufacturing/orders`, async ({ request }) => {
        await lat();
        const status = new URL(request.url).searchParams.get("status");
        const filtered = status && status !== "all" ? orders.filter(o => o.status === status) : orders;
        return HttpResponse.json({ items: filtered });
      }),

      http.get(`${V1}/manufacturing/orders/:id`, async ({ params }) => {
        await lat();
        const o = orders.find(x => x.id === String(params["id"]));
        if (!o) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ ...o, bom: bomByOrder[o.id] ?? [] });
      }),

      http.post(`${V1}/manufacturing/orders`, async ({ request }) => {
        await lat();
        type BomInput = { rawMaterialId?: string; raw_material_id?: string; qtyRequired?: string | number; qty_required?: number; unit?: string };
        const body = (await request.json()) as { product_id?: string; quantity?: number; notes?: string; bom?: BomInput[] };
        const id = `mo_${Date.now()}`;
        const po: PO = { id, product_id: body.product_id ?? "", quantity: Number(body.quantity ?? 1), status: "draft", started_at: null, completed_at: null, notes: body.notes ?? null, created_at: Date.now() };
        if (body.bom) {
          bomByOrder[id] = body.bom.map((l: BomInput, i: number) => ({ id: `bom_${id}_${i}`, raw_material_id: l.rawMaterialId ?? l.raw_material_id ?? "", qty_required: Number(l.qtyRequired ?? l.qty_required ?? 1), qty_consumed: 0, unit: l.unit ?? "unit" }));
        }
        orders.push(po);
        return HttpResponse.json({ ...po, bom: bomByOrder[id] ?? [] }, { status: 201 });
      }),

      http.patch(`${V1}/manufacturing/orders/:id/status`, async ({ request, params }) => {
        await lat();
        const idx = orders.findIndex(o => o.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { status: string };
        const now = Date.now();
        orders[idx] = { ...orders[idx]!, status: body.status, started_at: body.status === "in_progress" && !orders[idx]!.started_at ? now : orders[idx]!.started_at, completed_at: body.status === "completed" ? now : orders[idx]!.completed_at };
        return HttpResponse.json(orders[idx]);
      }),
    ];
  })(),

  // ── Rental — assets + contracts ───────────────────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Asset { id: string; name: string; category: string | null; daily_rate_cents: number; deposit_cents: number; status: "available" | "rented" | "maintenance"; serial_number: string | null; }
    interface Contract { id: string; asset_id: string; asset_name: string; daily_rate_cents: number; customer_id: string | null; starts_at: number; ends_at: number; deposit_cents: number; total_cents: number; status: "active" | "returned" | "overdue"; returned_at: number | null; }

    let assets: Asset[] = [
      { id: "ast_1", name: "Canon EOS R5 Camera Kit",  category: "Photography", daily_rate_cents: 8500,  deposit_cents: 150000, status: "rented",      serial_number: "CNR5-00412" },
      { id: "ast_2", name: "DJI Mavic 3 Pro Drone",    category: "Photography", daily_rate_cents: 12000, deposit_cents: 200000, status: "available",   serial_number: "DJI-MVP-991" },
      { id: "ast_3", name: "Party Tent 6×12m",         category: "Events",      daily_rate_cents: 22000, deposit_cents: 100000, status: "available",   serial_number: null },
      { id: "ast_4", name: "Pressure Washer (3000psi)", category: "Tools",       daily_rate_cents: 4500,  deposit_cents: 30000,  status: "maintenance", serial_number: "PW-3K-0071" },
      { id: "ast_5", name: "PA System (2×1000W)",       category: "Audio/Visual",daily_rate_cents: 15000, deposit_cents: 80000,  status: "rented",      serial_number: null },
    ];

    let contracts: Contract[] = [
      { id: "cnt_1", asset_id: "ast_1", asset_name: "Canon EOS R5 Camera Kit", daily_rate_cents: 8500,  customer_id: "cust_1", starts_at: BASE - DAY * 3, ends_at: BASE + DAY * 1, deposit_cents: 150000, total_cents: 34000,  status: "active",  returned_at: null },
      { id: "cnt_2", asset_id: "ast_5", asset_name: "PA System (2×1000W)",     daily_rate_cents: 15000, customer_id: "cust_3", starts_at: BASE - DAY * 1, ends_at: BASE + DAY * 2, deposit_cents: 80000,  total_cents: 45000,  status: "active",  returned_at: null },
      { id: "cnt_3", asset_id: "ast_2", asset_name: "DJI Mavic 3 Pro Drone",   daily_rate_cents: 12000, customer_id: "cust_2", starts_at: BASE - DAY * 7, ends_at: BASE - DAY * 5, deposit_cents: 200000, total_cents: 24000,  status: "returned",returned_at: BASE - DAY * 5 },
    ];

    return [
      http.get(`${V1}/rental/assets`, async () => {
        await lat();
        return HttpResponse.json({ items: assets });
      }),

      http.post(`${V1}/rental/assets`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Asset> & { dailyRateCents?: number; depositCents?: number; serialNumber?: string };
        const asset: Asset = { id: `ast_${Date.now()}`, name: body.name ?? "New Asset", category: body.category ?? null, daily_rate_cents: body.dailyRateCents ?? body.daily_rate_cents ?? 0, deposit_cents: body.depositCents ?? body.deposit_cents ?? 0, status: "available", serial_number: body.serialNumber ?? body.serial_number ?? null };
        assets.push(asset);
        return HttpResponse.json(asset, { status: 201 });
      }),

      http.get(`${V1}/rental/contracts`, async ({ request }) => {
        await lat();
        const status = new URL(request.url).searchParams.get("status");
        const filtered = status && status !== "all" ? contracts.filter(c => c.status === status) : contracts;
        return HttpResponse.json({ items: filtered });
      }),

      http.post(`${V1}/rental/contracts`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { assetId?: string; asset_id?: string; startsAt?: string; starts_at?: string; endsAt?: string; ends_at?: string; customer_id?: string };
        const assetId = body.assetId ?? body.asset_id ?? "";
        const asset = assets.find(a => a.id === assetId);
        if (!asset) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const starts = body.startsAt ? new Date(body.startsAt).getTime() : Date.now();
        const ends   = body.endsAt   ? new Date(body.endsAt).getTime()   : starts + DAY;
        const days   = Math.max(1, Math.ceil((ends - starts) / DAY));
        const contract: Contract = { id: `cnt_${Date.now()}`, asset_id: assetId, asset_name: asset.name, daily_rate_cents: asset.daily_rate_cents, customer_id: body.customer_id ?? null, starts_at: starts, ends_at: ends, deposit_cents: asset.deposit_cents, total_cents: days * asset.daily_rate_cents, status: "active", returned_at: null };
        asset.status = "rented";
        contracts.push(contract);
        return HttpResponse.json(contract, { status: 201 });
      }),

      http.post(`${V1}/rental/contracts/:id/return`, async ({ params }) => {
        await lat();
        const idx = contracts.findIndex(c => c.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        contracts[idx] = { ...contracts[idx]!, status: "returned", returned_at: Date.now() };
        const asset = assets.find(a => a.id === contracts[idx]!.asset_id);
        if (asset) asset.status = "available";
        return HttpResponse.json(contracts[idx]);
      }),
    ];
  })(),

  // ── Loyalty Program — tiers, members, rewards ────────────────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;

    interface Tier { id: string; name: string; level: string; points_required: number; discount_pct: number; description: string | null; member_count: number; created_at: number; updated_at: number; }
    interface Member { id: string; customer_id: string; customer_name: string; customer_email: string | null; tier_id: string; tier_name: string; tier_level: string; points_balance: number; points_lifetime: number; joined_at: number; last_activity_at: number | null; }
    interface Reward { id: string; name: string; description: string | null; points_cost: number; discount_cents: number; status: "active" | "inactive" | "archived"; redemption_count: number; created_at: number; updated_at: number; }

    let tiers: Tier[] = [
      { id: "tier_1", name: "Bronze",   level: "bronze",   points_required: 0,    discount_pct: 0,  description: "Welcome tier for all members.",             member_count: 142, created_at: BASE - DAY * 90, updated_at: BASE - DAY * 90 },
      { id: "tier_2", name: "Silver",   level: "silver",   points_required: 200,  discount_pct: 5,  description: "5% off every purchase.",                    member_count: 58,  created_at: BASE - DAY * 90, updated_at: BASE - DAY * 30 },
      { id: "tier_3", name: "Gold",     level: "gold",     points_required: 500,  discount_pct: 10, description: "10% off + free shipping on web orders.",    member_count: 24,  created_at: BASE - DAY * 90, updated_at: BASE - DAY * 30 },
      { id: "tier_4", name: "Platinum", level: "platinum", points_required: 1000, discount_pct: 15, description: "15% off + priority support + free returns.", member_count: 7,   created_at: BASE - DAY * 90, updated_at: BASE - DAY * 14 },
    ];

    let members: Member[] = [
      { id: "mem_1", customer_id: "cust_1", customer_name: "Maria Garcia",   customer_email: "maria@gmail.com",   tier_id: "tier_3", tier_name: "Gold",     tier_level: "gold",     points_balance: 640,  points_lifetime: 840,  joined_at: BASE - DAY * 180, last_activity_at: BASE - DAY * 3  },
      { id: "mem_2", customer_id: "cust_2", customer_name: "Tom Lee",        customer_email: "tom@bolt.io",       tier_id: "tier_2", tier_name: "Silver",   tier_level: "silver",   points_balance: 310,  points_lifetime: 390,  joined_at: BASE - DAY * 120, last_activity_at: BASE - DAY * 7  },
      { id: "mem_3", customer_id: "cust_3", customer_name: "Priya Sharma",   customer_email: "priya@gmail.com",   tier_id: "tier_4", tier_name: "Platinum", tier_level: "platinum", points_balance: 1240, points_lifetime: 1680, joined_at: BASE - DAY * 240, last_activity_at: BASE - DAY * 1  },
      { id: "mem_4", customer_id: "cust_4", customer_name: "Carlos Ruiz",    customer_email: null,                tier_id: "tier_1", tier_name: "Bronze",   tier_level: "bronze",   points_balance: 85,   points_lifetime: 85,   joined_at: BASE - DAY * 30,  last_activity_at: BASE - DAY * 14 },
      { id: "mem_5", customer_id: "cust_5", customer_name: "Amy Chen",       customer_email: "amy@summit.co",     tier_id: "tier_2", tier_name: "Silver",   tier_level: "silver",   points_balance: 220,  points_lifetime: 420,  joined_at: BASE - DAY * 90,  last_activity_at: BASE - DAY * 2  },
      { id: "mem_6", customer_id: "cust_6", customer_name: "James O'Brien",  customer_email: "james@obrien.ie",   tier_id: "tier_3", tier_name: "Gold",     tier_level: "gold",     points_balance: 530,  points_lifetime: 730,  joined_at: BASE - DAY * 150, last_activity_at: BASE - DAY * 10 },
    ];

    let rewards: Reward[] = [
      { id: "rwd_1", name: "$5 Off",         description: "Redeem 100 points for $5 off your next purchase.",    points_cost: 100,  discount_cents: 500,  status: "active",   redemption_count: 47,  created_at: BASE - DAY * 60, updated_at: BASE - DAY * 5  },
      { id: "rwd_2", name: "$15 Off",        description: "Redeem 250 points for $15 off.",                      points_cost: 250,  discount_cents: 1500, status: "active",   redemption_count: 23,  created_at: BASE - DAY * 60, updated_at: BASE - DAY * 5  },
      { id: "rwd_3", name: "Free Coffee",    description: "Redeem 50 points for any house coffee.",              points_cost: 50,   discount_cents: 499,  status: "active",   redemption_count: 112, created_at: BASE - DAY * 45, updated_at: BASE - DAY * 1  },
      { id: "rwd_4", name: "Birthday Bonus", description: "Double points during birthday month.",                points_cost: 0,    discount_cents: 0,    status: "inactive", redemption_count: 0,   created_at: BASE - DAY * 30, updated_at: BASE - DAY * 30 },
    ];

    return [
      // Tiers
      http.get(`${V1}/loyalty/tiers`, async () => {
        await lat();
        return HttpResponse.json({ items: tiers });
      }),

      http.post(`${V1}/loyalty/tiers`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Tier>;
        const now = Date.now();
        const tier: Tier = {
          id: `tier_${Date.now()}`, name: body.name ?? "New Tier", level: body.level ?? "bronze",
          points_required: body.points_required ?? 0, discount_pct: body.discount_pct ?? 0,
          description: body.description ?? null, member_count: 0, created_at: now, updated_at: now,
        };
        tiers.push(tier);
        return HttpResponse.json(tier, { status: 201 });
      }),

      http.patch(`${V1}/loyalty/tiers/:id`, async ({ request, params }) => {
        await lat();
        const idx = tiers.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Tier>;
        tiers[idx] = { ...tiers[idx]!, ...body, updated_at: Date.now() };
        return HttpResponse.json(tiers[idx]);
      }),

      http.delete(`${V1}/loyalty/tiers/:id`, async ({ params }) => {
        await lat();
        const idx = tiers.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        tiers.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),

      // Members
      http.get(`${V1}/loyalty/members`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const q      = url.searchParams.get("q")?.toLowerCase();
        const tier   = url.searchParams.get("tier");
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);

        let filtered = members;
        if (q) filtered = filtered.filter(m =>
          m.customer_name.toLowerCase().includes(q) || (m.customer_email ?? "").toLowerCase().includes(q),
        );
        if (tier) filtered = filtered.filter(m => m.tier_level === tier);

        const total = filtered.length;
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total });
      }),

      http.post(`${V1}/loyalty/members/:id/adjust`, async ({ request, params }) => {
        await lat();
        const idx = members.findIndex(m => m.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { delta: number; reason?: string };
        members[idx] = {
          ...members[idx]!,
          points_balance: Math.max(0, members[idx]!.points_balance + body.delta),
          points_lifetime: body.delta > 0 ? members[idx]!.points_lifetime + body.delta : members[idx]!.points_lifetime,
          last_activity_at: Date.now(),
        };
        return HttpResponse.json(members[idx]);
      }),

      // Rewards
      http.get(`${V1}/loyalty/rewards`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        let filtered = rewards;
        if (status && status !== "all") filtered = filtered.filter(r => r.status === status);
        return HttpResponse.json({ items: filtered });
      }),

      http.post(`${V1}/loyalty/rewards`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Reward>;
        const now = Date.now();
        const reward: Reward = {
          id: `rwd_${Date.now()}`, name: body.name ?? "New Reward",
          description: body.description ?? null, points_cost: body.points_cost ?? 100,
          discount_cents: body.discount_cents ?? 0, status: "active", redemption_count: 0,
          created_at: now, updated_at: now,
        };
        rewards.push(reward);
        return HttpResponse.json(reward, { status: 201 });
      }),

      http.patch(`${V1}/loyalty/rewards/:id`, async ({ request, params }) => {
        await lat();
        const idx = rewards.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Reward>;
        rewards[idx] = { ...rewards[idx]!, ...body, updated_at: Date.now() };
        return HttpResponse.json(rewards[idx]);
      }),

      http.delete(`${V1}/loyalty/rewards/:id`, async ({ params }) => {
        await lat();
        const idx = rewards.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        rewards[idx] = { ...rewards[idx]!, status: "archived", updated_at: Date.now() };
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Workforce — employees, weekly shifts, time-off requests ──────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;
    let shiftSeq = 0;

    interface Emp { id: string; name: string; role: string; email: string; avatar_color: string; }
    interface Sh  { id: string; employee_id: string; employee_name: string; role: string; date: string; start_time: string; end_time: string; notes: string | null; created_at: number; updated_at: number; }
    interface TO  { id: string; employee_id: string; employee_name: string; date_from: string; date_to: string; reason: string | null; status: "pending" | "approved" | "denied"; created_at: number; }

    const employees: Emp[] = [
      { id: "emp_1", name: "Jake Torres",   role: "manager",    email: "jake@finder.pos",   avatar_color: "#6366f1" },
      { id: "emp_2", name: "Sara Mitchell", role: "supervisor", email: "sara@finder.pos",   avatar_color: "#10b981" },
      { id: "emp_3", name: "Leo Kim",       role: "cashier",    email: "leo@finder.pos",    avatar_color: "#3b82f6" },
      { id: "emp_4", name: "Priya Nair",    role: "cashier",    email: "priya@finder.pos",  avatar_color: "#f59e0b" },
      { id: "emp_5", name: "Marco Reyes",   role: "stock",      email: "marco@finder.pos",  avatar_color: "#ef4444" },
      { id: "emp_6", name: "Amy Chen",      role: "delivery",   email: "amy@finder.pos",    avatar_color: "#8b5cf6" },
    ];

    function empById(id: string): Emp | undefined { return employees.find(e => e.id === id); }

    // Seed shifts for current week (Mon–Sun)
    const now = new Date();
    const mon = new Date(now);
    const day = now.getDay();
    mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    mon.setHours(0, 0, 0, 0);
    function dayStr(offset: number): string {
      const d = new Date(mon);
      d.setDate(mon.getDate() + offset);
      return d.toISOString().slice(0, 10);
    }

    let shifts: Sh[] = [
      { id: "sh_1", employee_id: "emp_1", employee_name: "Jake Torres",   role: "manager",    date: dayStr(0), start_time: "08:00", end_time: "16:00", notes: "Opening",   created_at: BASE, updated_at: BASE },
      { id: "sh_2", employee_id: "emp_2", employee_name: "Sara Mitchell", role: "supervisor", date: dayStr(0), start_time: "09:00", end_time: "17:00", notes: null,        created_at: BASE, updated_at: BASE },
      { id: "sh_3", employee_id: "emp_3", employee_name: "Leo Kim",       role: "cashier",    date: dayStr(0), start_time: "10:00", end_time: "18:00", notes: null,        created_at: BASE, updated_at: BASE },
      { id: "sh_4", employee_id: "emp_4", employee_name: "Priya Nair",    role: "cashier",    date: dayStr(1), start_time: "09:00", end_time: "17:00", notes: null,        created_at: BASE, updated_at: BASE },
      { id: "sh_5", employee_id: "emp_5", employee_name: "Marco Reyes",   role: "stock",      date: dayStr(1), start_time: "06:00", end_time: "14:00", notes: "Receiving", created_at: BASE, updated_at: BASE },
      { id: "sh_6", employee_id: "emp_6", employee_name: "Amy Chen",      role: "delivery",   date: dayStr(2), start_time: "10:00", end_time: "18:00", notes: null,        created_at: BASE, updated_at: BASE },
      { id: "sh_7", employee_id: "emp_1", employee_name: "Jake Torres",   role: "manager",    date: dayStr(2), start_time: "08:00", end_time: "16:00", notes: null,        created_at: BASE, updated_at: BASE },
      { id: "sh_8", employee_id: "emp_3", employee_name: "Leo Kim",       role: "cashier",    date: dayStr(3), start_time: "12:00", end_time: "20:00", notes: "Closing",   created_at: BASE, updated_at: BASE },
      { id: "sh_9", employee_id: "emp_2", employee_name: "Sara Mitchell", role: "supervisor", date: dayStr(4), start_time: "09:00", end_time: "17:00", notes: null,        created_at: BASE, updated_at: BASE },
    ];

    let timeOff: TO[] = [
      { id: "to_1", employee_id: "emp_4", employee_name: "Priya Nair",   date_from: dayStr(3), date_to: dayStr(4), reason: "Doctor appointment", status: "pending",  created_at: BASE - DAY * 2 },
      { id: "to_2", employee_id: "emp_6", employee_name: "Amy Chen",     date_from: dayStr(5), date_to: dayStr(6), reason: "Family visit",        status: "approved", created_at: BASE - DAY * 3 },
      { id: "to_3", employee_id: "emp_5", employee_name: "Marco Reyes",  date_from: dayStr(6), date_to: dayStr(6), reason: null,                  status: "denied",   created_at: BASE - DAY * 1 },
    ];

    return [
      http.get(`${V1}/workforce/employees`, async () => {
        await lat();
        return HttpResponse.json({ items: employees });
      }),

      http.get(`${V1}/workforce/shifts`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const dateFrom = url.searchParams.get("date_from");
        const dateTo   = url.searchParams.get("date_to");

        let filtered = shifts;
        if (dateFrom) filtered = filtered.filter(s => s.date >= dateFrom);
        if (dateTo)   filtered = filtered.filter(s => s.date <= dateTo);

        return HttpResponse.json({ items: filtered, total: filtered.length });
      }),

      http.post(`${V1}/workforce/shifts`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Sh>;
        const emp = body.employee_id ? empById(body.employee_id) : undefined;
        const now2 = Date.now();
        const sh: Sh = {
          id: `sh_${++shiftSeq}`,
          employee_id: body.employee_id ?? "",
          employee_name: emp?.name ?? "Unknown",
          role: emp?.role ?? "cashier",
          date: body.date ?? new Date().toISOString().slice(0, 10),
          start_time: body.start_time ?? "09:00",
          end_time: body.end_time ?? "17:00",
          notes: body.notes ?? null,
          created_at: now2,
          updated_at: now2,
        };
        shifts.push(sh);
        return HttpResponse.json(sh, { status: 201 });
      }),

      http.patch(`${V1}/workforce/shifts/:id`, async ({ request, params }) => {
        await lat();
        const idx = shifts.findIndex(s => s.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Sh>;
        const emp = body.employee_id ? empById(body.employee_id) : undefined;
        shifts[idx] = {
          ...shifts[idx]!,
          ...body,
          employee_name: emp?.name ?? shifts[idx]!.employee_name,
          role: emp?.role ?? shifts[idx]!.role,
          updated_at: Date.now(),
        };
        return HttpResponse.json(shifts[idx]);
      }),

      http.delete(`${V1}/workforce/shifts/:id`, async ({ params }) => {
        await lat();
        const idx = shifts.findIndex(s => s.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        shifts.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),

      http.get(`${V1}/workforce/time-off`, async () => {
        await lat();
        return HttpResponse.json({ items: timeOff });
      }),

      http.patch(`${V1}/workforce/time-off/:id`, async ({ request, params }) => {
        await lat();
        const idx = timeOff.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { status: TO["status"] };
        timeOff[idx] = { ...timeOff[idx]!, status: body.status };
        return HttpResponse.json(timeOff[idx]);
      }),
    ];
  })(),

  // ── Service Orders — repair tickets for services vertical ────────────────
  ...(() => {
    const BASE = Date.now();
    const DAY = 86_400_000;
    let seq = 0;

    interface SO {
      id: string; customer_id: string; customer_name: string; title: string;
      description: string; status: "draft" | "open" | "in_progress" | "ready" | "closed";
      assigned_to: string | null; assigned_to_name: string | null;
      estimate_cents: number; actual_cents: number | null;
      created_at: number; updated_at: number;
    }

    let orders: SO[] = [
      { id: "so_1", customer_id: "cust_1", customer_name: "Maria Garcia",  title: "Trek FX3 — brake cable replacement",          description: "Front and rear brake cables frayed. Replace both cables + housing.", status: "in_progress", assigned_to: "usr_t1", assigned_to_name: "Jake T.",  estimate_cents: 8500,  actual_cents: null,  created_at: BASE - DAY * 3, updated_at: BASE - DAY * 2 },
      { id: "so_2", customer_id: "cust_2", customer_name: "Tom Lee",       title: "Cannondale — full tune-up + tyre swap",         description: "Annual tune-up, new Continental tyres front & rear, chain lube.",   status: "ready",       assigned_to: "usr_t2", assigned_to_name: "Sara M.", estimate_cents: 12000, actual_cents: 11500, created_at: BASE - DAY * 5, updated_at: BASE - DAY * 1 },
      { id: "so_3", customer_id: "cust_3", customer_name: "Priya Sharma",  title: "iPhone 14 — screen replacement",                description: "Cracked screen, touch still works. OEM screen needed.",             status: "open",        assigned_to: null,     assigned_to_name: null,    estimate_cents: 22000, actual_cents: null,  created_at: BASE - DAY * 1, updated_at: BASE - DAY * 1 },
      { id: "so_4", customer_id: "cust_4", customer_name: "Carlos Ruiz",   title: "Espresso machine — pressure group service",     description: "Low extraction pressure. Inspect gaskets and group head.",         status: "draft",       assigned_to: null,     assigned_to_name: null,    estimate_cents: 15000, actual_cents: null,  created_at: BASE - DAY * 0, updated_at: BASE - DAY * 0 },
      { id: "so_5", customer_id: "cust_5", customer_name: "Amy Chen",      title: "MacBook Pro — battery swap",                    description: "Battery health at 64%. Customer wants replacement.",               status: "closed",      assigned_to: "usr_t1", assigned_to_name: "Jake T.",  estimate_cents: 18500, actual_cents: 18500, created_at: BASE - DAY * 7, updated_at: BASE - DAY * 4 },
      { id: "so_6", customer_id: "cust_6", customer_name: "James O'Brien", title: "Trek Domane — derailleur alignment + cable",    description: "Front derailleur rubbing on small ring. Full cable replacement.", status: "open",        assigned_to: "usr_t2", assigned_to_name: "Sara M.", estimate_cents: 6500,  actual_cents: null,  created_at: BASE - DAY * 2, updated_at: BASE - DAY * 2 },
    ];

    return [
      http.get(`${V1}/service-orders`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const q      = url.searchParams.get("q")?.toLowerCase();
        const limit  = Number(url.searchParams.get("limit")  ?? 50);
        const offset = Number(url.searchParams.get("offset") ?? 0);

        let filtered = orders;
        if (status) filtered = filtered.filter(o => o.status === status);
        if (q) filtered = filtered.filter(o =>
          o.title.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q),
        );

        const total = filtered.length;
        return HttpResponse.json({ items: filtered.slice(offset, offset + limit), total, limit, offset });
      }),

      http.get(`${V1}/service-orders/:id`, async ({ params }) => {
        await lat();
        const order = orders.find(o => o.id === String(params["id"]));
        if (!order) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(order);
      }),

      http.post(`${V1}/service-orders`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<SO>;
        const now = Date.now();
        const order: SO = {
          id: `so_${++seq}`,
          customer_id: body.customer_id ?? `cust_${seq}`,
          customer_name: body.customer_name ?? "Walk-in Customer",
          title: body.title ?? "New Ticket",
          description: body.description ?? "",
          status: "draft",
          assigned_to: body.assigned_to ?? null,
          assigned_to_name: body.assigned_to_name ?? null,
          estimate_cents: body.estimate_cents ?? 0,
          actual_cents: null,
          created_at: now,
          updated_at: now,
        };
        orders.push(order);
        return HttpResponse.json(order, { status: 201 });
      }),

      http.patch(`${V1}/service-orders/:id`, async ({ request, params }) => {
        await lat();
        const idx = orders.findIndex(o => o.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<SO>;
        orders[idx] = { ...orders[idx]!, ...body, updated_at: Date.now() };
        return HttpResponse.json(orders[idx]);
      }),
    ];
  })(),

  // ── Restaurant — floor plan, sessions, bar tabs ───────────────────────────
  ...(() => {
    const BASE = Date.now();
    let sesSeq = 0;
    let tabSeq = 0;

    interface RS {
      id: string; table_id: string; party_size: number;
      server_id: string | null; opened_at: number; notes: string | null;
    }
    interface RT {
      id: string; table_number: string; capacity: number;
      floor_section: string | null;
      status: "available" | "occupied" | "reserved" | "cleaning";
      outlet_id: string | null; current_session: RS | null;
    }
    interface RTab {
      id: string; customer_name: string | null; table_id: string | null;
      status: "open" | "closed"; opened_at: number; closed_at: number | null;
      order_ids: string[];
    }

    let tables: RT[] = [
      { id: "tbl_1", table_number: "T1", capacity: 4, floor_section: "Main",  status: "occupied",  outlet_id: null, current_session: { id: "ses_1", table_id: "tbl_1", party_size: 3, server_id: null, opened_at: BASE - 35 * 60_000, notes: null } },
      { id: "tbl_2", table_number: "T2", capacity: 2, floor_section: "Main",  status: "available", outlet_id: null, current_session: null },
      { id: "tbl_3", table_number: "T3", capacity: 6, floor_section: "Main",  status: "reserved",  outlet_id: null, current_session: null },
      { id: "tbl_4", table_number: "T4", capacity: 4, floor_section: "Main",  status: "occupied",  outlet_id: null, current_session: { id: "ses_2", table_id: "tbl_4", party_size: 2, server_id: null, opened_at: BASE - 12 * 60_000, notes: null } },
      { id: "tbl_5", table_number: "T5", capacity: 8, floor_section: "Patio", status: "available", outlet_id: null, current_session: null },
      { id: "tbl_6", table_number: "T6", capacity: 2, floor_section: "Patio", status: "available", outlet_id: null, current_session: null },
      { id: "tbl_7", table_number: "T7", capacity: 4, floor_section: "Patio", status: "cleaning",  outlet_id: null, current_session: null },
      { id: "tbl_8", table_number: "B1", capacity: 6, floor_section: "Bar",   status: "occupied",  outlet_id: null, current_session: { id: "ses_3", table_id: "tbl_8", party_size: 5, server_id: null, opened_at: BASE - 60 * 60_000, notes: "Birthday party" } },
    ];

    let tabs: RTab[] = [
      { id: "tab_1", customer_name: "Johnson", table_id: "tbl_8", status: "open",   opened_at: BASE - 55 * 60_000, closed_at: null, order_ids: ["ord_1", "ord_2"] },
      { id: "tab_2", customer_name: "Smith",   table_id: null,    status: "open",   opened_at: BASE - 20 * 60_000, closed_at: null, order_ids: ["ord_3"] },
      { id: "tab_3", customer_name: "Lee",     table_id: null,    status: "closed", opened_at: BASE - 180 * 60_000, closed_at: BASE - 60 * 60_000, order_ids: ["ord_4", "ord_5", "ord_6"] },
    ];

    // ── FE-R4: Dashboard KPI data ────────────────────────────────────────────
    const TOP_ITEMS = [
      { name: "Margherita Pizza",    qty_sold: 24, revenue_cents: 50_400 },
      { name: "Caesar Salad",        qty_sold: 19, revenue_cents: 28_500 },
      { name: "Espresso",            qty_sold: 41, revenue_cents: 16_400 },
      { name: "Grilled Salmon",      qty_sold: 14, revenue_cents: 46_200 },
      { name: "Garlic Bread",        qty_sold: 31, revenue_cents: 12_400 },
      { name: "Tiramisu",            qty_sold: 18, revenue_cents: 25_200 },
      { name: "House Wine (Glass)",  qty_sold: 27, revenue_cents: 40_500 },
    ];
    const HOURLY = [
      { hour: "10", label: "10 AM", revenue_cents: 8_200  },
      { hour: "11", label: "11 AM", revenue_cents: 15_400 },
      { hour: "12", label: "12 PM", revenue_cents: 42_100 },
      { hour: "13", label: "1 PM",  revenue_cents: 38_600 },
      { hour: "14", label: "2 PM",  revenue_cents: 21_300 },
      { hour: "15", label: "3 PM",  revenue_cents: 14_800 },
      { hour: "16", label: "4 PM",  revenue_cents: 9_500  },
      { hour: "17", label: "5 PM",  revenue_cents: 28_900 },
      { hour: "18", label: "6 PM",  revenue_cents: 47_200 },
      { hour: "19", label: "7 PM",  revenue_cents: 51_800 },
      { hour: "20", label: "8 PM",  revenue_cents: 39_400 },
      { hour: "21", label: "9 PM",  revenue_cents: 18_200 },
    ];

    return [
      // GET restaurant dashboard KPIs
      http.get(`${V1}/restaurant/dashboard`, async () => {
        await lat();
        const now = Date.now();
        const occupied = tables.filter(t => t.status === "occupied");
        const totalCovers = occupied.reduce((s, t) => s + (t.current_session?.party_size ?? 0), 0);
        return HttpResponse.json({
          kpis: {
            covers_today:       47 + totalCovers,
            avg_ticket_cents:   3_840,
            table_turns_today:  2.3,
            peak_hour:          "7:00–8:00 PM",
            open_tables:        occupied.length,
            total_tables:       tables.length,
            revenue_today_cents: 335_400,
          },
          top_items: TOP_ITEMS,
          hourly_revenue: HOURLY,
          active_sessions: tables
            .filter(t => t.status === "occupied" && t.current_session)
            .map(t => ({
              table_number: t.table_number,
              floor_section: t.floor_section,
              party_size: t.current_session!.party_size,
              elapsed_mins: Math.round((now - t.current_session!.opened_at) / 60_000),
            })),
        });
      }),

      // GET tables (with embedded current_session for floor plan elapsed timer)
      http.get(`${V1}/restaurant/tables`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const items = status ? tables.filter(t => t.status === status) : tables;
        return HttpResponse.json({ items, total: items.length });
      }),

      // POST open session → sets table occupied + creates session
      http.post(`${V1}/restaurant/tables/:id/open-session`, async ({ request, params }) => {
        await lat();
        const idx = tables.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { partySize?: number };
        const session: RS = { id: `ses_${++sesSeq}`, table_id: tables[idx]!.id, party_size: body.partySize ?? 2, server_id: null, opened_at: Date.now(), notes: null };
        tables[idx] = { ...tables[idx]!, status: "occupied", current_session: session };
        return HttpResponse.json(tables[idx], { status: 201 });
      }),

      // PATCH table status (clear session when table freed/cleaning)
      http.patch(`${V1}/restaurant/tables/:id/status`, async ({ request, params }) => {
        await lat();
        const idx = tables.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as { status?: string };
        const newStatus = (body.status ?? "available") as RT["status"];
        tables[idx] = { ...tables[idx]!, status: newStatus, current_session: newStatus === "available" || newStatus === "cleaning" ? null : tables[idx]!.current_session };
        return HttpResponse.json(tables[idx]);
      }),

      // GET bar tabs (filterable by status=open|closed)
      http.get(`${V1}/restaurant/tabs`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const items = status ? tabs.filter(t => t.status === status) : tabs;
        return HttpResponse.json({ items, total: items.length });
      }),

      // POST create bar tab
      http.post(`${V1}/restaurant/tabs`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { customerName?: string; tableId?: string };
        const tab: RTab = { id: `tab_${++tabSeq}`, customer_name: body.customerName ?? null, table_id: body.tableId ?? null, status: "open", opened_at: Date.now(), closed_at: null, order_ids: [] };
        tabs.push(tab);
        return HttpResponse.json(tab, { status: 201 });
      }),

      // POST close tab
      http.post(`${V1}/restaurant/tabs/:id/close`, async ({ params }) => {
        await lat();
        const idx = tabs.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        tabs[idx] = { ...tabs[idx]!, status: "closed", closed_at: Date.now() };
        return HttpResponse.json(tabs[idx]);
      }),

      // ── BE-R3/R4: Course assignment + Kitchen Display ────────────────────

      // In-memory course assignments: line_id → { course, status }
      ...(() => {
        interface KitchenLine {
          line_id: string; order_id: string; order_number: string;
          course: string; course_status: string; product_name: string;
          quantity: number; table_number: string | null; floor_section: string | null;
          updated_at: number;
        }
        const courseMap = new Map<string, KitchenLine>([
          ["oln_demo_1", { line_id: "oln_demo_1", order_id: "ord_demo_1", order_number: "FP-DEMO0001", course: "appetizer", course_status: "pending", product_name: "Garlic Bread", quantity: 2, table_number: "T1", floor_section: "Main", updated_at: Date.now() - 120000 }],
          ["oln_demo_2", { line_id: "oln_demo_2", order_id: "ord_demo_1", order_number: "FP-DEMO0001", course: "main",      course_status: "in_progress", product_name: "Margherita Pizza", quantity: 1, table_number: "T1", floor_section: "Main", updated_at: Date.now() - 60000 }],
          ["oln_demo_3", { line_id: "oln_demo_3", order_id: "ord_demo_2", order_number: "FP-DEMO0002", course: "drinks",   course_status: "pending", product_name: "Espresso", quantity: 3, table_number: "T4", floor_section: "Bar", updated_at: Date.now() - 30000 }],
        ]);

        return [
          http.get(`${V1}/restaurant/kitchen/queue`, async ({ request }) => {
            await lat();
            const url = new URL(request.url);
            const outletId = url.searchParams.get("outletId");
            const section  = url.searchParams.get("section");
            let items = [...courseMap.values()].filter(i => i.course_status === "pending" || i.course_status === "in_progress");
            if (section) items = items.filter(i => i.floor_section === section);
            void outletId;
            const courses = ["appetizer", "main", "dessert", "drinks"] as const;
            const grouped: Record<string, KitchenLine[]> = Object.fromEntries(courses.map(c => [c, items.filter(i => i.course === c)]));
            return HttpResponse.json({ items, grouped });
          }),

          http.patch(`${V1}/restaurant/kitchen/:lineId/bump`, async ({ params }) => {
            await lat();
            const lineId = String(params["lineId"]);
            const item = courseMap.get(lineId);
            if (!item) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const NEXT: Record<string, string> = { pending: "in_progress", in_progress: "ready", ready: "served" };
            const updated = { ...item, course_status: NEXT[item.course_status] ?? "served", updated_at: Date.now() };
            courseMap.set(lineId, updated);
            return HttpResponse.json(updated);
          }),

          http.patch(`${V1}/orders/:id/lines/:lineId/course`, async ({ params, request }) => {
            await lat();
            const body = (await request.json()) as { course: string };
            const lineId = String(params["lineId"]);
            const orderId = String(params["id"]);
            const existing = courseMap.get(lineId);
            const now = Date.now();
            const entry: KitchenLine = { ...(existing ?? { product_name: "Item", quantity: 1, table_number: null, floor_section: null, order_number: `FP-${orderId.slice(-8).toUpperCase()}`, updated_at: now }), line_id: lineId, order_id: orderId, course: body.course, course_status: "pending", updated_at: now };
            courseMap.set(lineId, entry);
            return HttpResponse.json({ id: `ocrse_${lineId}`, order_id: orderId, line_id: lineId, course: body.course, status: "pending", created_at: now, updated_at: now });
          }),
        ];
      })(),

      // ── BE-R5: Split check ───────────────────────────────────────────────

      http.post(`${V1}/orders/:id/split`, async ({ params, request }) => {
        await lat();
        const body = (await request.json()) as { splitCount?: number; lineIds?: string[][] };
        const orderId = String(params["id"]);
        const n = body.splitCount ?? (body.lineIds?.length ?? 2);
        const now = Date.now();
        const children = Array.from({ length: n }, (_, i) => ({
          id: `ord_split_${i + 1}`, tenant_id: "tnt_demo",
          order_number: `FP-SPL${String(i + 1).padStart(4, "0")}`,
          state_code: "CA", status: "open",
          subtotal_cents: 1000, discount_cents: 0, tax_cents: 80, total_cents: 1080,
          customer_id: null, store_id: null, parent_order_id: orderId,
          created_at: now, updated_at: now, lines: [],
        }));
        return HttpResponse.json(children, { status: 201 });
      }),
    ];
  })(),

  // ── Workflows — checkout automation definitions ───────────────────────────
  ...(() => {
    let wfSeq = 0;
    let stepSeq = 0;
    const BASE = Date.now();

    interface WfStep {
      id: string; workflowId: string; tenantId: string;
      name: string; stepType: string; triggerCondition: string;
      config: Record<string, unknown>; position: number;
      enabled: boolean; createdAt: number; updatedAt: number;
    }
    interface Wf {
      id: string; tenantId: string; name: string;
      description: string | null; outletId: string | null;
      enabled: boolean; steps: WfStep[];
      createdAt: number; updatedAt: number;
    }

    const workflows: Wf[] = [
      {
        id: "wf_1", tenantId: "tnt_demo",
        name: "Age Verification Gate",
        description: "Prompt cashier to verify age for restricted products",
        outletId: null, enabled: true,
        createdAt: BASE - 30 * 86_400_000, updatedAt: BASE - 5 * 86_400_000,
        steps: [
          { id: "stp_1", workflowId: "wf_1", tenantId: "tnt_demo", name: "ID Scan", stepType: "gate", triggerCondition: "age_verification", config: { minAge: 21 }, position: 1, enabled: true, createdAt: BASE - 25 * 86_400_000, updatedAt: BASE - 5 * 86_400_000 },
          { id: "stp_2", workflowId: "wf_1", tenantId: "tnt_demo", name: "Confirm Over 21", stepType: "prompt", triggerCondition: "age_verification", config: { message: "Is customer 21+?" }, position: 2, enabled: true, createdAt: BASE - 25 * 86_400_000, updatedAt: BASE - 5 * 86_400_000 },
        ],
      },
      {
        id: "wf_2", tenantId: "tnt_demo",
        name: "Loyalty Capture",
        description: "Ask for loyalty number before completing checkout",
        outletId: null, enabled: true,
        createdAt: BASE - 15 * 86_400_000, updatedAt: BASE - 2 * 86_400_000,
        steps: [
          { id: "stp_3", workflowId: "wf_2", tenantId: "tnt_demo", name: "Capture Loyalty ID", stepType: "capture", triggerCondition: "loyalty_capture", config: { field: "phone_or_card" }, position: 1, enabled: true, createdAt: BASE - 14 * 86_400_000, updatedAt: BASE - 2 * 86_400_000 },
        ],
      },
      {
        id: "wf_3", tenantId: "tnt_demo",
        name: "Signature Required",
        description: "Collect customer signature on large orders",
        outletId: null, enabled: false,
        createdAt: BASE - 7 * 86_400_000, updatedAt: BASE - 1 * 86_400_000,
        steps: [],
      },
    ];

    function makeStep(workflowId: string, body: Record<string, unknown>): WfStep {
      return {
        id: `stp_${++stepSeq + 10}`, workflowId, tenantId: "tnt_demo",
        name: String(body["name"] ?? "New Step"),
        stepType: String(body["stepType"] ?? "prompt"),
        triggerCondition: String(body["triggerCondition"] ?? "custom_prompt"),
        config: (body["config"] as Record<string, unknown>) ?? {},
        position: ((workflows.find(w => w.id === workflowId)?.steps.length ?? 0) + 1),
        enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
      };
    }

    return [
      // GET /workflows
      http.get(`${V1}/workflows`, async () => {
        await lat();
        return HttpResponse.json({ items: workflows });
      }),

      // POST /workflows
      http.post(`${V1}/workflows`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Record<string, unknown>;
        const wf: Wf = {
          id: `wf_${++wfSeq + 10}`, tenantId: "tnt_demo",
          name: String(body["name"] ?? "New Workflow"),
          description: (body["description"] as string) ?? null,
          outletId: (body["outletId"] as string) ?? null,
          enabled: true, steps: [],
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        workflows.push(wf);
        return HttpResponse.json(wf, { status: 201 });
      }),

      // PATCH /workflows/:id
      http.patch(`${V1}/workflows/:id`, async ({ request, params }) => {
        await lat();
        const idx = workflows.findIndex(w => w.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Wf>;
        workflows[idx] = { ...workflows[idx]!, ...body, updatedAt: Date.now() };
        return HttpResponse.json(workflows[idx]);
      }),

      // DELETE /workflows/:id
      http.delete(`${V1}/workflows/:id`, async ({ params }) => {
        await lat();
        const idx = workflows.findIndex(w => w.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        workflows.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),

      // POST /workflows/:id/steps
      http.post(`${V1}/workflows/:id/steps`, async ({ request, params }) => {
        await lat();
        const wfIdx = workflows.findIndex(w => w.id === String(params["id"]));
        if (wfIdx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Record<string, unknown>;
        const step = makeStep(String(params["id"]), body);
        workflows[wfIdx]!.steps.push(step);
        workflows[wfIdx]!.updatedAt = Date.now();
        return HttpResponse.json(step, { status: 201 });
      }),

      // PATCH /workflows/:id/steps/:stepId
      http.patch(`${V1}/workflows/:id/steps/:stepId`, async ({ request, params }) => {
        await lat();
        const wf = workflows.find(w => w.id === String(params["id"]));
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const sIdx = wf.steps.findIndex(s => s.id === String(params["stepId"]));
        if (sIdx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<WfStep>;
        wf.steps[sIdx] = { ...wf.steps[sIdx]!, ...body, updatedAt: Date.now() };
        wf.updatedAt = Date.now();
        return HttpResponse.json(wf.steps[sIdx]);
      }),

      // DELETE /workflows/:id/steps/:stepId
      http.delete(`${V1}/workflows/:id/steps/:stepId`, async ({ params }) => {
        await lat();
        const wf = workflows.find(w => w.id === String(params["id"]));
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const sIdx = wf.steps.findIndex(s => s.id === String(params["stepId"]));
        if (sIdx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        wf.steps.splice(sIdx, 1);
        wf.updatedAt = Date.now();
        return new HttpResponse(null, { status: 204 });
      }),

      // ── Approval Chains ──────────────────────────────────────────────────
      ...(() => {
        interface ApprovalStep { role: string; label: string }
        interface ApprovalChain {
          id: string; name: string; trigger: string; threshold: number | null;
          steps: ApprovalStep[]; enabled: boolean; runs: number; created_at: number;
        }
        let chainSeq = 10;
        const chains: ApprovalChain[] = [
          { id: "ac_1", name: "Price Override Approval",  trigger: "price_override",  threshold: 10,   steps: [{ role: "manager", label: "Manager approval" }],                                         enabled: true,  runs: 47, created_at: BASE - 60 * 86_400_000 },
          { id: "ac_2", name: "Large Refund Gate",        trigger: "refund",          threshold: 10000,steps: [{ role: "supervisor", label: "Supervisor sign-off" }, { role: "manager", label: "Manager final confirm" }], enabled: true,  runs: 12, created_at: BASE - 45 * 86_400_000 },
          { id: "ac_3", name: "New Vendor Onboard",       trigger: "vendor_create",   threshold: null, steps: [{ role: "finance", label: "Finance review" }, { role: "legal", label: "Legal sign-off" }, { role: "owner", label: "Owner approval" }], enabled: true, runs: 3, created_at: BASE - 30 * 86_400_000 },
          { id: "ac_4", name: "Discount > 25% Gate",      trigger: "discount_create", threshold: 25,   steps: [{ role: "manager", label: "Manager review" }],                                          enabled: false, runs: 0,  created_at: BASE - 10 * 86_400_000 },
        ];
        return [
          http.get(`${V1}/workflows/approval-chains`, async () => {
            await lat();
            return HttpResponse.json({ items: chains });
          }),
          http.post(`${V1}/workflows/approval-chains`, async ({ request }) => {
            await lat();
            const b = (await request.json()) as Partial<ApprovalChain>;
            const c: ApprovalChain = { id: `ac_${++chainSeq}`, name: b.name ?? "New Chain", trigger: b.trigger ?? "custom", threshold: b.threshold ?? null, steps: b.steps ?? [], enabled: true, runs: 0, created_at: Date.now() };
            chains.push(c);
            return HttpResponse.json(c, { status: 201 });
          }),
          http.patch(`${V1}/workflows/approval-chains/:id`, async ({ params, request }) => {
            await lat();
            const idx = chains.findIndex(c => c.id === String(params["id"]));
            if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
            const b = (await request.json()) as Partial<ApprovalChain>;
            chains[idx] = { ...chains[idx]!, ...b };
            return HttpResponse.json(chains[idx]);
          }),
        ];
      })(),

      // ── Run History ──────────────────────────────────────────────────────
      http.get(`${V1}/workflows/run-history`, async ({ request }) => {
        await lat();
        const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
        const runs = Array.from({ length: Math.min(limit, 30) }, (_, i) => ({
          id: `run_${i + 1}`,
          workflow_name: ["Age Verification", "Loyalty Capture", "Custom Prompt", "Price Override"][i % 4],
          trigger: ["age_verification", "loyalty_capture", "custom_prompt", "price_override"][i % 4],
          status: i % 7 === 0 ? "failed" : i % 11 === 0 ? "skipped" : "passed",
          cashier: ["Alex Johnson", "Maria Chen", "Sam Rivera", "Jamie Taylor"][i % 4],
          duration_ms: Math.floor(Math.random() * 3000 + 200),
          ran_at: BASE - i * 3_600_000,
          outlet: i % 3 === 0 ? "Store #2" : "Main Store",
        }));
        return HttpResponse.json({ items: runs, total: 320 });
      }),

      // ── Templates ────────────────────────────────────────────────────────
      http.get(`${V1}/workflows/templates`, async () => {
        await lat();
        return HttpResponse.json({
          items: [
            { id: "tpl_1", name: "Age Verification (21+)",    category: "compliance", description: "Prompts cashier to scan ID and confirm customer is 21+. Blocks transaction until confirmed.", steps: 2, installs: 1240, installed: true  },
            { id: "tpl_2", name: "Age Verification (18+)",    category: "compliance", description: "Prompts cashier to verify customer is 18+ for tobacco, lottery, or other age-restricted items.", steps: 2, installs: 890, installed: false },
            { id: "tpl_3", name: "Loyalty Phone Capture",     category: "loyalty",    description: "Prompts cashier to ask for loyalty phone number before completing the transaction.", steps: 1, installs: 2100, installed: true  },
            { id: "tpl_4", name: "Manager Price Override",    category: "approvals",  description: "Requires manager PIN entry when a manual price override exceeds 10% of retail.", steps: 3, installs: 560, installed: false },
            { id: "tpl_5", name: "Signature Required",        category: "compliance", description: "Captures customer signature on screen for orders over the configured threshold.", steps: 1, installs: 340, installed: false },
            { id: "tpl_6", name: "SNAP/EBT Eligible Check",   category: "payments",   description: "Prompts cashier to confirm which items are SNAP-eligible before EBT tender.", steps: 2, installs: 210, installed: false },
            { id: "tpl_7", name: "ID Scan Required",          category: "compliance", description: "Captures government-issued ID barcode or manual entry for restricted product categories.", steps: 1, installs: 780, installed: false },
            { id: "tpl_8", name: "Customer Required (B2B)",   category: "b2b",        description: "Blocks checkout until a customer account is selected — enforces B2B order tracking.", steps: 1, installs: 420, installed: false },
          ],
        });
      }),

      http.post(`${V1}/workflows/templates/:id/install`, async ({ params }) => {
        await lat();
        const tplId = String(params["id"]);
        const names: Record<string, string> = {
          tpl_2: "Age Verification (18+)", tpl_4: "Manager Price Override",
          tpl_5: "Signature Required", tpl_6: "SNAP/EBT Eligible Check",
          tpl_7: "ID Scan Required", tpl_8: "Customer Required (B2B)",
        };
        const wf: Wf = {
          id: `wf_tpl_${tplId}`, tenantId: "tnt_demo",
          name: names[tplId] ?? "Installed Template", description: "Installed from template",
          outletId: null, enabled: true, steps: [], createdAt: Date.now(), updatedAt: Date.now(),
        };
        workflows.push(wf);
        return HttpResponse.json({ workflow: wf }, { status: 201 });
      }),
    ];
  })(),

  // ── Golf ─────────────────────────────────────────────────────────────────
  ...(() => {
    const DAY = 86_400_000;
    const today = new Date().toISOString().slice(0, 10);
    const d = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
    let slotSeq = 20;
    let bookSeq = 20;
    let memSeq  = 20;

    type SlotStatus   = "available" | "booked" | "hold" | "closed";
    type BookStatus   = "confirmed" | "pending" | "cancelled" | "no_show" | "completed";
    type MemTier      = "standard" | "premium" | "vip" | "corporate";

    interface Slot    { id: string; date: string; tee_time: string; holes: 9|18; max_players: number; booked_players: number; status: SlotStatus; price_cents: number; cart_fee_cents: number; notes: string|null; }
    interface Booking { id: string; slot_id: string; date: string; tee_time: string; holes: 9|18; players: number; member_id: string|null; member_name: string|null; guest_name: string|null; guest_phone: string|null; status: BookStatus; total_cents: number; paid_cents: number; cart_included: boolean; notes: string|null; created_at: number; }
    interface Member  { id: string; name: string; email: string; phone: string|null; tier: MemTier; handicap: number|null; membership_number: string; joined_at: number; expires_at: number|null; rounds_played: number; outstanding_cents: number; notes: string|null; }

    // Tee slots — 3 days worth
    const mkSlot = (id: string, date: string, time: string, holes: 9|18, booked: number, status: SlotStatus, price: number): Slot => ({
      id, date, tee_time: time, holes, max_players: 4, booked_players: booked, status, price_cents: price, cart_fee_cents: 1800, notes: null,
    });
    let slots: Slot[] = [
      mkSlot("slot_1",  today, "07:00", 18, 4, "booked",    9500),
      mkSlot("slot_2",  today, "07:10", 18, 2, "available", 9500),
      mkSlot("slot_3",  today, "07:20", 18, 0, "available", 9500),
      mkSlot("slot_4",  today, "07:30", 18, 0, "hold",      9500),
      mkSlot("slot_5",  today, "07:40", 18, 4, "booked",    9500),
      mkSlot("slot_6",  today, "08:00", 9,  2, "available", 5500),
      mkSlot("slot_7",  today, "08:20", 9,  0, "available", 5500),
      mkSlot("slot_8",  today, "09:00", 18, 0, "closed",    9500),
      mkSlot("slot_9",  d(1),  "07:00", 18, 0, "available", 9500),
      mkSlot("slot_10", d(1),  "07:10", 18, 2, "available", 9500),
      mkSlot("slot_11", d(1),  "08:00", 9,  0, "available", 5500),
      mkSlot("slot_12", d(2),  "07:00", 18, 0, "available", 9500),
      mkSlot("slot_13", d(2),  "08:00", 9,  4, "booked",    5500),
    ];

    // Bookings
    let bookings: Booking[] = [
      { id: "book_1",  slot_id: "slot_1",  date: today, tee_time: "07:00", holes: 18, players: 4, member_id: "mem_1",  member_name: "James Harrington",  guest_name: null,         guest_phone: null,         status: "confirmed",  total_cents: 46000, paid_cents: 46000, cart_included: true,  notes: null,                    created_at: Date.now() - 7 * DAY },
      { id: "book_2",  slot_id: "slot_2",  date: today, tee_time: "07:10", holes: 18, players: 2, member_id: "mem_2",  member_name: "Sandra Liu",        guest_name: "David Kim",  guest_phone: "+15552345678", status: "confirmed",  total_cents: 27600, paid_cents: 27600, cart_included: true,  notes: "Guest is a corporate client", created_at: Date.now() - 3 * DAY },
      { id: "book_3",  slot_id: "slot_5",  date: today, tee_time: "07:40", holes: 18, players: 4, member_id: null,     member_name: null,                guest_name: "Raj Patel",  guest_phone: "+15559876543", status: "confirmed",  total_cents: 46000, paid_cents: 23000, cart_included: true,  notes: null,                    created_at: Date.now() - 1 * DAY },
      { id: "book_4",  slot_id: "slot_6",  date: today, tee_time: "08:00", holes: 9,  players: 2, member_id: "mem_3",  member_name: "Elena Voronova",    guest_name: null,         guest_phone: null,         status: "pending",    total_cents: 14600, paid_cents: 0,     cart_included: false, notes: null,                    created_at: Date.now() - 2 * DAY },
      { id: "book_5",  slot_id: "slot_10", date: d(1),  tee_time: "07:10", holes: 18, players: 2, member_id: "mem_1",  member_name: "James Harrington",  guest_name: null,         guest_phone: null,         status: "confirmed",  total_cents: 22400, paid_cents: 22400, cart_included: true,  notes: null,                    created_at: Date.now() - DAY },
    ];

    // Members
    let members: Member[] = [
      { id: "mem_1", name: "James Harrington",  email: "james@example.com",   phone: "+15551234567", tier: "vip",       handicap: 8,    membership_number: "GC-0001", joined_at: Date.now() - 730 * DAY, expires_at: Date.now() + 180 * DAY, rounds_played: 62,  outstanding_cents: 0,    notes: "Prefers morning tee times" },
      { id: "mem_2", name: "Sandra Liu",         email: "sandra@example.com",  phone: "+15552345678", tier: "premium",   handicap: 14,   membership_number: "GC-0002", joined_at: Date.now() - 365 * DAY, expires_at: Date.now() + 90  * DAY, rounds_played: 31,  outstanding_cents: 0,    notes: null },
      { id: "mem_3", name: "Elena Voronova",     email: "elena@example.com",   phone: null,           tier: "standard",  handicap: 22,   membership_number: "GC-0003", joined_at: Date.now() - 120 * DAY, expires_at: Date.now() + 245 * DAY, rounds_played: 9,   outstanding_cents: 14600, notes: null },
      { id: "mem_4", name: "Marcus Tate",        email: "marcus@example.com",  phone: "+15553456789", tier: "corporate", handicap: null, membership_number: "GC-0004", joined_at: Date.now() - 200 * DAY, expires_at: Date.now() + 165 * DAY, rounds_played: 18,  outstanding_cents: 0,    notes: "Corporate account — Tate & Sons Ltd" },
      { id: "mem_5", name: "Priya Nair",         email: "priya@example.com",   phone: "+15554567890", tier: "standard",  handicap: 18,   membership_number: "GC-0005", joined_at: Date.now() - 45  * DAY, expires_at: null, rounds_played: 4, outstanding_cents: 0, notes: null },
    ];

    // Pro shop items
    const proShop = [
      { id: "ps_1", product_id: "prod_ps_1", name: "Titleist Pro V1 Balls (12-pack)", sku: "GOLF-TV1-12", category: "balls",       brand: "Titleist",      price_cents: 5499, cost_cents: 3200, stock_qty: 48, reorder_pt: 12, image_url: null },
      { id: "ps_2", product_id: "prod_ps_2", name: "Callaway Apex Irons Set (4-PW)",  sku: "GOLF-CA-SET", category: "clubs",       brand: "Callaway",      price_cents: 89900, cost_cents: 54000, stock_qty: 3, reorder_pt: 2, image_url: null },
      { id: "ps_3", product_id: "prod_ps_3", name: "FootJoy Tour-S Shoes (M10)",     sku: "GOLF-FJ-M10", category: "footwear",    brand: "FootJoy",       price_cents: 18999, cost_cents: 11000, stock_qty: 6, reorder_pt: 3, image_url: null },
      { id: "ps_4", product_id: "prod_ps_4", name: "Ping G430 Driver 10.5°",         sku: "GOLF-PG-DRV", category: "clubs",       brand: "Ping",          price_cents: 59999, cost_cents: 36000, stock_qty: 2, reorder_pt: 1, image_url: null },
      { id: "ps_5", product_id: "prod_ps_5", name: "Under Armour Polo — Navy L",     sku: "GOLF-UA-NVL", category: "apparel",     brand: "Under Armour",  price_cents: 6999,  cost_cents: 3800, stock_qty: 14, reorder_pt: 5, image_url: null },
      { id: "ps_6", product_id: "prod_ps_6", name: "Titleist Tour Cart Bag",          sku: "GOLF-TV-BAG", category: "bags",        brand: "Titleist",      price_cents: 34999, cost_cents: 21000, stock_qty: 4, reorder_pt: 2, image_url: null },
      { id: "ps_7", product_id: "prod_ps_7", name: "Golf Pride MCC +4 Grips (13-pk)",sku: "GOLF-GP-GRP", category: "accessories", brand: "Golf Pride",    price_cents: 4999,  cost_cents: 2800, stock_qty: 22, reorder_pt: 8, image_url: null },
    ];

    return [
      // ── Tee Sheet ────────────────────────────────────────────────────────────
      http.get(`${V1}/golf/tee-sheet`, async ({ request }) => {
        await lat();
        const url  = new URL(request.url);
        const date = url.searchParams.get("date") ?? today;
        const list = slots.filter(s => s.date === date);
        return HttpResponse.json({ items: list, date });
      }),

      http.post(`${V1}/golf/tee-slots`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<Slot>;
        const slot: Slot = {
          id: `slot_${++slotSeq}`, date: b.date ?? today, tee_time: b.tee_time ?? "08:00",
          holes: b.holes ?? 18, max_players: b.max_players ?? 4, booked_players: 0,
          status: "available", price_cents: b.price_cents ?? 9500, cart_fee_cents: b.cart_fee_cents ?? 1800, notes: b.notes ?? null,
        };
        slots.push(slot);
        return HttpResponse.json(slot, { status: 201 });
      }),

      http.patch(`${V1}/golf/tee-slots/:id`, async ({ params, request }) => {
        await lat();
        const idx = slots.findIndex(s => s.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<Slot>;
        slots[idx] = { ...slots[idx], ...b };
        return HttpResponse.json(slots[idx]);
      }),

      // ── Bookings ─────────────────────────────────────────────────────────────
      http.get(`${V1}/golf/bookings`, async ({ request }) => {
        await lat();
        const url    = new URL(request.url);
        const date   = url.searchParams.get("date") ?? "";
        const status = url.searchParams.get("status") ?? "";
        const q      = url.searchParams.get("q") ?? "";
        const limit  = Number(url.searchParams.get("limit") ?? 50);
        let list = bookings;
        if (date)   list = list.filter(b => b.date === date);
        if (status) list = list.filter(b => b.status === status);
        if (q) {
          const lq = q.toLowerCase();
          list = list.filter(b =>
            (b.member_name ?? "").toLowerCase().includes(lq) ||
            (b.guest_name  ?? "").toLowerCase().includes(lq) ||
            b.id.toLowerCase().includes(lq),
          );
        }
        return HttpResponse.json({ items: list.slice(0, limit), total: list.length });
      }),

      http.get(`${V1}/golf/bookings/:id`, async ({ params }) => {
        await lat();
        const b = bookings.find(x => x.id === String(params["id"]));
        if (!b) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(b);
      }),

      http.post(`${V1}/golf/bookings`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Booking>;
        const slot = slots.find(s => s.id === body.slot_id);
        if (!slot) return HttpResponse.json({ error: { code: "not_found", message: "Slot not found" } }, { status: 404 });
        if (slot.status === "closed") return HttpResponse.json({ error: { code: "slot_closed" } }, { status: 409 });
        const players = body.players ?? 1;
        const total = (slot.price_cents + (body.cart_included ? slot.cart_fee_cents : 0)) * players;
        const booking: Booking = {
          id: `book_${++bookSeq}`, slot_id: slot.id, date: slot.date, tee_time: slot.tee_time, holes: slot.holes,
          players, member_id: body.member_id ?? null, member_name: body.member_name ?? null,
          guest_name: body.guest_name ?? null, guest_phone: body.guest_phone ?? null,
          status: "confirmed", total_cents: total, paid_cents: 0, cart_included: body.cart_included ?? false,
          notes: body.notes ?? null, created_at: Date.now(),
        };
        bookings.push(booking);
        const slotIdx = slots.findIndex(s => s.id === slot.id);
        slots[slotIdx].booked_players += players;
        if (slots[slotIdx].booked_players >= slots[slotIdx].max_players) slots[slotIdx].status = "booked";
        return HttpResponse.json(booking, { status: 201 });
      }),

      http.patch(`${V1}/golf/bookings/:id`, async ({ params, request }) => {
        await lat();
        const idx = bookings.findIndex(b => b.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Booking>;
        if (body.status === "cancelled" && bookings[idx].status !== "cancelled") {
          const slotIdx = slots.findIndex(s => s.id === bookings[idx].slot_id);
          if (slotIdx !== -1) {
            slots[slotIdx].booked_players = Math.max(0, slots[slotIdx].booked_players - bookings[idx].players);
            if (slots[slotIdx].status === "booked") slots[slotIdx].status = "available";
          }
        }
        bookings[idx] = { ...bookings[idx], ...body };
        return HttpResponse.json(bookings[idx]);
      }),

      // ── Members ───────────────────────────────────────────────────────────────
      http.get(`${V1}/golf/members`, async ({ request }) => {
        await lat();
        const url  = new URL(request.url);
        const tier = url.searchParams.get("tier") ?? "";
        const q    = url.searchParams.get("q") ?? "";
        let list = members;
        if (tier) list = list.filter(m => m.tier === tier);
        if (q) {
          const lq = q.toLowerCase();
          list = list.filter(m =>
            m.name.toLowerCase().includes(lq) ||
            m.email.toLowerCase().includes(lq) ||
            m.membership_number.toLowerCase().includes(lq),
          );
        }
        return HttpResponse.json({ items: list, total: list.length });
      }),

      http.get(`${V1}/golf/members/:id`, async ({ params }) => {
        await lat();
        const m = members.find(x => x.id === String(params["id"]));
        if (!m) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const memberBookings = bookings.filter(b => b.member_id === m.id);
        return HttpResponse.json({ ...m, bookings: memberBookings });
      }),

      http.post(`${V1}/golf/members`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<Member>;
        const member: Member = {
          id: `mem_${++memSeq}`,
          name: b.name ?? "New Member",
          email: b.email ?? "",
          phone: b.phone ?? null,
          tier: b.tier ?? "standard",
          handicap: b.handicap ?? null,
          membership_number: `GC-${String(memSeq).padStart(4, "0")}`,
          joined_at: Date.now(),
          expires_at: b.expires_at ?? Date.now() + 365 * DAY,
          rounds_played: 0,
          outstanding_cents: 0,
          notes: b.notes ?? null,
        };
        members.push(member);
        return HttpResponse.json(member, { status: 201 });
      }),

      http.patch(`${V1}/golf/members/:id`, async ({ params, request }) => {
        await lat();
        const idx = members.findIndex(m => m.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<Member>;
        members[idx] = { ...members[idx], ...b };
        return HttpResponse.json(members[idx]);
      }),

      // ── Pro Shop ──────────────────────────────────────────────────────────────
      http.get(`${V1}/golf/pro-shop`, async ({ request }) => {
        await lat();
        const url      = new URL(request.url);
        const category = url.searchParams.get("category") ?? "";
        const q        = url.searchParams.get("q") ?? "";
        let list = proShop;
        if (category) list = list.filter(p => p.category === category);
        if (q) {
          const lq = q.toLowerCase();
          list = list.filter(p => p.name.toLowerCase().includes(lq) || p.sku.toLowerCase().includes(lq) || (p.brand ?? "").toLowerCase().includes(lq));
        }
        const lowStock = list.filter(p => p.stock_qty <= p.reorder_pt).length;
        return HttpResponse.json({ items: list, total: list.length, low_stock_count: lowStock });
      }),
    ];
  })(),

  // ── Promotions ────────────────────────────────────────────────────────────
  ...(() => {
    const DAY = 86_400_000;
    const NOW = Date.now();
    let seq = 10;
    let couponSeq = 100;
    interface Promo {
      id: string; name: string; code: string | null;
      type: "percent_off" | "fixed_off" | "bogo" | "bundle" | "flash";
      value: number; scope: "all" | "category" | "product"; scope_value: string | null;
      status: "active" | "scheduled" | "expired" | "draft";
      starts_at: number; ends_at: number | null;
      usage_count: number; usage_limit: number | null;
      per_customer_limit: number | null;
      channel: "all" | "pos" | "ecommerce";
      stackable: boolean;
      revenue_impact_cents: number;
      created_at: number;
    }
    interface CouponCode {
      id: string; code: string; promotion_id: string; promotion_name: string;
      type: "single_use" | "multi_use";
      used: boolean; used_at: number | null; customer_name: string | null; created_at: number;
    }
    interface FlashSale {
      id: string; name: string; discount_pct: number;
      scope: "all" | "category" | "product"; scope_value: string | null;
      starts_at: number; ends_at: number;
      status: "upcoming" | "live" | "ended";
      units_sold: number; revenue_cents: number;
    }
    interface BundleRule {
      id: string; name: string; min_items: number; discount_pct: number;
      products: Array<{ sku: string; name: string }>;
      active: boolean; usage_count: number;
    }
    interface StackRule {
      id: string; promo_a_name: string; promo_b_name: string;
      can_stack: boolean; priority: number; note: string | null;
    }

    let promos: Promo[] = [
      { id: "promo_1", name: "Summer Sip Sale",      code: "SUMMER20",  type: "percent_off", value: 20,  scope: "category", scope_value: "Beverages", status: "active",    starts_at: NOW - 5 * DAY,  ends_at: NOW + 25 * DAY,  usage_count: 142, usage_limit: 500, per_customer_limit: null, channel: "all",       stackable: true,  revenue_impact_cents: 284000, created_at: NOW - 30 * DAY },
      { id: "promo_2", name: "Snack Attack BOGO",    code: null,        type: "bogo",        value: 1,   scope: "category", scope_value: "Snacks",    status: "active",    starts_at: NOW - 2 * DAY,  ends_at: NOW + 12 * DAY,  usage_count: 38,  usage_limit: null,channel: "pos",       per_customer_limit: 3,    stackable: false, revenue_impact_cents: 95000,  created_at: NOW - 7 * DAY  },
      { id: "promo_3", name: "$2 Off Energy Drinks", code: "ENERGY2",   type: "fixed_off",   value: 200, scope: "product",  scope_value: "BEV-003",   status: "active",    starts_at: NOW - 1 * DAY,  ends_at: null,             usage_count: 7,   usage_limit: 100, per_customer_limit: 2,    channel: "all",       stackable: true,  revenue_impact_cents: 1400,   created_at: NOW - 3 * DAY  },
      { id: "promo_4", name: "Back-to-School Bundle",code: "BTSAVE",    type: "bundle",      value: 3,   scope: "all",      scope_value: null,        status: "scheduled", starts_at: NOW + 14 * DAY, ends_at: NOW + 30 * DAY,  usage_count: 0,   usage_limit: 200, per_customer_limit: null, channel: "ecommerce", stackable: false, revenue_impact_cents: 0,      created_at: NOW - 2 * DAY  },
      { id: "promo_5", name: "Spring Clearance 15%", code: "SPRING15",  type: "percent_off", value: 15,  scope: "all",      scope_value: null,        status: "expired",   starts_at: NOW - 60 * DAY, ends_at: NOW - 10 * DAY,  usage_count: 324, usage_limit: null,per_customer_limit: null, channel: "all",       stackable: true,  revenue_impact_cents: 648000, created_at: NOW - 65 * DAY },
      { id: "promo_6", name: "Flash Friday 30% Off", code: null,        type: "flash",       value: 30,  scope: "all",      scope_value: null,        status: "active",    starts_at: NOW - 2 * 3600000, ends_at: NOW + 4 * 3600000, usage_count: 89, usage_limit: null,per_customer_limit: 1,   channel: "all",       stackable: false, revenue_impact_cents: 267000, created_at: NOW - 3 * DAY  },
    ];

    const couponCodes: CouponCode[] = [
      { id: "cpn_1",  code: "SUMMER20",  promotion_id: "promo_1", promotion_name: "Summer Sip Sale",      type: "multi_use",  used: false, used_at: null,             customer_name: null,          created_at: NOW - 30 * DAY },
      { id: "cpn_2",  code: "ENERGY2",   promotion_id: "promo_3", promotion_name: "$2 Off Energy Drinks", type: "multi_use",  used: false, used_at: null,             customer_name: null,          created_at: NOW - 3 * DAY  },
      { id: "cpn_3",  code: "BTSAVE",    promotion_id: "promo_4", promotion_name: "Back-to-School Bundle",type: "multi_use",  used: false, used_at: null,             customer_name: null,          created_at: NOW - 2 * DAY  },
      { id: "cpn_4",  code: "SPRING15",  promotion_id: "promo_5", promotion_name: "Spring Clearance 15%", type: "multi_use",  used: true,  used_at: NOW - 11 * DAY,  customer_name: null,          created_at: NOW - 65 * DAY },
      { id: "cpn_5",  code: "SU20-A1B2", promotion_id: "promo_1", promotion_name: "Summer Sip Sale",      type: "single_use", used: true,  used_at: NOW - 3 * DAY,   customer_name: "Alice Nguyen", created_at: NOW - 10 * DAY },
      { id: "cpn_6",  code: "SU20-C3D4", promotion_id: "promo_1", promotion_name: "Summer Sip Sale",      type: "single_use", used: false, used_at: null,             customer_name: null,          created_at: NOW - 10 * DAY },
      { id: "cpn_7",  code: "SU20-E5F6", promotion_id: "promo_1", promotion_name: "Summer Sip Sale",      type: "single_use", used: false, used_at: null,             customer_name: null,          created_at: NOW - 10 * DAY },
      { id: "cpn_8",  code: "EN2-G7H8",  promotion_id: "promo_3", promotion_name: "$2 Off Energy Drinks", type: "single_use", used: true,  used_at: NOW - 1 * DAY,   customer_name: "Bob Martinez", created_at: NOW - 5 * DAY  },
      { id: "cpn_9",  code: "EN2-I9J0",  promotion_id: "promo_3", promotion_name: "$2 Off Energy Drinks", type: "single_use", used: false, used_at: null,             customer_name: null,          created_at: NOW - 5 * DAY  },
      { id: "cpn_10", code: "EN2-K1L2",  promotion_id: "promo_3", promotion_name: "$2 Off Energy Drinks", type: "single_use", used: false, used_at: null,             customer_name: null,          created_at: NOW - 5 * DAY  },
    ];

    const flashSales: FlashSale[] = [
      { id: "fl_1", name: "Flash Friday 30% Off",     discount_pct: 30, scope: "all",      scope_value: null,       starts_at: NOW - 2 * 3600000, ends_at: NOW + 4 * 3600000,   status: "live",     units_sold: 89,  revenue_cents: 890000  },
      { id: "fl_2", name: "Happy Hour Snacks 25% Off",discount_pct: 25, scope: "category", scope_value: "Snacks",   starts_at: NOW + 2 * 3600000, ends_at: NOW + 5 * 3600000,   status: "upcoming", units_sold: 0,   revenue_cents: 0       },
      { id: "fl_3", name: "Morning Rush Coffee 15%",  discount_pct: 15, scope: "category", scope_value: "Coffee",   starts_at: NOW - 30 * DAY,    ends_at: NOW - 29 * DAY + 14400000, status: "ended", units_sold: 203, revenue_cents: 1218000 },
      { id: "fl_4", name: "Weekend Beverage Blitz",   discount_pct: 20, scope: "category", scope_value: "Beverages",starts_at: NOW + 3 * DAY,     ends_at: NOW + 5 * DAY,       status: "upcoming", units_sold: 0,   revenue_cents: 0       },
    ];

    const bundleRules: BundleRule[] = [
      { id: "bnd_1", name: "Morning Bundle",     min_items: 2, discount_pct: 10, active: true,  usage_count: 47,  products: [{ sku: "BEV-001", name: "Dark Roast Coffee" }, { sku: "SNK-003", name: "Blueberry Muffin" }] },
      { id: "bnd_2", name: "Party Pack",         min_items: 4, discount_pct: 15, active: true,  usage_count: 12,  products: [{ sku: "BEV-007", name: "Sparkling Water (6-pack)" }, { sku: "SNK-001", name: "Mixed Nuts" }, { sku: "SNK-005", name: "Pretzels" }, { sku: "BEV-004", name: "Soda 12-pack" }] },
      { id: "bnd_3", name: "Energy Starter Kit", min_items: 3, discount_pct: 12, active: true,  usage_count: 28,  products: [{ sku: "BEV-003", name: "Energy Drink Original" }, { sku: "BEV-010", name: "Energy Drink Zero" }, { sku: "SNK-008", name: "Protein Bar" }] },
      { id: "bnd_4", name: "Old Stock Bundle",   min_items: 2, discount_pct: 20, active: false, usage_count: 156, products: [{ sku: "OLD-001", name: "Legacy SKU A" }, { sku: "OLD-002", name: "Legacy SKU B" }] },
    ];

    const stackRules: StackRule[] = [
      { id: "stk_1", promo_a_name: "Summer Sip Sale",    promo_b_name: "$2 Off Energy Drinks", can_stack: true,  priority: 1, note: "Both can apply simultaneously" },
      { id: "stk_2", promo_a_name: "Snack Attack BOGO",  promo_b_name: "Spring Clearance 15%", can_stack: false, priority: 2, note: "BOGO takes precedence" },
      { id: "stk_3", promo_a_name: "Flash Friday 30%",   promo_b_name: "Summer Sip Sale",      can_stack: false, priority: 1, note: "Flash sales are always exclusive" },
      { id: "stk_4", promo_a_name: "Morning Bundle",     promo_b_name: "Summer Sip Sale",      can_stack: true,  priority: 3, note: null },
    ];

    return [
      // Sub-paths BEFORE catch-all /:id
      http.get(`${V1}/promotions/coupons`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const list = q ? couponCodes.filter(c => c.code.toLowerCase().includes(q) || c.promotion_name.toLowerCase().includes(q)) : couponCodes;
        return HttpResponse.json({ items: list });
      }),

      http.post(`${V1}/promotions/coupons/generate`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { count?: number; type?: "single_use" | "multi_use"; promotion_id?: string };
        const count = Math.min(b.count ?? 10, 50);
        const generated: CouponCode[] = [];
        for (let i = 0; i < count; i++) {
          couponSeq++;
          const code = `GEN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          const c: CouponCode = {
            id: `cpn_${couponSeq}`, code, promotion_id: b.promotion_id ?? "promo_1",
            promotion_name: "Generated Batch", type: b.type ?? "single_use",
            used: false, used_at: null, customer_name: null, created_at: Date.now(),
          };
          couponCodes.push(c);
          generated.push(c);
        }
        return HttpResponse.json({ generated, count: generated.length }, { status: 201 });
      }),

      http.get(`${V1}/promotions/flash-sales`, async () => {
        await lat();
        return HttpResponse.json({ items: flashSales });
      }),

      http.get(`${V1}/promotions/bundles`, async () => {
        await lat();
        return HttpResponse.json({ items: bundleRules });
      }),

      http.get(`${V1}/promotions/stackability`, async () => {
        await lat();
        return HttpResponse.json({ items: stackRules });
      }),

      http.get(`${V1}/promotions/analytics`, async () => {
        await lat();
        const NOW2 = Date.now();
        const DAY2 = 86_400_000;
        return HttpResponse.json({
          total_redemptions: 600,
          total_revenue_impact_cents: 1295400,
          avg_order_lift_pct: 18.4,
          top_promotions: [
            { name: "Spring Clearance 15%",  redemptions: 324, revenue_cents: 648000  },
            { name: "Summer Sip Sale",       redemptions: 142, revenue_cents: 284000  },
            { name: "Flash Friday 30% Off",  redemptions: 89,  revenue_cents: 267000  },
            { name: "Snack Attack BOGO",     redemptions: 38,  revenue_cents: 95000   },
            { name: "$2 Off Energy Drinks",  redemptions: 7,   revenue_cents: 1400    },
          ],
          redemptions_by_day: Array.from({ length: 14 }, (_, i) => ({
            date: new Date(NOW2 - (13 - i) * DAY2).toISOString().slice(0, 10),
            count: Math.floor(Math.random() * 60 + 10),
          })),
          channel_split: { pos: 72, ecommerce: 28 },
        });
      }),

      http.get(`${V1}/promotions`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status") ?? "";
        const q      = url.searchParams.get("q") ?? "";
        const limit  = Number(url.searchParams.get("limit") ?? 50);
        let list = promos;
        if (status) list = list.filter(p => p.status === status);
        if (q)      list = list.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || (p.code ?? "").toLowerCase().includes(q.toLowerCase()));
        return HttpResponse.json({ items: list.slice(0, limit), total: list.length });
      }),

      http.post(`${V1}/promotions`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<Promo>;
        const promo: Promo = {
          id: `promo_${++seq}`,
          name: b.name ?? "Untitled",
          code: b.code ?? null,
          type: b.type ?? "percent_off",
          value: b.value ?? 0,
          scope: b.scope ?? "all",
          scope_value: b.scope_value ?? null,
          status: b.status ?? "draft",
          starts_at: b.starts_at ?? Date.now(),
          ends_at: b.ends_at ?? null,
          usage_count: 0,
          usage_limit: b.usage_limit ?? null,
          per_customer_limit: b.per_customer_limit ?? null,
          channel: b.channel ?? "all",
          stackable: b.stackable ?? true,
          revenue_impact_cents: 0,
          created_at: Date.now(),
        };
        promos.push(promo);
        return HttpResponse.json(promo, { status: 201 });
      }),

      http.patch(`${V1}/promotions/:id`, async ({ params, request }) => {
        await lat();
        const idx = promos.findIndex(p => p.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<Promo>;
        promos[idx] = { ...promos[idx]!, ...b };
        return HttpResponse.json(promos[idx]);
      }),

      http.delete(`${V1}/promotions/:id`, async ({ params }) => {
        await lat();
        const before = promos.length;
        promos = promos.filter(p => p.id !== String(params["id"]));
        if (promos.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Sales History ──────────────────────────────────────────────────────────
  ...(() => {
    const NOW  = Date.now();
    const DAY  = 86_400_000;
    const HOUR = 3_600_000;

    interface SaleLine  { qty: number; name: string; unit_price_cents: number; tax_cents: number; total_cents: number; }
    interface SalePayment { method: string; amount_cents: number; date: number; }
    interface SaleRecord {
      id: string; receipt_number: string; created_at: number;
      customer_name: string | null; sold_by: string; outlet: string;
      note: string | null; total_cents: number;
      status: "completed" | "open" | "voided" | "returned";
      lines: SaleLine[]; payments: SalePayment[];
    }

    const STAFF = ["Alex Johnson", "Maria Chen", "Sam Rivera", "Jamie Taylor", "Casey Morgan"];

    function makeSale(id: string, receipt: string, offsetMs: number, opts: Partial<SaleRecord>): SaleRecord {
      const ts = NOW - offsetMs;
      return {
        id,
        receipt_number: receipt,
        created_at: ts,
        customer_name: opts.customer_name ?? null,
        sold_by: opts.sold_by ?? STAFF[Math.floor(Math.random() * STAFF.length)]!,
        outlet: "Main Outlet",
        note: opts.note ?? null,
        total_cents: opts.total_cents ?? 0,
        status: opts.status ?? "completed",
        lines: opts.lines ?? [],
        payments: opts.payments ?? [],
      };
    }

    const sales: SaleRecord[] = [
      makeSale("sale_001", "R-10042", 2 * HOUR, {
        customer_name: "Emily Carter",
        sold_by: "Alex Johnson",
        total_cents: 4597,
        note: "Regular customer",
        status: "completed",
        lines: [
          { qty: 2, name: "Coffee Blend 500g", unit_price_cents: 1499, tax_cents: 135, total_cents: 2998 },
          { qty: 1, name: "Reusable Travel Mug", unit_price_cents: 1599, tax_cents: 0,   total_cents: 1599 },
        ],
        payments: [{ method: "Card", amount_cents: 4597, date: NOW - 2 * HOUR }],
      }),
      makeSale("sale_002", "R-10041", 4 * HOUR, {
        sold_by: "Maria Chen",
        total_cents: 12499,
        status: "completed",
        lines: [
          { qty: 1, name: "Wireless Keyboard", unit_price_cents: 9999, tax_cents: 900, total_cents: 9999 },
          { qty: 1, name: "USB Hub 7-Port",    unit_price_cents: 2500, tax_cents: 225, total_cents: 2500 },
        ],
        payments: [{ method: "Cash", amount_cents: 12499, date: NOW - 4 * HOUR }],
      }),
      makeSale("sale_003", "R-10040", 6 * HOUR, {
        customer_name: "David Park",
        sold_by: "Sam Rivera",
        total_cents: 2199,
        note: "Exchange - different size",
        status: "returned",
        lines: [{ qty: 1, name: "Notebook A5", unit_price_cents: 2199, tax_cents: 0, total_cents: 2199 }],
        payments: [{ method: "Card", amount_cents: 2199, date: NOW - 6 * HOUR }],
      }),
      makeSale("sale_004", "R-10039", 1 * DAY, {
        customer_name: "Sophia Williams",
        sold_by: "Jamie Taylor",
        total_cents: 7850,
        status: "completed",
        lines: [
          { qty: 3, name: "Protein Bar 12-Pack", unit_price_cents: 1999, tax_cents: 0,   total_cents: 5997 },
          { qty: 1, name: "Shaker Bottle",        unit_price_cents: 1853, tax_cents: 0,   total_cents: 1853 },
        ],
        payments: [{ method: "Card", amount_cents: 7850, date: NOW - 1 * DAY }],
      }),
      makeSale("sale_005", "R-10038", 1 * DAY + 3 * HOUR, {
        sold_by: "Casey Morgan",
        total_cents: 999,
        status: "voided",
        note: "Wrong register",
        lines: [{ qty: 1, name: "Candy Bar", unit_price_cents: 999, tax_cents: 0, total_cents: 999 }],
        payments: [],
      }),
      makeSale("sale_006", "R-10037", 2 * DAY, {
        customer_name: "Liam O'Brien",
        sold_by: "Alex Johnson",
        total_cents: 34500,
        status: "completed",
        lines: [
          { qty: 1, name: "Standing Desk 120cm", unit_price_cents: 29999, tax_cents: 2700, total_cents: 29999 },
          { qty: 2, name: "Cable Manager",       unit_price_cents: 2251, tax_cents: 203,  total_cents: 4501  },
        ],
        payments: [
          { method: "Card",  amount_cents: 20000, date: NOW - 2 * DAY },
          { method: "Store credit", amount_cents: 14500, date: NOW - 2 * DAY },
        ],
      }),
      makeSale("sale_007", "R-10036", 3 * DAY, {
        customer_name: "Ava Thompson",
        sold_by: "Maria Chen",
        total_cents: 5598,
        status: "completed",
        lines: [
          { qty: 2, name: "Scented Candle",  unit_price_cents: 1999, tax_cents: 0, total_cents: 3998 },
          { qty: 1, name: "Gift Wrap Service", unit_price_cents: 1600, tax_cents: 0, total_cents: 1600 },
        ],
        payments: [{ method: "Cash", amount_cents: 5598, date: NOW - 3 * DAY }],
      }),
      makeSale("sale_008", "R-10035", 4 * DAY, {
        sold_by: "Sam Rivera",
        total_cents: 8999,
        status: "completed",
        lines: [{ qty: 1, name: "Bluetooth Speaker", unit_price_cents: 8999, tax_cents: 810, total_cents: 8999 }],
        payments: [{ method: "Card", amount_cents: 8999, date: NOW - 4 * DAY }],
      }),
    ];

    return [
      http.get(`${V1}/sales/history`, async ({ request }) => {
        await lat();
        const url    = new URL(request.url);
        const status = url.searchParams.get("status") ?? "";
        const q      = url.searchParams.get("q") ?? "";
        let list     = [...sales];
        if (status && status !== "all") list = list.filter(s => s.status === status);
        if (q) {
          const ql = q.toLowerCase();
          list = list.filter(s =>
            s.receipt_number.toLowerCase().includes(ql) ||
            (s.customer_name ?? "").toLowerCase().includes(ql) ||
            (s.note ?? "").toLowerCase().includes(ql)
          );
        }
        return HttpResponse.json({ items: list });
      }),
    ];
  })(),

  // ── Auth: /me ─────────────────────────────────────────────────────────────────
  // Removed the /api/v1/auth/me mock: that path has NO real backend route (404
  // in production). PermissionsContext now reads GET /api/identity/me (the real
  // path), mocked in mocks/handlers.ts. Do not re-add /api/v1/auth/me.

  // ── Settings: Role Permissions + Custom Roles ─────────────────────────────────
  ...(() => {
    const ALL_FEATURES = [
      "register", "sales", "orders", "quotes", "returns", "payments",
      "price-override", "void-transaction", "service-orders",
      "catalog", "discounts", "gift-cards", "loyalty",
      "inventory", "purchasing", "vendors", "operations", "delivery", "shipping",
      "customers", "appointments",
      "reports", "insights", "tax-compliance", "finance", "accounting", "invoicing",
      "ecommerce", "workforce",
      "team", "settings", "workflows", "integrations", "imports-exports", "audit-log",
    ];

    const IMMUTABLE = new Set(["owner", "admin"]);

    let rolePerms: Record<string, string[]> = {
      owner:      ALL_FEATURES,
      admin:      ALL_FEATURES,
      manager:    ["register", "sales", "orders", "quotes", "returns", "payments", "price-override", "void-transaction", "service-orders", "catalog", "discounts", "gift-cards", "loyalty", "inventory", "purchasing", "vendors", "operations", "shipping", "customers", "appointments", "reports", "insights", "tax-compliance", "finance", "accounting", "invoicing", "team", "workflows"],
      sales:      ["register", "sales", "orders", "quotes", "returns", "payments", "price-override", "catalog", "discounts", "gift-cards", "loyalty", "customers", "appointments", "reports"],
      cashier:    ["register", "sales", "orders", "returns", "payments", "gift-cards", "customers"],
      accountant: ["payments", "invoicing", "purchasing", "vendors", "reports", "insights", "tax-compliance", "finance", "accounting"],
      receiver:   ["inventory", "purchasing", "vendors", "operations", "catalog"],
      shipper:    ["orders", "returns", "inventory", "shipping"],
      driver:     ["orders", "delivery"],
      warehouse:  ["inventory", "purchasing", "vendors", "operations", "shipping", "catalog"],
    };

    type CRole = { id: string; name: string; description: string; color: string; features: string[] };
    let customRoles: CRole[] = [];
    let crlSeq = 100;

    return [
      http.get(`${V1}/settings/permissions`, async () => {
        await lat();
        return HttpResponse.json({
          roles: Object.entries(rolePerms).map(([role, features]) => ({ role, features })),
          customRoles,
        });
      }),

      http.patch(`${V1}/settings/permissions`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { roles: { role: string; features: string[] }[] };
        for (const { role, features } of body.roles) {
          if (!IMMUTABLE.has(role)) rolePerms[role] = features;
        }
        return HttpResponse.json({ ok: true });
      }),

      // custom role CRUD — must be BEFORE /settings/custom-roles/:id to avoid clash
      http.get(`${V1}/settings/custom-roles`, async () => {
        await lat();
        return HttpResponse.json({ items: customRoles });
      }),

      http.post(`${V1}/settings/custom-roles`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Omit<CRole, "id">;
        const role: CRole = { id: `crl_${++crlSeq}`, name: b.name, description: b.description ?? "", color: b.color, features: b.features ?? [] };
        customRoles.push(role);
        rolePerms[role.id] = role.features;
        return HttpResponse.json({ id: role.id }, { status: 201 });
      }),

      http.patch(`${V1}/settings/custom-roles/:id`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const b = (await request.json()) as Partial<CRole>;
        const idx = customRoles.findIndex((r) => r.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        customRoles[idx] = { ...customRoles[idx]!, ...b, id };
        return HttpResponse.json(customRoles[idx]);
      }),

      http.delete(`${V1}/settings/custom-roles/:id`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const idx = customRoles.findIndex((r) => r.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        customRoles.splice(idx, 1);
        delete rolePerms[id];
        return new HttpResponse(null, { status: 204 });
      }),

      // B2B portal config
      http.get(`${V1}/settings/b2b`, async () => {
        await lat();
        return HttpResponse.json({
          enabled: false,
          approval: "manual",
          paymentTerm: "net30",
          showPricesToGuests: false,
          creditLimitEnforced: true,
          groups: [
            { id: "gold",   name: "Gold",   discountPct: 20, minOrderCents: 50000 },
            { id: "silver", name: "Silver", discountPct: 12, minOrderCents: 25000 },
            { id: "bronze", name: "Bronze", discountPct: 5,  minOrderCents: 10000 },
          ],
        });
      }),

      http.patch(`${V1}/settings/b2b`, async ({ request }) => {
        await lat();
        const _body = await request.json();
        return HttpResponse.json({ ok: true });
      }),

      // Kiosk config
      http.get(`${V1}/settings/kiosk`, async () => {
        await lat();
        return HttpResponse.json({
          enabled: false,
          idleTimeoutSecs: 120,
          showPrices: true,
          allowedPaymentMethods: ["card", "cash"],
        });
      }),

      http.patch(`${V1}/settings/kiosk`, async ({ request }) => {
        await lat();
        const _body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    ];
  })(),

  // ── Permission Requests ───────────────────────────────────────────────────
  ...(() => {
    const NOW = Date.now();
    const D = (days: number) => NOW - days * 86_400_000;

    type PRStatus = "draft" | "submitted" | "pending_review" | "approved" | "rejected" | "expired" | "revoked";
    type AccessType = "temporary" | "permanent";
    type Urgency = "low" | "normal" | "high" | "urgent";

    interface PR {
      id: string;
      requested_for_user_id: string;
      requested_for_name: string;
      requested_by_user_id: string;
      requested_by_name: string;
      permission_code: string;
      reason: string;
      business_justification: string | null;
      access_type: AccessType;
      start_at: number | null;
      end_at: number | null;
      urgency: Urgency;
      status: PRStatus;
      reviewed_by_user_id: string | null;
      reviewed_by_name: string | null;
      review_notes: string | null;
      reviewed_at: number | null;
      created_at: number;
    }

    interface Override {
      id: string;
      user_id: string;
      permission_code: string;
      granted_by_user_id: string;
      granted_by_name: string;
      source_request_id: string | null;
      starts_at: number | null;
      expires_at: number | null;
      status: "active" | "expired" | "revoked";
      created_at: number;
    }

    let prSeq = 20;
    let ovSeq = 10;

    let permissionRequests: PR[] = [
      {
        id: "pr_1", requested_for_user_id: "emp_2", requested_for_name: "Mike Chen",
        requested_by_user_id: "emp_2", requested_by_name: "Mike Chen",
        permission_code: "reports", reason: "Need to pull end-of-day sales summary for store manager.",
        business_justification: "Manager is out and I need to run EOD report.", access_type: "temporary",
        start_at: NOW, end_at: NOW + 7 * 86_400_000, urgency: "high",
        status: "pending_review", reviewed_by_user_id: null, reviewed_by_name: null,
        review_notes: null, reviewed_at: null, created_at: D(1),
      },
      {
        id: "pr_2", requested_for_user_id: "emp_3", requested_for_name: "Ashley Williams",
        requested_by_user_id: "emp_3", requested_by_name: "Ashley Williams",
        permission_code: "discounts", reason: "Need to apply promotional discounts for new client onboarding.",
        business_justification: "New B2B account — sales team approved in CRM.", access_type: "permanent",
        start_at: null, end_at: null, urgency: "normal",
        status: "submitted", reviewed_by_user_id: null, reviewed_by_name: null,
        review_notes: null, reviewed_at: null, created_at: D(2),
      },
      {
        id: "pr_3", requested_for_user_id: "emp_5", requested_for_name: "Emma Thompson",
        requested_by_user_id: "emp_1", requested_by_name: "Sarah Johnson",
        permission_code: "purchasing", reason: "Emma needs to raise urgent POs for restocking shortage items.",
        business_justification: "Receiver responsible for this warehouse during lead's leave.", access_type: "temporary",
        start_at: NOW, end_at: NOW + 14 * 86_400_000, urgency: "urgent",
        status: "approved", reviewed_by_user_id: "emp_11", reviewed_by_name: "Demo Owner",
        review_notes: "Approved for 2 weeks while lead is on leave.", reviewed_at: D(0),
        created_at: D(3),
      },
      {
        id: "pr_4", requested_for_user_id: "emp_6", requested_for_name: "James O'Brien",
        requested_by_user_id: "emp_6", requested_by_name: "James O'Brien",
        permission_code: "shipping", reason: "Shipper role doesn't have access to shipping label printer.",
        business_justification: null, access_type: "permanent",
        start_at: null, end_at: null, urgency: "low",
        status: "rejected", reviewed_by_user_id: "emp_1", reviewed_by_name: "Sarah Johnson",
        review_notes: "Shipping access is already included in your role — check with IT.", reviewed_at: D(1),
        created_at: D(5),
      },
      {
        id: "pr_5", requested_for_user_id: "emp_10", requested_for_name: "Jordan Lee",
        requested_by_user_id: "emp_10", requested_by_name: "Jordan Lee",
        permission_code: "price-override", reason: "Need to match competitor pricing on high-value items.",
        business_justification: "Customer retention for key account.", access_type: "temporary",
        start_at: NOW, end_at: NOW + 30 * 86_400_000, urgency: "normal",
        status: "pending_review", reviewed_by_user_id: null, reviewed_by_name: null,
        review_notes: null, reviewed_at: null, created_at: D(0),
      },
    ];

    let permissionOverrides: Override[] = [
      {
        id: "ov_1", user_id: "emp_5", permission_code: "purchasing",
        granted_by_user_id: "emp_11", granted_by_name: "Demo Owner",
        source_request_id: "pr_3",
        starts_at: NOW, expires_at: NOW + 14 * 86_400_000,
        status: "active", created_at: D(0),
      },
    ];

    const HIGH_RISK = new Set(["payments", "void-transaction", "settings", "team", "accounting", "finance", "tax-compliance", "audit-log"]);
    const MEDIUM_RISK = new Set(["reports", "insights", "inventory", "purchasing", "price-override", "discounts", "ecommerce", "invoicing"]);

    function riskLevel(code: string): "low" | "medium" | "high" {
      if (HIGH_RISK.has(code)) return "high";
      if (MEDIUM_RISK.has(code)) return "medium";
      return "low";
    }

    return [
      // GET /permission-requests — all (admin view, filter by status)
      http.get(`${V1}/permission-requests`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const items = status
          ? permissionRequests.filter((r) => r.status === status)
          : permissionRequests;
        return HttpResponse.json({
          items: items.map((r) => ({ ...r, risk_level: riskLevel(r.permission_code) })),
          pending_count: permissionRequests.filter((r) => r.status === "pending_review" || r.status === "submitted").length,
        });
      }),

      // POST /permission-requests — submit new request
      http.post(`${V1}/permission-requests`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<PR>;
        if (!b.permission_code || !b.reason || !b.requested_for_user_id) {
          return HttpResponse.json({ error: { code: "validation", message: "permission_code, reason, and requested_for_user_id required" } }, { status: 400 });
        }
        const pr: PR = {
          id: `pr_${++prSeq}`,
          requested_for_user_id: b.requested_for_user_id,
          requested_for_name: b.requested_for_name ?? "Unknown",
          requested_by_user_id: b.requested_by_user_id ?? b.requested_for_user_id,
          requested_by_name: b.requested_by_name ?? "Unknown",
          permission_code: b.permission_code,
          reason: b.reason,
          business_justification: b.business_justification ?? null,
          access_type: b.access_type ?? "temporary",
          start_at: b.start_at ?? null,
          end_at: b.end_at ?? null,
          urgency: b.urgency ?? "normal",
          status: "submitted",
          reviewed_by_user_id: null, reviewed_by_name: null,
          review_notes: null, reviewed_at: null,
          created_at: Date.now(),
        };
        permissionRequests.unshift(pr);
        return HttpResponse.json({ ...pr, risk_level: riskLevel(pr.permission_code) }, { status: 201 });
      }),

      // GET /permission-requests/:id
      http.get(`${V1}/permission-requests/:id`, async ({ params }) => {
        await lat();
        const pr = permissionRequests.find((r) => r.id === String(params["id"]));
        if (!pr) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ ...pr, risk_level: riskLevel(pr.permission_code) });
      }),

      // POST /permission-requests/:id/approve
      http.post(`${V1}/permission-requests/:id/approve`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const pr = permissionRequests.find((r) => r.id === id);
        if (!pr) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { review_notes?: string; expires_at?: number };
        pr.status = "approved";
        pr.reviewed_by_user_id = "emp_11";
        pr.reviewed_by_name = "Demo Owner";
        pr.review_notes = b.review_notes ?? null;
        pr.reviewed_at = Date.now();
        // Create an override
        const ov: Override = {
          id: `ov_${++ovSeq}`,
          user_id: pr.requested_for_user_id,
          permission_code: pr.permission_code,
          granted_by_user_id: "emp_11",
          granted_by_name: "Demo Owner",
          source_request_id: pr.id,
          starts_at: pr.start_at ?? Date.now(),
          expires_at: b.expires_at ?? pr.end_at ?? null,
          status: "active",
          created_at: Date.now(),
        };
        permissionOverrides.push(ov);
        return HttpResponse.json({ ...pr, risk_level: riskLevel(pr.permission_code), override: ov });
      }),

      // POST /permission-requests/:id/reject
      http.post(`${V1}/permission-requests/:id/reject`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const pr = permissionRequests.find((r) => r.id === id);
        if (!pr) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { review_notes?: string };
        pr.status = "rejected";
        pr.reviewed_by_user_id = "emp_11";
        pr.reviewed_by_name = "Demo Owner";
        pr.review_notes = b.review_notes ?? null;
        pr.reviewed_at = Date.now();
        return HttpResponse.json({ ...pr, risk_level: riskLevel(pr.permission_code) });
      }),

      // POST /permission-requests/:id/revoke
      http.post(`${V1}/permission-requests/:id/revoke`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const pr = permissionRequests.find((r) => r.id === id);
        if (!pr) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { review_notes?: string };
        pr.status = "revoked";
        pr.review_notes = b.review_notes ?? null;
        pr.reviewed_at = Date.now();
        // Revoke the override too
        const ov = permissionOverrides.find((o) => o.source_request_id === id);
        if (ov) ov.status = "revoked";
        return HttpResponse.json({ ok: true });
      }),

      // GET /team/:id/permission-requests — requests for one employee
      http.get(`${V1}/team/:id/permission-requests`, async ({ params }) => {
        await lat();
        const userId = String(params["id"]);
        const items = permissionRequests
          .filter((r) => r.requested_for_user_id === userId)
          .map((r) => ({ ...r, risk_level: riskLevel(r.permission_code) }));
        return HttpResponse.json({ items });
      }),

      // GET /team/:id/permission-overrides — active overrides for one employee
      http.get(`${V1}/team/:id/permission-overrides`, async ({ params }) => {
        await lat();
        const userId = String(params["id"]);
        const items = permissionOverrides.filter((o) => o.user_id === userId);
        return HttpResponse.json({ items });
      }),
    ];
  })(),

  // ── Inventory Pipeline ────────────────────────────────────────────────────
  ...(() => {
    const D = 86_400_000;
    const now = () => Date.now();

    const pendingItems = [
      { id: "pip_1", po_number: "PO-4002", supplier_name: "Tea Traders", product_name: "Wildflower Honey", sku: "GRO-HONEY-001", qty_ordered: 48, qty_received: 0, unit_cost_cents: 420, total_cost_cents: 20160, expected_date: now() + 3 * D, status: "ordered", days_overdue: 0, outlet: "Main Store" },
      { id: "pip_2", po_number: "PO-4003", supplier_name: "Acme Coffee Co", product_name: "Organic Dark Roast Beans", sku: "BEV-001", qty_ordered: 200, qty_received: 80, unit_cost_cents: 80, total_cost_cents: 16000, expected_date: now() - 1 * D, status: "partial", days_overdue: 1, outlet: "Main Store" },
      { id: "pip_3", po_number: "PO-4005", supplier_name: "Snack World", product_name: "Potato Chips 150g", sku: "SNK-001", qty_ordered: 100, qty_received: 0, unit_cost_cents: 110, total_cost_cents: 11000, expected_date: now() + 7 * D, status: "ordered", days_overdue: 0, outlet: "Downtown" },
      { id: "pip_4", po_number: "PO-4006", supplier_name: "Tea Traders", product_name: "Mixed Nuts 200g", sku: "SNK-002", qty_ordered: 60, qty_received: 0, unit_cost_cents: 250, total_cost_cents: 15000, expected_date: now() - 3 * D, status: "ordered", days_overdue: 3, outlet: "Main Store" },
    ];

    const receivingItems = [
      { id: "rec_1", po_number: "PO-4004", supplier_name: "Acme Coffee Co", product_name: "Energy Drink 250ml", sku: "BEV-003", qty_ordered: 144, qty_received: 72, qty_remaining: 72, unit_cost_cents: 100, started_at: now() - 45 * 60_000, receiver: "Maria S.", outlet: "Main Store", batch_id: "BATCH-2407-01" },
      { id: "rec_2", po_number: "PO-4007", supplier_name: "Snack World", product_name: "Classic Cigarettes 20pk", sku: "TOB-001", qty_ordered: 500, qty_received: 320, qty_remaining: 180, unit_cost_cents: 850, started_at: now() - 2 * 3_600_000, receiver: "John D.", outlet: "Downtown", batch_id: "BATCH-2407-02" },
    ];

    const reorderAlerts = [
      { id: "ral_1", product_id: "prod_2", product_name: "Wildflower Honey", sku: "GRO-HONEY-001", current_stock: 6, reorder_point: 8, safety_stock: 4, avg_daily_sales: 1.2, days_until_stockout: 1, preferred_supplier: "Tea Traders", suggested_qty: 48, estimated_cost_cents: 20160, urgency: "critical", open_po_qty: 0 },
      { id: "ral_2", product_id: "prod_4", product_name: "Ceramic Coffee Mug", sku: "HOME-MUG-001", current_stock: 0, reorder_point: 4, safety_stock: 2, avg_daily_sales: 0.8, days_until_stockout: 0, preferred_supplier: "Home Goods Co", suggested_qty: 24, estimated_cost_cents: 14400, urgency: "critical", open_po_qty: 0 },
      { id: "ral_3", product_id: "prod_1", product_name: "Spring Water 500ml", sku: "BEV-001", current_stock: 42, reorder_point: 50, safety_stock: 10, avg_daily_sales: 8.5, days_until_stockout: 4, preferred_supplier: "Acme Coffee Co", suggested_qty: 200, estimated_cost_cents: 16000, urgency: "warning", open_po_qty: 120 },
      { id: "ral_4", product_id: "prod_7", product_name: "Mango Blast Vape 50mg", sku: "TOB-FLV", current_stock: 18, reorder_point: 25, safety_stock: 5, avg_daily_sales: 2.1, days_until_stockout: 8, preferred_supplier: "Vape Supply Co", suggested_qty: 100, estimated_cost_cents: 45000, urgency: "warning", open_po_qty: 0 },
    ];

    const issueItems = [
      { id: "iss_1", po_number: "PO-3998", supplier_name: "Tea Traders", product_name: "Wildflower Honey", sku: "GRO-HONEY-001", issue_type: "price_variance", description: "Invoice price $5.20 vs PO price $4.20 — variance exceeds 10% threshold", severity: "high", created_at: now() - 2 * D, assigned_to: "Finance Team", status: "open" },
      { id: "iss_2", po_number: "PO-4001", supplier_name: "Acme Coffee Co", product_name: "Organic Dark Roast Beans", sku: "BEV-001", issue_type: "qty_discrepancy", description: "Received 180 units vs ordered 200 units — shortfall of 20 units", severity: "medium", created_at: now() - 1 * D, assigned_to: "Receiving Team", status: "open" },
      { id: "iss_3", po_number: "PO-3990", supplier_name: "Snack World", product_name: "Potato Chips 150g", sku: "SNK-001", issue_type: "quality_reject", description: "14 units rejected — packaging damage on arrival, supplier notified", severity: "low", created_at: now() - 5 * D, assigned_to: "Warehouse", status: "resolved" },
      { id: "iss_4", po_number: "PO-3995", supplier_name: "Home Goods Co", product_name: "Ceramic Coffee Mug", sku: "HOME-MUG-001", issue_type: "duplicate_po", description: "Possible duplicate of PO-3992 sent to same supplier same day — pending review", severity: "high", created_at: now() - 4 * D, assigned_to: "Purchasing Manager", status: "investigating" },
    ];

    const historyItems = [
      { id: "his_1", po_number: "PO-3998", supplier_name: "Tea Traders", product_name: "Wildflower Honey", sku: "GRO-HONEY-001", qty_ordered: 48, qty_received: 48, total_cost_cents: 20160, ordered_at: now() - 10 * D, received_at: now() - 7 * D, lead_time_days: 3, status: "closed", cost_variance_cents: 0, receiver: "Maria S." },
      { id: "his_2", po_number: "PO-3992", supplier_name: "Acme Coffee Co", product_name: "Organic Dark Roast Beans", sku: "BEV-001", qty_ordered: 200, qty_received: 200, total_cost_cents: 16000, ordered_at: now() - 15 * D, received_at: now() - 11 * D, lead_time_days: 4, status: "closed", cost_variance_cents: 0, receiver: "John D." },
      { id: "his_3", po_number: "PO-3985", supplier_name: "Snack World", product_name: "Potato Chips 150g", sku: "SNK-001", qty_ordered: 100, qty_received: 86, total_cost_cents: 9460, ordered_at: now() - 22 * D, received_at: now() - 18 * D, lead_time_days: 4, status: "closed_short", cost_variance_cents: -1540, receiver: "Maria S." },
      { id: "his_4", po_number: "PO-3980", supplier_name: "Vape Supply Co", product_name: "Mango Blast Vape 50mg", sku: "TOB-FLV", qty_ordered: 60, qty_received: 60, total_cost_cents: 36000, ordered_at: now() - 30 * D, received_at: now() - 25 * D, lead_time_days: 5, status: "closed", cost_variance_cents: 1200, receiver: "John D." },
    ];

    return [
      // GET /inventory/pipeline/summary — stage counts + KPIs
      http.get(`${V1}/inventory/pipeline/summary`, async () => {
        await lat();
        return HttpResponse.json({
          stages: [
            { key: "suggested",        label: "Suggested",       count: 4,  value_cents: 91160 },
            { key: "draft",            label: "Draft PO",        count: 2,  value_cents: 31000 },
            { key: "sent",             label: "Sent to Supplier",count: 3,  value_cents: 46160 },
            { key: "confirmed",        label: "Confirmed",       count: 2,  value_cents: 26000 },
            { key: "in_transit",       label: "In Transit",      count: 4,  value_cents: 92160 },
            { key: "partially_received", label: "Partial",       count: 2,  value_cents: 32000 },
            { key: "receiving",        label: "Receiving",       count: 2,  value_cents: 57160 },
            { key: "billed",           label: "Billed",          count: 1,  value_cents: 16000 },
            { key: "closed",           label: "Closed",          count: 24, value_cents: 210000 },
          ],
          kpis: {
            pending_pos: 4,
            overdue_pos: 2,
            open_issues: 3,
            reorder_alerts: 4,
            receiving_active: 2,
            total_pipeline_value_cents: 325480,
            avg_lead_time_days: 4.2,
            on_time_delivery_pct: 87,
          },
        });
      }),

      // GET /inventory/pipeline/pending
      http.get(`${V1}/inventory/pipeline/pending`, async () => {
        await lat();
        return HttpResponse.json({ items: pendingItems });
      }),

      // GET /inventory/pipeline/receiving
      http.get(`${V1}/inventory/pipeline/receiving`, async () => {
        await lat();
        return HttpResponse.json({ items: receivingItems });
      }),

      // POST /inventory/pipeline/receiving/:id/update — scan units in
      http.post(`${V1}/inventory/pipeline/receiving/:id/update`, async ({ params, request }) => {
        await lat();
        const body = (await request.json()) as { qty_scanned: number };
        const item = receivingItems.find((r) => r.id === String(params["id"]));
        if (!item) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const newReceived = Math.min(item.qty_ordered, item.qty_received + (body.qty_scanned ?? 0));
        item.qty_received = newReceived;
        item.qty_remaining = item.qty_ordered - newReceived;
        return HttpResponse.json(item);
      }),

      // GET /inventory/pipeline/reorder-alerts
      http.get(`${V1}/inventory/pipeline/reorder-alerts`, async () => {
        await lat();
        return HttpResponse.json({ items: reorderAlerts });
      }),

      // POST /inventory/pipeline/reorder-alerts/:id/create-po
      http.post(`${V1}/inventory/pipeline/reorder-alerts/:id/create-po`, async ({ params }) => {
        await lat();
        const alert = reorderAlerts.find((a) => a.id === String(params["id"]));
        if (!alert) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({ po_id: `po_${rid()}`, po_number: `PO-${4000 + Math.floor(Math.random() * 1000)}`, supplier: alert.preferred_supplier, product: alert.product_name, qty: alert.suggested_qty, status: "draft" }, { status: 201 });
      }),

      // GET /inventory/pipeline/issues
      http.get(`${V1}/inventory/pipeline/issues`, async () => {
        await lat();
        return HttpResponse.json({ items: issueItems });
      }),

      // PATCH /inventory/pipeline/issues/:id — update issue status
      http.patch(`${V1}/inventory/pipeline/issues/:id`, async ({ params, request }) => {
        await lat();
        const body = (await request.json()) as { status: string };
        const idx = issueItems.findIndex((i) => i.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        issueItems[idx] = { ...issueItems[idx], status: body.status };
        return HttpResponse.json(issueItems[idx]);
      }),

      // GET /inventory/pipeline/history
      http.get(`${V1}/inventory/pipeline/history`, async () => {
        await lat();
        return HttpResponse.json({ items: historyItems });
      }),
    ];
  })(),

  // ── Pricing Engine ──────────────────────────────────────────────────────────
  ...(() => {
    const now = Date.now();
    const d = (days: number) => now - days * 86_400_000;
    const f = (days: number) => now + days * 86_400_000;

    const priceBooks = [
      { id: "pb_1", name: "Standard Retail",      type: "retail",         currency: "USD", productCount: 412, active: true,  description: "Default retail pricing for all outlets" },
      { id: "pb_2", name: "Wholesale B2B",         type: "wholesale",      currency: "USD", productCount: 380, active: true,  description: "Wholesale prices for approved B2B customers" },
      { id: "pb_3", name: "South Branch",          type: "location",       currency: "USD", productCount: 210, active: true,  description: "Location-specific overrides for South Branch" },
      { id: "pb_4", name: "Amazon Marketplace",    type: "marketplace",    currency: "USD", productCount: 155, active: true,  description: "Marketplace pricing including FBA fees" },
      { id: "pb_5", name: "Gold Member Pricing",   type: "customer-group", currency: "USD", productCount: 98,  active: true,  description: "10% discount for Gold loyalty members" },
      { id: "pb_6", name: "Legacy Wholesale",      type: "wholesale",      currency: "USD", productCount: 200, active: false, description: "Deprecated — migrated to Wholesale B2B" },
    ];

    const tierRules = [
      {
        id: "tr_1", name: "Cigarette Carton Breaks", scope: "category", categoryName: "Cigarettes",
        productId: undefined, productName: undefined, customerGroup: undefined, active: true,
        tiers: [{ minQty: 10, discountPct: 3 }, { minQty: 25, discountPct: 6 }, { minQty: 50, discountPct: 10 }],
      },
      {
        id: "tr_2", name: "Beverage Case Discount", scope: "category", categoryName: "Beverages",
        productId: undefined, productName: undefined, customerGroup: "Wholesale", active: true,
        tiers: [{ minQty: 24, discountPct: 5 }, { minQty: 96, discountPct: 9 }, { minQty: 240, discountPct: 14 }],
      },
      {
        id: "tr_3", name: "Snack Bulk Buy", scope: "all",
        productId: undefined, productName: undefined, categoryName: undefined, customerGroup: undefined, active: true,
        tiers: [{ minQty: 5, discountPct: 2 }, { minQty: 20, discountPct: 5 }],
      },
      {
        id: "tr_4", name: "Energy Drink Pallet", scope: "product", productName: "Monster Ultra White",
        categoryName: undefined, productId: "prod_4", customerGroup: undefined, active: false,
        tiers: [{ minQty: 48, discountPct: 8 }, { minQty: 144, discountPct: 12 }],
      },
    ];

    const contracts = [
      { id: "cp_1", contractNumber: "CTR-0041", customerId: "cust_1", customerName: "Emma Johnson",     productId: "prod_1", productName: "Marlboro Red 20pk",   sku: "SKU-001", retailCents: 1299, contractCents: 1049, effectiveDate: d(30), expiryDate: f(335), status: "active",  approvedBy: "Store Manager" },
      { id: "cp_2", contractNumber: "CTR-0040", customerId: "cust_2", customerName: "Marcus Rodriguez", productId: "prod_3", productName: "Celsius Energy Berry", sku: "SKU-010", retailCents:  449, contractCents:  389, effectiveDate: d(15), expiryDate: f(350), status: "active",  approvedBy: "Store Manager" },
      { id: "cp_3", contractNumber: "CTR-0039", customerId: "cust_3", customerName: "Sarah Chen",       productId: "prod_2", productName: "Newport Menthol 20pk", sku: "SKU-002", retailCents: 1349, contractCents: 1099, effectiveDate: f(5),  expiryDate: f(370), status: "pending", approvedBy: undefined },
      { id: "cp_4", contractNumber: "CTR-0035", customerId: "cust_4", customerName: "Linda Park",       productId: "prod_4", productName: "Monster Ultra White",  sku: "SKU-011", retailCents:  299, contractCents:  249, effectiveDate: d(180),expiryDate: d(2),   status: "expired", approvedBy: "Owner" },
    ];

    const scheduled = [
      { id: "sp_1", name: "4th of July Sale", productId: "prod_3", productName: "Celsius Energy Berry", sku: "SKU-010", originalCents: 449, scheduledCents: 349, startAt: f(2),  endAt: f(5),   status: "upcoming", approvalRequired: false, approvedBy: "Auto" },
      { id: "sp_2", name: "Weekend Markdown",  productId: "prod_4", productName: "Monster Ultra White",  sku: "SKU-011", originalCents: 299, scheduledCents: 249, startAt: d(1),  endAt: f(1),   status: "active",   approvalRequired: false, approvedBy: "Auto" },
      { id: "sp_3", name: "Memorial Day Sale", productId: "prod_1", productName: "Marlboro Red 20pk",    sku: "SKU-001", originalCents: 1299,scheduledCents: 1199,startAt: d(45), endAt: d(42),  status: "ended",    approvalRequired: true,  approvedBy: "Store Manager" },
      { id: "sp_4", name: "Price Increase Q3", productId: "prod_2", productName: "Newport Menthol 20pk", sku: "SKU-002", originalCents: 1349,scheduledCents: 1399,startAt: f(30), endAt: f(10000),status:"upcoming",  approvalRequired: true,  approvedBy: undefined },
    ];

    const marginRules = [
      { id: "mr_1", name: "Global Minimum",        scope: "global",    categoryName: undefined, productName: undefined, minMarginPct: 5,  action: "block",   active: true },
      { id: "mr_2", name: "Tobacco Floor",          scope: "category",  categoryName: "Tobacco", productName: undefined, minMarginPct: 12, action: "warn",    active: true },
      { id: "mr_3", name: "Beverage Margin",        scope: "category",  categoryName: "Beverages",productName: undefined,minMarginPct: 20, action: "approve", active: true },
      { id: "mr_4", name: "Marlboro Hard Floor",    scope: "product",   categoryName: undefined, productName: "Marlboro Red 20pk", minMarginPct: 8, action: "block", active: true },
      { id: "mr_5", name: "Premium Snacks",         scope: "category",  categoryName: "Snacks",  productName: undefined, minMarginPct: 25, action: "warn",    active: false },
    ];

    return [
      http.get(`${V1}/pricing/price-books`, async () => {
        await lat();
        return HttpResponse.json({ items: priceBooks });
      }),

      http.get(`${V1}/pricing/tier-rules`, async () => {
        await lat();
        return HttpResponse.json({ items: tierRules });
      }),

      http.get(`${V1}/pricing/contracts`, async () => {
        await lat();
        return HttpResponse.json({ items: contracts });
      }),

      http.get(`${V1}/pricing/scheduled`, async () => {
        await lat();
        return HttpResponse.json({ items: scheduled });
      }),

      http.get(`${V1}/pricing/margin-rules`, async () => {
        await lat();
        return HttpResponse.json({ items: marginRules });
      }),

      http.get(`${V1}/pricing/simulate`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const sku = url.searchParams.get("sku") ?? "SKU-001";
        const qty = Number(url.searchParams.get("qty") ?? 1);
        const customerId = url.searchParams.get("customerId") ?? "";

        const retailCents = sku === "SKU-002" ? 1349 : sku === "SKU-010" ? 449 : sku === "SKU-011" ? 299 : 1299;
        const contractMatch = customerId ? contracts.find(c => c.customerId === customerId && c.sku === sku && c.status === "active") : null;
        const tierMatch = tierRules.find(t => t.active && t.tiers.some(tier => qty >= tier.minQty));
        const activeSched = scheduled.find(s => s.sku === sku && s.status === "active");

        const steps = [
          { priority: 1, rule: "Contract price", price: contractMatch ? contractMatch.contractCents : retailCents, applied: !!contractMatch },
          { priority: 2, rule: "Customer group price", price: Math.round(retailCents * 0.9), applied: false },
          { priority: 3, rule: "Tier price", price: tierMatch ? Math.round(retailCents * (1 - tierMatch.tiers[0].discountPct / 100)) : retailCents, applied: !contractMatch && !!tierMatch },
          { priority: 4, rule: "Price book price", price: retailCents, applied: false },
          { priority: 5, rule: "Promotional price", price: Math.round(retailCents * 0.85), applied: false },
          { priority: 6, rule: "Scheduled markdown", price: activeSched ? activeSched.scheduledCents : retailCents, applied: !contractMatch && !tierMatch && !!activeSched },
          { priority: 7, rule: "Retail base price", price: retailCents, applied: !contractMatch && !tierMatch && !activeSched },
        ];

        const applied = steps.find(s => s.applied);
        return HttpResponse.json({
          finalCents: applied ? applied.price : retailCents,
          source: applied ? applied.rule : "Retail base price",
          steps,
        });
      }),
    ];
  })(),

  // ── Warehouse Management (WMS) ──────────────────────────────────────────────
  ...(() => {
    const now = Date.now();
    const d = (days: number) => now - days * 86_400_000;
    const f = (days: number) => now + days * 86_400_000;

    const locations = [
      { id: "loc_wh1",   code: "WH-MAIN",  name: "Main Warehouse",   type: "warehouse", parentId: null,     capacity: 5000, occupied: 3820, skuCount: 412, temperature: undefined },
      { id: "loc_z1",    code: "Z-A",       name: "Zone A — Dry",     type: "zone",      parentId: "loc_wh1", capacity: 1200, occupied: 980,  skuCount: 124, temperature: "Ambient" },
      { id: "loc_z2",    code: "Z-B",       name: "Zone B — Cold",    type: "zone",      parentId: "loc_wh1", capacity: 800,  occupied: 760,  skuCount: 88,  temperature: "2–8°C" },
      { id: "loc_z3",    code: "Z-C",       name: "Zone C — Bulk",    type: "zone",      parentId: "loc_wh1", capacity: 2000, occupied: 1400, skuCount: 130, temperature: "Ambient" },
      { id: "loc_a1",    code: "A-01",      name: "Aisle 1",          type: "aisle",     parentId: "loc_z1",  capacity: 300,  occupied: 240,  skuCount: 30,  temperature: undefined },
      { id: "loc_a2",    code: "A-02",      name: "Aisle 2",          type: "aisle",     parentId: "loc_z1",  capacity: 300,  occupied: 290,  skuCount: 35,  temperature: undefined },
      { id: "loc_r1",    code: "A-01-R1",   name: "Rack 1",           type: "rack",      parentId: "loc_a1",  capacity: 80,   occupied: 60,   skuCount: 10,  temperature: undefined },
      { id: "loc_s1",    code: "A-01-R1-S1",name: "Shelf 1",          type: "shelf",     parentId: "loc_r1",  capacity: 20,   occupied: 18,   skuCount: 5,   temperature: undefined },
      { id: "loc_b1",    code: "A-01-R1-B1",name: "Bin 01",           type: "bin",       parentId: "loc_s1",  capacity: 6,    occupied: 6,    skuCount: 2,   temperature: undefined },
      { id: "loc_b2",    code: "A-01-R1-B2",name: "Bin 02",           type: "bin",       parentId: "loc_s1",  capacity: 6,    occupied: 4,    skuCount: 1,   temperature: undefined },
      { id: "loc_wh2",   code: "WH-SOUTH",  name: "South Branch Store",type:"warehouse", parentId: null,     capacity: 2000, occupied: 1100, skuCount: 198, temperature: undefined },
      { id: "loc_z4",    code: "S-A",       name: "Zone A — General", type: "zone",      parentId: "loc_wh2", capacity: 1000, occupied: 700,  skuCount: 110, temperature: "Ambient" },
    ];

    const receiving: Array<{
      id: string; poNumber: string; vendorName: string; expectedDate: number;
      itemCount: number; status: "scheduled"|"in_progress"|"partial"|"complete";
      lines: Array<{ sku: string; name: string; ordered: number; received: number }>;
    }> = [
      {
        id: "rcv_1", poNumber: "PO-3041", vendorName: "Acme Distributors",
        expectedDate: f(1), itemCount: 3, status: "scheduled",
        lines: [
          { sku: "SKU-001", name: "Marlboro Red 20pk", ordered: 200, received: 0 },
          { sku: "SKU-002", name: "Newport Menthol 20pk", ordered: 150, received: 0 },
          { sku: "SKU-009", name: "Swisher Sweets Grape", ordered: 100, received: 0 },
        ],
      },
      {
        id: "rcv_2", poNumber: "PO-3038", vendorName: "Pacific Trading Co",
        expectedDate: d(1), itemCount: 2, status: "partial",
        lines: [
          { sku: "SKU-010", name: "Celsius Energy Berry", ordered: 120, received: 80 },
          { sku: "SKU-011", name: "Monster Ultra White", ordered: 144, received: 144 },
        ],
      },
      {
        id: "rcv_3", poNumber: "PO-3035", vendorName: "Tea Leaf Imports",
        expectedDate: d(3), itemCount: 4, status: "complete",
        lines: [
          { sku: "SKU-020", name: "Green Tea 16oz",     ordered: 96,  received: 96 },
          { sku: "SKU-021", name: "Oolong Reserve 16oz",ordered: 48,  received: 48 },
          { sku: "SKU-022", name: "White Peach Tea",    ordered: 72,  received: 72 },
          { sku: "SKU-023", name: "Chamomile Blend",    ordered: 60,  received: 60 },
        ],
      },
    ];

    const putaway = [
      { id: "pta_1", sku: "SKU-010", productName: "Celsius Energy Berry", qty: 80, fromLocation: "DOCK-A", suggestedBin: "Z-B-R2-B4", poNumber: "PO-3038", receivedAt: d(1), priority: "high" },
      { id: "pta_2", sku: "SKU-020", productName: "Green Tea 16oz",       qty: 96, fromLocation: "DOCK-B", suggestedBin: "Z-B-R1-B2", poNumber: "PO-3035", receivedAt: d(3), priority: "normal" },
      { id: "pta_3", sku: "SKU-021", productName: "Oolong Reserve 16oz",  qty: 48, fromLocation: "DOCK-B", suggestedBin: "Z-B-R1-B3", poNumber: "PO-3035", receivedAt: d(3), priority: "normal" },
    ];

    const picks = [
      { id: "pk_1", pickNumber: "PICK-0041", orderNumber: "ORD-1021", customerName: "Emma Johnson",     lines: 4, pickedLines: 4, strategy: "FIFO", priority: "urgent",  status: "packed",      dueAt: f(0) },
      { id: "pk_2", pickNumber: "PICK-0040", orderNumber: "ORD-1020", customerName: "Marcus Rodriguez", lines: 3, pickedLines: 2, strategy: "FIFO", priority: "high",    status: "in_progress", dueAt: f(1) },
      { id: "pk_3", pickNumber: "PICK-0039", orderNumber: "ORD-1019", customerName: "Sarah Chen",       lines: 6, pickedLines: 0, strategy: "FEFO", priority: "normal",  status: "open",        dueAt: f(2) },
      { id: "pk_4", pickNumber: "PICK-0038", orderNumber: "ORD-1018", customerName: "Linda Park",       lines: 2, pickedLines: 2, strategy: "FIFO", priority: "normal",  status: "complete",    dueAt: d(1) },
      { id: "pk_5", pickNumber: "PICK-0037", orderNumber: "ORD-1017", customerName: "Guest",            lines: 1, pickedLines: 0, strategy: "FIFO", priority: "high",    status: "open",        dueAt: d(1) },
    ];

    const cycleCounts = [
      { id: "cc_1", countNumber: "CNT-0019", zone: "Zone A — Dry",  abcClass: "A", scheduledDate: f(2),  locationCount: 40,  completedLocations: 0,  variance: undefined,  status: "scheduled" },
      { id: "cc_2", countNumber: "CNT-0018", zone: "Zone B — Cold", abcClass: "A", scheduledDate: d(1),  locationCount: 30,  completedLocations: 22, variance: undefined,  status: "in_progress" },
      { id: "cc_3", countNumber: "CNT-0017", zone: "Zone C — Bulk", abcClass: "B", scheduledDate: d(14), locationCount: 80,  completedLocations: 80, variance: -24300,     status: "complete" },
      { id: "cc_4", countNumber: "CNT-0016", zone: "Aisle 1",       abcClass: "C", scheduledDate: d(30), locationCount: 15,  completedLocations: 15, variance: 0,          status: "approved" },
      { id: "cc_5", countNumber: "CNT-0015", zone: "Zone A — Dry",  abcClass: "A", scheduledDate: d(45), locationCount: 40,  completedLocations: 40, variance: -8100,      status: "approved" },
    ];

    const recentActivity = [
      { id: "act_1", type: "receive",  label: "Received PO-3038 (80 units Celsius Energy Berry)", actor: "J. Rivera",   ts: d(1) - 3_600_000 },
      { id: "act_2", type: "putaway",  label: "Putaway SKU-011 → Z-B-R2-B1 (144 units)",          actor: "J. Rivera",   ts: d(1) - 1_800_000 },
      { id: "act_3", type: "pick",     label: "Pick PICK-0041 started for ORD-1021",               actor: "M. Santos",   ts: now - 7_200_000 },
      { id: "act_4", type: "pick",     label: "Pick PICK-0041 complete — 4/4 lines",               actor: "M. Santos",   ts: now - 5_400_000 },
      { id: "act_5", type: "count",    label: "Cycle count CNT-0018 started — Zone B Cold",        actor: "K. Williams", ts: now - 3_600_000 },
      { id: "act_6", type: "transfer", label: "Transfer 24 units SKU-001 → South Branch",          actor: "D. Miller",   ts: now - 1_200_000 },
    ];

    return [
      http.get(`${V1}/warehouse/dashboard`, async () => {
        await lat();
        return HttpResponse.json({
          totalLocations: locations.length,
          occupiedLocations: locations.filter(l => l.occupied >= l.capacity * 0.1).length,
          pendingReceiving: receiving.filter(r => r.status !== "complete").length,
          pendingPutaway: putaway.length,
          openPicks: picks.filter(p => p.status === "open" || p.status === "in_progress").length,
          scheduledCounts: cycleCounts.filter(c => c.status === "scheduled" || c.status === "in_progress").length,
          recentActivity,
        });
      }),

      http.get(`${V1}/warehouse/locations`, async () => {
        await lat();
        return HttpResponse.json({ items: locations });
      }),

      http.get(`${V1}/warehouse/receiving`, async () => {
        await lat();
        return HttpResponse.json({ items: receiving });
      }),

      http.get(`${V1}/warehouse/putaway`, async () => {
        await lat();
        return HttpResponse.json({ items: putaway });
      }),

      http.get(`${V1}/warehouse/picks`, async () => {
        await lat();
        return HttpResponse.json({ items: picks });
      }),

      http.get(`${V1}/warehouse/cycle-counts`, async () => {
        await lat();
        return HttpResponse.json({ items: cycleCounts });
      }),
    ];
  })(),

  // ── EDI Imports ───────────────────────────────────────────────────────────
  ...(() => {
    const D = 86_400_000;
    const now = () => Date.now();

    type EdiStatus = "queued" | "validating" | "valid" | "invalid" | "processed" | "failed";
    type EdiFormat = "x12_850" | "x12_855" | "x12_856" | "x12_810" | "edifact_orders" | "csv_po" | "json_po" | "xml_po";

    interface EdiImport {
      id: string;
      filename: string;
      format: EdiFormat;
      supplier_name: string;
      supplier_id: string;
      file_size_bytes: number;
      record_count: number;
      status: EdiStatus;
      uploaded_at: number;
      processed_at: number | null;
      po_count: number;
      line_count: number;
      error_count: number;
      warnings: string[];
      errors: string[];
      created_po_ids: string[];
    }

    const FORMAT_LABELS: Record<EdiFormat, string> = {
      x12_850: "X12 850 (Purchase Order)",
      x12_855: "X12 855 (PO Acknowledgment)",
      x12_856: "X12 856 (Ship Notice/ASN)",
      x12_810: "X12 810 (Invoice)",
      edifact_orders: "EDIFACT ORDERS",
      csv_po: "CSV Purchase Order",
      json_po: "JSON Purchase Order",
      xml_po: "XML Purchase Order",
    };

    let imports: EdiImport[] = [
      {
        id: "edi_1", filename: "PO_20260628_ACME.edi", format: "x12_850",
        supplier_name: "Acme Coffee Co", supplier_id: "sup_1",
        file_size_bytes: 14_820, record_count: 3, status: "processed",
        uploaded_at: now() - 4 * D, processed_at: now() - 4 * D + 45_000,
        po_count: 3, line_count: 18, error_count: 0,
        warnings: ["Line 7: Unit cost rounded to 2 decimal places"],
        errors: [], created_po_ids: ["PO-4010", "PO-4011", "PO-4012"],
      },
      {
        id: "edi_2", filename: "invoice_Q2_teatraders.x12", format: "x12_810",
        supplier_name: "Tea Traders", supplier_id: "sup_2",
        file_size_bytes: 8_450, record_count: 2, status: "valid",
        uploaded_at: now() - 1 * D, processed_at: null,
        po_count: 2, line_count: 11, error_count: 0,
        warnings: [],
        errors: [], created_po_ids: [],
      },
      {
        id: "edi_3", filename: "snackworld_orders_export.csv", format: "csv_po",
        supplier_name: "Snack World", supplier_id: "sup_3",
        file_size_bytes: 3_210, record_count: 5, status: "invalid",
        uploaded_at: now() - 2 * D, processed_at: null,
        po_count: 0, line_count: 5, error_count: 3,
        warnings: [],
        errors: [
          "Row 3: SKU 'CHIP-XL-BULK' not found in catalog",
          "Row 4: qty_ordered is not a number ('TBD')",
          "Row 5: Missing required field: unit_cost",
        ], created_po_ids: [],
      },
      {
        id: "edi_4", filename: "ASN_20260701_ACME.edi", format: "x12_856",
        supplier_name: "Acme Coffee Co", supplier_id: "sup_1",
        file_size_bytes: 6_740, record_count: 1, status: "queued",
        uploaded_at: now() - 30 * 60_000, processed_at: null,
        po_count: 0, line_count: 0, error_count: 0,
        warnings: [], errors: [], created_po_ids: [],
      },
    ];

    return [
      // GET /purchasing/edi-imports — list all imports
      http.get(`${V1}/purchasing/edi-imports`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const supplier = url.searchParams.get("supplier_id");
        let filtered = imports;
        if (status && status !== "all") filtered = filtered.filter((i) => i.status === status);
        if (supplier) filtered = filtered.filter((i) => i.supplier_id === supplier);
        return HttpResponse.json({ items: filtered, total: filtered.length });
      }),

      // GET /purchasing/edi-imports/:id — detail + preview
      http.get(`${V1}/purchasing/edi-imports/:id`, async ({ params }) => {
        await lat();
        const item = imports.find((i) => i.id === String(params["id"]));
        if (!item) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json({
          ...item,
          format_label: FORMAT_LABELS[item.format],
          preview_lines: item.status === "invalid" || item.status === "valid"
            ? [
                { line: 1, raw: "ISA*00*          *00*          *01*084748771      *01*123456789      *260628*1045*^*00501*000000001*0*P*>~", parsed: "ISA — Interchange Control Header" },
                { line: 2, raw: "GS*PO*084748771*123456789*20260628*1045*1*X*005010~", parsed: "GS — Functional Group Header (PO)" },
                { line: 3, raw: "ST*850*0001~", parsed: "ST — Transaction Set Header (850 PO)" },
                { line: 4, raw: "BEG*00*SA*PO-4010**20260628~", parsed: "BEG — Beginning Segment (SA=standing order, PO-4010)" },
                { line: 5, raw: "PO1*1*200*EA*0.80**VP*BEV-001~", parsed: "PO1 — Line 1: 200 EA @ $0.80, Vendor Part BEV-001" },
              ]
            : [],
        });
      }),

      // POST /purchasing/edi-imports — upload (simulated)
      http.post(`${V1}/purchasing/edi-imports`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as { filename: string; format: EdiFormat; supplier_id: string; supplier_name: string; file_size_bytes: number };
        const newImport: EdiImport = {
          id: `edi_${rid()}`,
          filename: body.filename,
          format: body.format,
          supplier_name: body.supplier_name,
          supplier_id: body.supplier_id,
          file_size_bytes: body.file_size_bytes ?? 4096,
          record_count: 0,
          status: "queued",
          uploaded_at: now(),
          processed_at: null,
          po_count: 0, line_count: 0, error_count: 0,
          warnings: [], errors: [], created_po_ids: [],
        };
        imports.unshift(newImport);
        return HttpResponse.json(newImport, { status: 201 });
      }),

      // POST /purchasing/edi-imports/:id/validate — run validation
      http.post(`${V1}/purchasing/edi-imports/:id/validate`, async ({ params }) => {
        await lat();
        const idx = imports.findIndex((i) => i.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        imports[idx] = {
          ...imports[idx],
          status: "valid",
          record_count: 2,
          po_count: 2,
          line_count: 9,
          error_count: 0,
          warnings: ["1 SKU matched by name — verify vendor part number"],
        };
        return HttpResponse.json(imports[idx]);
      }),

      // POST /purchasing/edi-imports/:id/process — create POs from validated import
      http.post(`${V1}/purchasing/edi-imports/:id/process`, async ({ params }) => {
        await lat();
        const idx = imports.findIndex((i) => i.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        if (imports[idx].status !== "valid") {
          return HttpResponse.json({ error: { code: "not_valid", message: "Import must be validated before processing" } }, { status: 422 });
        }
        const poIds = Array.from({ length: imports[idx].po_count || 1 }, (_, i) => `PO-${4020 + i}`);
        imports[idx] = {
          ...imports[idx],
          status: "processed",
          processed_at: now(),
          created_po_ids: poIds,
        };
        return HttpResponse.json({ import: imports[idx], created_po_ids: poIds });
      }),

      // DELETE /purchasing/edi-imports/:id — discard queued/invalid import
      http.delete(`${V1}/purchasing/edi-imports/:id`, async ({ params }) => {
        await lat();
        const idx = imports.findIndex((i) => i.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        imports.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),

      // GET /purchasing/edi-imports/formats — list supported formats
      http.get(`${V1}/purchasing/edi-imports/formats`, async () => {
        await lat();
        return HttpResponse.json({
          formats: Object.entries(FORMAT_LABELS).map(([key, label]) => ({ key, label })),
        });
      }),
    ];
  })(),

  // ── Document Center ───────────────────────────────────────────────────────
  ...(() => {
    const D = 86_400_000;
    const now = () => Date.now();

    type DocStatus = "active" | "archived" | "draft" | "expired";
    type DocType =
      | "spec_sheet" | "msds" | "certificate" | "invoice" | "purchase_order"
      | "agreement" | "compliance" | "policy" | "template" | "report" | "other";

    interface Doc {
      id: string; name: string; type: DocType; status: DocStatus;
      file_name: string; file_size_bytes: number; mime_type: string;
      linked_entity_type: string | null; linked_entity_id: string | null; linked_entity_name: string | null;
      uploaded_by: string; uploaded_at: number; expires_at: number | null;
      tags: string[]; version: number; description: string | null;
    }

    interface DocTemplate {
      id: string; name: string; type: DocType; description: string;
      file_name: string; uses: number; created_at: number;
    }

    const TYPE_LABELS: Record<DocType, string> = {
      spec_sheet: "Spec Sheet", msds: "Safety Data Sheet", certificate: "Certificate",
      invoice: "Invoice", purchase_order: "Purchase Order", agreement: "Agreement",
      compliance: "Compliance", policy: "Policy", template: "Template", report: "Report", other: "Other",
    };

    let docs: Doc[] = [
      { id: "doc_1", name: "Organic Dark Roast — Product Spec", type: "spec_sheet", status: "active", file_name: "acme_dark_roast_spec.pdf", file_size_bytes: 412_800, mime_type: "application/pdf", linked_entity_type: "product", linked_entity_id: "prod_1", linked_entity_name: "Organic Dark Roast Beans", uploaded_by: "Maria S.", uploaded_at: now() - 30 * D, expires_at: null, tags: ["coffee", "organic"], version: 2, description: "Technical specification sheet for the Organic Dark Roast Beans product line." },
      { id: "doc_2", name: "Wildflower Honey — MSDS", type: "msds", status: "active", file_name: "honey_msds_2026.pdf", file_size_bytes: 186_300, mime_type: "application/pdf", linked_entity_type: "product", linked_entity_id: "prod_2", linked_entity_name: "Wildflower Honey", uploaded_by: "John D.", uploaded_at: now() - 60 * D, expires_at: now() + 305 * D, tags: ["honey", "msds", "safety"], version: 1, description: "Material Safety Data Sheet for handling and storage." },
      { id: "doc_3", name: "Acme Coffee Co — Supplier Agreement 2026", type: "agreement", status: "active", file_name: "acme_supplier_agreement_2026.pdf", file_size_bytes: 1_248_000, mime_type: "application/pdf", linked_entity_type: "vendor", linked_entity_id: "sup_1", linked_entity_name: "Acme Coffee Co", uploaded_by: "Admin", uploaded_at: now() - 90 * D, expires_at: now() + 275 * D, tags: ["agreement", "acme", "2026"], version: 3, description: "Annual supplier agreement covering pricing, terms, and SLA." },
      { id: "doc_4", name: "PO-4002 — Tea Traders Purchase Order", type: "purchase_order", status: "active", file_name: "PO-4002_teatraders.pdf", file_size_bytes: 98_400, mime_type: "application/pdf", linked_entity_type: "purchase_order", linked_entity_id: "po_4002", linked_entity_name: "PO-4002", uploaded_by: "Maria S.", uploaded_at: now() - 5 * D, expires_at: null, tags: ["purchase-order", "tea-traders"], version: 1, description: null },
      { id: "doc_5", name: "Tobacco PACT Act Compliance Report Q2 2026", type: "compliance", status: "active", file_name: "pact_act_q2_2026.xlsx", file_size_bytes: 324_600, mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", linked_entity_type: null, linked_entity_id: null, linked_entity_name: null, uploaded_by: "Admin", uploaded_at: now() - 15 * D, expires_at: null, tags: ["compliance", "tobacco", "pact"], version: 1, description: "Quarterly PACT Act compliance filing." },
      { id: "doc_6", name: "Mango Blast Vape — Age Verification Certificate", type: "certificate", status: "active", file_name: "vape_age_cert_2026.pdf", file_size_bytes: 76_800, mime_type: "application/pdf", linked_entity_type: "product", linked_entity_id: "prod_7", linked_entity_name: "Mango Blast Vape 50mg", uploaded_by: "John D.", uploaded_at: now() - 45 * D, expires_at: now() + 320 * D, tags: ["vape", "age-verification", "certificate"], version: 1, description: "Age verification certificate for vape product sales." },
      { id: "doc_7", name: "Staff Policy Manual 2026", type: "policy", status: "active", file_name: "staff_policy_2026.pdf", file_size_bytes: 2_048_000, mime_type: "application/pdf", linked_entity_type: null, linked_entity_id: null, linked_entity_name: null, uploaded_by: "Admin", uploaded_at: now() - 120 * D, expires_at: null, tags: ["policy", "staff", "hr"], version: 4, description: "Employee policy manual covering procedures and code of conduct." },
      { id: "doc_8", name: "Q1 2026 Sales Report", type: "report", status: "archived", file_name: "q1_2026_sales_report.pdf", file_size_bytes: 891_200, mime_type: "application/pdf", linked_entity_type: null, linked_entity_id: null, linked_entity_name: null, uploaded_by: "Maria S.", uploaded_at: now() - 180 * D, expires_at: null, tags: ["report", "q1-2026", "sales"], version: 1, description: "Quarterly sales performance report for Q1 2026." },
    ];

    const templates: DocTemplate[] = [
      { id: "tpl_1", name: "Supplier Agreement (Standard)", type: "agreement", description: "Annual supplier agreement with pricing, SLA, and payment terms.", file_name: "supplier_agreement_template.docx", uses: 14, created_at: now() - 200 * D },
      { id: "tpl_2", name: "Purchase Order", type: "purchase_order", description: "Standard PO template for all supplier orders.", file_name: "purchase_order_template.docx", uses: 87, created_at: now() - 365 * D },
      { id: "tpl_3", name: "Product Specification Sheet", type: "spec_sheet", description: "Fillable product spec template with fields for ingredients and certifications.", file_name: "product_spec_template.docx", uses: 22, created_at: now() - 150 * D },
      { id: "tpl_4", name: "Compliance Audit Checklist", type: "compliance", description: "PACT Act and state tobacco compliance checklist.", file_name: "compliance_checklist_template.xlsx", uses: 8, created_at: now() - 90 * D },
      { id: "tpl_5", name: "Staff Policy Addendum", type: "policy", description: "Policy addendum template for one-off amendments.", file_name: "policy_addendum_template.docx", uses: 3, created_at: now() - 60 * D },
    ];

    return [
      // GET /documents/types — must be before /:id
      http.get(`${V1}/documents/types`, async () => {
        await lat();
        return HttpResponse.json({
          types: Object.entries(TYPE_LABELS).map(([key, label]) => ({
            key, label, count: docs.filter((d) => d.type === key && d.status !== "archived").length,
          })),
        });
      }),

      // GET /documents/templates — must be before /:id
      http.get(`${V1}/documents/templates`, async () => {
        await lat();
        return HttpResponse.json({ items: templates });
      }),

      // GET /documents — list
      http.get(`${V1}/documents`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const type   = url.searchParams.get("type");
        const status = url.searchParams.get("status");
        const q      = url.searchParams.get("q");
        let filtered = docs;
        if (type && type !== "all")     filtered = filtered.filter((d) => d.type === type);
        if (status && status !== "all") filtered = filtered.filter((d) => d.status === status);
        if (q) filtered = filtered.filter((d) =>
          d.name.toLowerCase().includes(q.toLowerCase()) ||
          d.tags.some((t) => t.includes(q.toLowerCase()))
        );
        return HttpResponse.json({ items: filtered, total: filtered.length });
      }),

      // GET /documents/:id
      http.get(`${V1}/documents/:id`, async ({ params }) => {
        await lat();
        const doc = docs.find((d) => d.id === String(params["id"]));
        if (!doc) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(doc);
      }),

      // POST /documents
      http.post(`${V1}/documents`, async ({ request }) => {
        await lat();
        const body = (await request.json()) as Partial<Doc>;
        const newDoc: Doc = {
          id: `doc_${rid()}`, name: body.name ?? "Untitled Document", type: body.type ?? "other",
          status: "active", file_name: body.file_name ?? "document.pdf",
          file_size_bytes: body.file_size_bytes ?? 102_400, mime_type: body.mime_type ?? "application/pdf",
          linked_entity_type: body.linked_entity_type ?? null, linked_entity_id: body.linked_entity_id ?? null,
          linked_entity_name: body.linked_entity_name ?? null, uploaded_by: "Current User",
          uploaded_at: Date.now(), expires_at: body.expires_at ?? null,
          tags: body.tags ?? [], version: 1, description: body.description ?? null,
        };
        docs.unshift(newDoc);
        return HttpResponse.json(newDoc, { status: 201 });
      }),

      // PATCH /documents/:id
      http.patch(`${V1}/documents/:id`, async ({ params, request }) => {
        await lat();
        const idx = docs.findIndex((d) => d.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<Doc>;
        docs[idx] = { ...docs[idx], ...body };
        return HttpResponse.json(docs[idx]);
      }),

      // DELETE /documents/:id — soft archive
      http.delete(`${V1}/documents/:id`, async ({ params }) => {
        await lat();
        const idx = docs.findIndex((d) => d.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        docs[idx] = { ...docs[idx], status: "archived" };
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Inventory Error Check Center ──────────────────────────────────────────
  ...(() => {
    const D = 86_400_000;
    const now = () => Date.now();

    type ErrCategory =
      | "sku_mapping" | "supplier_mapping" | "price_mismatch" | "qty_mismatch"
      | "duplicate_doc" | "missing_barcode" | "missing_cost" | "below_min_order"
      | "expiry_risk" | "unapproved_supplier" | "edi_parse" | "po_invoice_mismatch"
      | "receiving_mismatch";

    type ErrSeverity = "critical" | "high" | "medium" | "low";
    type ErrStatus = "open" | "in_review" | "resolved" | "ignored" | "escalated";

    interface InventoryError {
      id: string;
      category: ErrCategory;
      severity: ErrSeverity;
      status: ErrStatus;
      title: string;
      description: string;
      affected_entity_type: string;
      affected_entity_id: string;
      affected_entity_name: string;
      detected_at: number;
      resolved_at: number | null;
      resolved_by: string | null;
      resolution: string | null;
      po_number: string | null;
      supplier_name: string | null;
      sku: string | null;
      notes: string | null;
    }

    const CATEGORY_LABELS: Record<ErrCategory, string> = {
      sku_mapping: "SKU Mapping",
      supplier_mapping: "Supplier Mapping",
      price_mismatch: "Price Mismatch",
      qty_mismatch: "Quantity Mismatch",
      duplicate_doc: "Duplicate Document",
      missing_barcode: "Missing Barcode",
      missing_cost: "Missing Cost",
      below_min_order: "Below Min. Order",
      expiry_risk: "Expiry Risk",
      unapproved_supplier: "Unapproved Supplier",
      edi_parse: "EDI Parse Error",
      po_invoice_mismatch: "PO / Invoice Mismatch",
      receiving_mismatch: "Receiving Mismatch",
    };

    let errors: InventoryError[] = [
      { id: "err_1", category: "sku_mapping", severity: "critical", status: "open", title: "Unknown SKU on EDI 856 import", description: "EDI ASN received from Acme Coffee Co references SKU 'ACM-88421' which has no matching product in the catalog.", affected_entity_type: "edi_import", affected_entity_id: "edi_4", affected_entity_name: "EDI ASN 2026-07-01", detected_at: now() - 2 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: "PO-4010", supplier_name: "Acme Coffee Co", sku: "ACM-88421", notes: null },
      { id: "err_2", category: "price_mismatch", severity: "high", status: "open", title: "Invoice price 18% above PO cost", description: "Supplier invoice INV-2026-334 from Tea Traders shows unit cost $14.90 vs PO agreed price $12.60 for Jasmine Green Tea.", affected_entity_type: "invoice", affected_entity_id: "inv_334", affected_entity_name: "INV-2026-334", detected_at: now() - 1 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: "PO-4002", supplier_name: "Tea Traders", sku: "TTR-JGT-100", notes: null },
      { id: "err_3", category: "qty_mismatch", severity: "high", status: "in_review", title: "Received qty 40 vs ordered 60", description: "PO-3998 for Wildflower Honey shows 40 units received at dock but PO ordered 60. Supplier claims 20 units on backorder.", affected_entity_type: "purchase_order", affected_entity_id: "po_3998", affected_entity_name: "PO-3998", detected_at: now() - 3 * D, resolved_at: null, resolved_by: "Maria S.", resolution: null, po_number: "PO-3998", supplier_name: "Honey Co", sku: "HC-WFH-250", notes: "Waiting for supplier backorder ETA." },
      { id: "err_4", category: "duplicate_doc", severity: "medium", status: "open", title: "Duplicate PO number detected", description: "PO-4008 was submitted twice. Duplicate detected before processing. Second submission blocked automatically.", affected_entity_type: "purchase_order", affected_entity_id: "po_4008_dup", affected_entity_name: "PO-4008 (duplicate)", detected_at: now() - 4 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: "PO-4008", supplier_name: "Acme Coffee Co", sku: null, notes: null },
      { id: "err_5", category: "missing_barcode", severity: "medium", status: "open", title: "12 products missing UPC barcode", description: "12 active catalog products have no barcode assigned. They cannot be scanned at POS or in receiving.", affected_entity_type: "catalog", affected_entity_id: "bulk_12", affected_entity_name: "12 products", detected_at: now() - 5 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: null, supplier_name: null, sku: null, notes: null },
      { id: "err_6", category: "missing_cost", severity: "high", status: "open", title: "No purchase cost for 8 products", description: "8 products have no purchase cost on record. Margin reporting and reorder suggestions will be inaccurate.", affected_entity_type: "catalog", affected_entity_id: "bulk_8", affected_entity_name: "8 products", detected_at: now() - 6 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: null, supplier_name: null, sku: null, notes: null },
      { id: "err_7", category: "below_min_order", severity: "low", status: "open", title: "Draft PO-4011 below minimum order", description: "Draft PO to Vape Supply Co totals $280. Supplier minimum order is $500. PO will likely be rejected.", affected_entity_type: "purchase_order", affected_entity_id: "po_4011", affected_entity_name: "PO-4011 (Draft)", detected_at: now() - 1 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: "PO-4011", supplier_name: "Vape Supply Co", sku: null, notes: null },
      { id: "err_8", category: "expiry_risk", severity: "critical", status: "open", title: "43 units expire within 7 days", description: "43 units across 3 products (Organic Dark Roast ×20, Chamomile Tea ×15, Protein Bar ×8) expire within 7 days. Markdown or transfer recommended.", affected_entity_type: "inventory", affected_entity_id: "expiry_batch_07", affected_entity_name: "Near-expiry batch", detected_at: now() - 2 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: null, supplier_name: null, sku: null, notes: null },
      { id: "err_9", category: "unapproved_supplier", severity: "high", status: "open", title: "PO raised to unapproved supplier", description: "PO-4009 was raised to 'Budget Vapes LLC' which is not on the approved supplier list.", affected_entity_type: "purchase_order", affected_entity_id: "po_4009", affected_entity_name: "PO-4009", detected_at: now() - 3 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: "PO-4009", supplier_name: "Budget Vapes LLC", sku: null, notes: null },
      { id: "err_10", category: "edi_parse", severity: "high", status: "open", title: "EDI 810 invoice parse failed", description: "Incoming EDI 810 invoice from Frozen Foods Co failed to parse — ISA segment malformed. File rejected.", affected_entity_type: "edi_import", affected_entity_id: "edi_5", affected_entity_name: "EDI 810 — Frozen Foods Co", detected_at: now() - 1 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: null, supplier_name: "Frozen Foods Co", sku: null, notes: null },
      { id: "err_11", category: "po_invoice_mismatch", severity: "high", status: "in_review", title: "Invoice quantity doesn't match PO", description: "Invoice INV-2026-301 from Grocery Hub bills for 120 units but PO-3985 ordered 100. Reviewing with supplier.", affected_entity_type: "invoice", affected_entity_id: "inv_301", affected_entity_name: "INV-2026-301", detected_at: now() - 7 * D, resolved_at: null, resolved_by: "John D.", resolution: null, po_number: "PO-3985", supplier_name: "Grocery Hub", sku: null, notes: "Supplier says 20 were added due to promo. Verifying." },
      { id: "err_12", category: "receiving_mismatch", severity: "medium", status: "resolved", title: "Receiving count mismatch on PO-3990", description: "Initial receiving count showed 48 units but physical recount confirmed 50. Record corrected.", affected_entity_type: "purchase_order", affected_entity_id: "po_3990", affected_entity_name: "PO-3990", detected_at: now() - 10 * D, resolved_at: now() - 8 * D, resolved_by: "Maria S.", resolution: "Recount confirmed 50 units. Inventory updated.", po_number: "PO-3990", supplier_name: "Organic Farms", sku: "OF-MIX-VEG", notes: null },
      { id: "err_13", category: "supplier_mapping", severity: "medium", status: "open", title: "Product has no supplier mapping", description: "Mango Blast Vape 50mg (SKU: VPE-MB-50) has no supplier mapped. Cannot generate reorder suggestions.", affected_entity_type: "product", affected_entity_id: "prod_7", affected_entity_name: "Mango Blast Vape 50mg", detected_at: now() - 4 * D, resolved_at: null, resolved_by: null, resolution: null, po_number: null, supplier_name: null, sku: "VPE-MB-50", notes: null },
    ];

    return [
      // GET /inventory/errors/summary
      http.get(`${V1}/inventory/errors/summary`, async () => {
        await lat();
        const open   = errors.filter((e) => e.status === "open").length;
        const review = errors.filter((e) => e.status === "in_review").length;
        const critical = errors.filter((e) => e.severity === "critical" && e.status === "open").length;
        const byCat = Object.fromEntries(
          (Object.keys(CATEGORY_LABELS) as ErrCategory[]).map((k) => [
            k,
            { label: CATEGORY_LABELS[k], open: errors.filter((e) => e.category === k && e.status === "open").length },
          ])
        );
        return HttpResponse.json({ open, in_review: review, critical, by_category: byCat });
      }),

      // GET /inventory/errors
      http.get(`${V1}/inventory/errors`, async ({ request }) => {
        await lat();
        const url      = new URL(request.url);
        const category = url.searchParams.get("category");
        const severity = url.searchParams.get("severity");
        const status   = url.searchParams.get("status");
        const q        = url.searchParams.get("q");
        let filtered = errors;
        if (category && category !== "all") filtered = filtered.filter((e) => e.category === category);
        if (severity && severity !== "all") filtered = filtered.filter((e) => e.severity === severity);
        if (status && status !== "all")    filtered = filtered.filter((e) => e.status === status);
        if (q) filtered = filtered.filter((e) =>
          e.title.toLowerCase().includes(q.toLowerCase()) ||
          (e.supplier_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
          (e.sku ?? "").toLowerCase().includes(q.toLowerCase())
        );
        return HttpResponse.json({ items: filtered, total: filtered.length });
      }),

      // GET /inventory/errors/:id
      http.get(`${V1}/inventory/errors/:id`, async ({ params }) => {
        await lat();
        const err = errors.find((e) => e.id === String(params["id"]));
        if (!err) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(err);
      }),

      // PATCH /inventory/errors/:id — resolve, ignore, escalate, in_review
      http.patch(`${V1}/inventory/errors/:id`, async ({ params, request }) => {
        await lat();
        const idx = errors.findIndex((e) => e.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const body = (await request.json()) as Partial<InventoryError> & { action?: string };
        const action = body.action;
        if (action === "resolve") {
          errors[idx] = { ...errors[idx], status: "resolved", resolved_at: Date.now(), resolved_by: "Current User", resolution: body.resolution ?? "Resolved", notes: body.notes ?? errors[idx].notes };
        } else if (action === "ignore") {
          errors[idx] = { ...errors[idx], status: "ignored", resolved_at: Date.now(), resolved_by: "Current User", resolution: body.resolution ?? "Ignored", notes: body.notes ?? errors[idx].notes };
        } else if (action === "escalate") {
          errors[idx] = { ...errors[idx], status: "escalated", notes: body.notes ?? errors[idx].notes };
        } else if (action === "review") {
          errors[idx] = { ...errors[idx], status: "in_review", resolved_by: "Current User", notes: body.notes ?? errors[idx].notes };
        } else {
          errors[idx] = { ...errors[idx], ...body };
        }
        return HttpResponse.json(errors[idx]);
      }),
    ];
  })(),
);
