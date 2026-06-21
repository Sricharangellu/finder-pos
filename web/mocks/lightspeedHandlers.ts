/**
 * MSW handlers for the Cycle-3 backend modules (customers, gift cards, webhooks,
 * inventory overview, team). Kept in a separate file so the backend agent can
 * add/maintain these without colliding with the frontend's edits to handlers.ts.
 * Wired into the main array via `...lightspeedHandlers`.
 *
 * Shapes mirror the live API (see orchestration/BACKEND_HANDOFF.md).
 */
import { http, HttpResponse, delay } from "msw";

const V1 = "*/api/v1";
const lat = () => delay(Math.floor(Math.random() * 120) + 60);
const rid = () => `mock-${Math.random().toString(36).slice(2, 10)}`;

// ── In-memory dev stores ────────────────────────────────────────────────────
const customers = new Map<string, any>();
const giftcards = new Map<string, any>();
// Billing: tracks payment-mutated bills/invoices, keyed by id, layered over the base seed rows below.
const billsStore = new Map<string, any>();
const invoicesStore = new Map<string, any>();
const BASE_BILLS: Record<string, any> = {
  bil_1: { id: "bil_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", po_id: "po_1", bill_number: "BILL-00001", status: "open", total_cents: 24000, paid_cents: 0, due_date: Date.now() + 30 * 86400000, issued_at: Date.now() - 2 * 86400000 },
  bil_2: { id: "bil_2", tenant_id: "tnt_demo", supplier_id: "sup_tea", po_id: "po_2", bill_number: "BILL-00002", status: "partial", total_cents: 11250, paid_cents: 5000, due_date: Date.now() + 20 * 86400000, issued_at: Date.now() - 86400000 },
};
const BASE_INVOICES: Record<string, any> = {
  inv_1: { id: "inv_1", tenant_id: "tnt_demo", customer_id: "cus_demo_1", order_id: "ord_a", invoice_number: "INV-00001", status: "paid", total_cents: 8600, paid_cents: 8600, due_date: Date.now() + 15 * 86400000, issued_at: Date.now() - 5 * 86400000 },
  inv_2: { id: "inv_2", tenant_id: "tnt_demo", customer_id: "cus_demo_2", order_id: null, invoice_number: "INV-00002", status: "open", total_cents: 4200, paid_cents: 0, due_date: Date.now() + 30 * 86400000, issued_at: Date.now() },
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
let ecSoSeq = 0;
// Settings dev stores
let shippingMethods: any[] = [];
let paymentTerms: any[] = [];
let paymentModes: any[] = [];
let taxRates: any[] = [];
let featureFlags: Record<string, boolean> = { quotations: true, achBatchPayout: false, imeiTracking: false, msaReporting: false, compositeProducts: false, customerPortal: false, ecommerce: true, commissionTracking: false, pickerFulfillment: true, batchDeposits: true };
let businessProfile: Record<string, unknown> = {};
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

export const lightspeedHandlers = [
  // ── Inventory overview ────────────────────────────────────────────────────
  http.get(`${V1}/inventory/overview`, async () => {
    await lat();
    const items = [
      { id: "prod_1", sku: "GRO-COFFEE-001", name: "Organic Dark Roast Beans", price_cents: 1499, category: "groceries", status: "active", stock_qty: 42, reorder_pt: 10, low_stock: false },
      { id: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", price_cents: 899, category: "groceries", status: "active", stock_qty: 6, reorder_pt: 8, low_stock: true },
      { id: "prod_3", sku: "APP-TSHIRT-001", name: "Finder Logo T-Shirt", price_cents: 2200, category: "apparel", status: "active", stock_qty: 17, reorder_pt: 5, low_stock: false },
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
  http.get(`${V1}/purchasing/orders`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "po_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", status: "received", total_cost_cents: 24000, created_at: Date.now() - 86400000, received_at: Date.now() - 3600000 },
      { id: "po_2", tenant_id: "tnt_demo", supplier_id: "sup_tea", status: "ordered", total_cost_cents: 11250, created_at: Date.now() - 3600000, received_at: null },
    ] });
  }),
  http.post(`${V1}/purchasing/orders`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as { supplierId: string; lines: Array<{ productId: string; quantity: number; unitCostCents: number }> };
    const lines = b.lines.map((l, i) => ({ id: `pol_${i}`, tenant_id: "tnt_demo", po_id: "po_new", product_id: l.productId, quantity: l.quantity, unit_cost_cents: l.unitCostCents, line_cost_cents: l.quantity * l.unitCostCents }));
    const total = lines.reduce((s, l) => s + l.line_cost_cents, 0);
    return HttpResponse.json({ id: "po_new", tenant_id: "tnt_demo", supplier_id: b.supplierId, status: "ordered", total_cost_cents: total, created_at: Date.now(), received_at: null, lines }, { status: 201 });
  }),
  http.post(`${V1}/purchasing/orders/:id/receive`, async ({ params }) => {
    await lat();
    return HttpResponse.json({ id: String(params.id), tenant_id: "tnt_demo", supplier_id: "sup_acme", status: "received", total_cost_cents: 24000, created_at: Date.now() - 3600000, received_at: Date.now(), lines: [] });
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
      { id: "sup_acme", tenant_id: "tnt_demo", name: "Acme Coffee Co", email: "orders@acme.example", created_at: Date.now(), poCount: 6, totalSpentCents: 184200, openCreditsCents: 5000 },
      { id: "sup_tea", tenant_id: "tnt_demo", name: "Tea Traders", email: null, created_at: Date.now(), poCount: 2, totalSpentCents: 41250, openCreditsCents: 0 },
    ] });
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
    const status = new URL(request.url).searchParams.get("status");
    const items = Object.keys(BASE_BILLS).map((id) => billsStore.get(id) ?? BASE_BILLS[id]);
    return HttpResponse.json({ items: status ? items.filter((b) => b.status === status) : items });
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
    const remaining = base.total_cents - base.paid_cents;
    if (body.amountCents > remaining) {
      return HttpResponse.json({ error: { code: "bad_request", message: "payment exceeds amount due", requestId: rid() } }, { status: 400 });
    }
    const paid_cents = base.paid_cents + body.amountCents;
    const updated = { ...base, paid_cents, status: paid_cents >= base.total_cents ? "paid" : "partial" };
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
      { productId: "prod_demo_a", name: "Apple", stockQty: 95, costCents: 600, retailCents: 1000, costValueCents: 57000, retailValueCents: 95000 },
      { productId: "prod_demo_b", name: "Chips", stockQty: 90, costCents: 300, retailCents: 500, costValueCents: 27000, retailValueCents: 45000 },
    ];
    return HttpResponse.json({ rows, totalCostCents: 84000, totalRetailCents: 140000 });
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
      id, sku, name, category, status: "active", priceCents, onHand, committed: 0, available: onHand, reorderPoint, lowStock: reorderPoint > 0 && onHand <= reorderPoint, costCents: null, velocity: 0,
    });
    return HttpResponse.json({
      pageSize: 100,
      items: [
        mk("prod_1", "GRO-COFFEE-001", "Organic Dark Roast Beans", "groceries", 1499, 42, 10),
        mk("prod_2", "GRO-HONEY-001", "Wildflower Honey", "groceries", 899, 6, 8),
        mk("prod_3", "APP-TSHIRT-001", "Finder Logo T-Shirt", "apparel", 2200, 17, 5),
        mk("prod_4", "HOME-MUG-001", "Ceramic Coffee Mug", "home", 1200, 0, 4),
      ],
    });
  }),

  // ── Inventory transfers ───────────────────────────────────────────────────
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

  // ── Inventory: adjustments ────────────────────────────────────────────────
  http.post(`${V1}/inventory/adjustments`, async ({ request }) => {
    await lat();
    const b = (await request.json()) as {
      product_id: string;
      location_id: string;
      delta: number;
      reason: string;
      note: string | null;
    };
    return HttpResponse.json(
      {
        id: `adj_${Math.random().toString(36).slice(2, 12)}`,
        product_id: b.product_id,
        location_id: b.location_id,
        delta: b.delta,
        reason: b.reason,
        applied_at: Date.now(),
      },
      { status: 201 },
    );
  }),

  // ── Inventory: movement ledger ────────────────────────────────────────────
  http.get(`${V1}/inventory/movements`, async ({ request }) => {
    await lat();
    const productId = new URL(request.url).searchParams.get("product_id") ?? "prod";
    const D = 86_400_000;
    const now = Date.now();
    const items = [
      { type: "sale",       delta: -2,  location: "Main Store",  actor: "POS Terminal",           note: "Order #ORD-0042",    created_at: now - 2 * 3600_000 },
      { type: "adjustment", delta: +5,  location: "Main Store",  actor: "admin@example.com",      note: "Cycle count",        created_at: now - 8 * 3600_000 },
      { type: "receive",    delta: +50, location: "Warehouse",   actor: "system",                 note: "PO-0019",            created_at: now - D },
      { type: "transfer",   delta: -10, location: "Warehouse",   actor: "system",                 note: "Transfer to Main",   created_at: now - D - 3600_000 },
      { type: "sale",       delta: -1,  location: "Main Store",  actor: "POS Terminal",           note: "Order #ORD-0039",    created_at: now - 2 * D },
      { type: "return",     delta: +1,  location: "Main Store",  actor: "cashier@finder-pos.dev", note: "Customer return",    created_at: now - 2 * D - 3600_000 },
      { type: "adjustment", delta: -3,  location: "Main Store",  actor: "manager@finder-pos.dev", note: "Damage",             created_at: now - 3 * D },
      { type: "receive",    delta: +20, location: "Main Store",  actor: "system",                 note: "PO-0017",            created_at: now - 5 * D },
    ].map((m, i) => ({ ...m, id: `mv_${productId}_${i + 1}` }));
    return HttpResponse.json({ items });
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

  // ── Team (Settings → Users) ───────────────────────────────────────────────
  // ── Team ─────────────────────────────────────────────────────────────────
  ...(() => {
    let teamSeq = 10;
    let teamMembers = [
      { id: "usr_demo_owner",   email: "owner@finder-pos.dev",   role: "owner",   custom_role_id: null,       created_at: Date.now() - 90 * 86_400_000 },
      { id: "usr_demo_manager", email: "manager@finder-pos.dev", role: "manager", custom_role_id: null,       created_at: Date.now() - 60 * 86_400_000 },
      { id: "usr_demo_cashier", email: "cashier@finder-pos.dev", role: "cashier", custom_role_id: "crl_demo_1", created_at: Date.now() - 30 * 86_400_000 },
    ];
    return [
      http.get(`${V1}/team`, async () => {
        await lat();
        return HttpResponse.json({ items: teamMembers });
      }),
      http.post(`${V1}/team/invite`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { email: string; role: string };
        if (!b.email) return HttpResponse.json({ error: { code: "validation", message: "email required" } }, { status: 400 });
        const existing = teamMembers.find(m => m.email === b.email);
        if (existing) return HttpResponse.json({ error: { code: "conflict", message: "Member already exists." } }, { status: 409 });
        const member = { id: `usr_${++teamSeq}`, email: b.email, role: b.role ?? "cashier", custom_role_id: null, created_at: Date.now() };
        teamMembers.push(member);
        return HttpResponse.json(member, { status: 201 });
      }),
      http.patch(`${V1}/team/:id`, async ({ params, request }) => {
        await lat();
        const id = String(params["id"]);
        const b = (await request.json()) as { role?: string; custom_role_id?: string | null };
        const idx = teamMembers.findIndex(m => m.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        teamMembers[idx] = { ...teamMembers[idx], ...b };
        return HttpResponse.json(teamMembers[idx]);
      }),
      http.delete(`${V1}/team/:id`, async ({ params }) => {
        await lat();
        const id = String(params["id"]);
        const idx = teamMembers.findIndex(m => m.id === id);
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        teamMembers.splice(idx, 1);
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
    ];

    // Products are stored and returned in TerminalProduct shape (camelCase) so
    // ProductGrid and the barcode scanner both receive the right field names.
    const now = Date.now();
    const mkProduct = (
      id: string, sku: string, name: string, priceCents: number,
      category: string, taxClass: "standard" | "exempt", barcode: string,
      status: "active" | "draft" | "archived", ageRestricted: boolean,
      costCents: number, createdDaysAgo: number,
    ) => ({
      id, sku, name, priceCents, category, taxClass, barcode, status, ageRestricted,
      createdAt: now - createdDaysAgo * 86_400_000, updatedAt: now - Math.floor(createdDaysAgo / 3) * 86_400_000,
      // Extended fields used by catalog management pages (snake_case subset)
      price_cents: priceCents, tax_class: taxClass, age_restricted: ageRestricted ? 1 : 0,
      raw_cost_price_cents: costCents, description: null, brand: null,
      image_url: null, msrp_cents: null, parent_product_id: null, variant_label: null,
    });

    let products = [
      mkProduct("prod_1","BEV-001","Spring Water 500ml",199,"Beverages","standard","012345678901","active",false,80,90),
      mkProduct("prod_2","BEV-002","Orange Juice 1L",349,"Beverages","standard","012345678902","active",false,140,88),
      mkProduct("prod_3","SNK-001","Potato Chips 150g",299,"Snacks","standard","012345678903","active",false,110,60),
      mkProduct("prod_4","SNK-002","Mixed Nuts 200g",599,"Snacks","standard","012345678904","active",false,250,45),
      mkProduct("prod_5","TOB-001","Classic Cigarettes 20pk",1299,"Tobacco","exempt","012345678905","active",true,850,100),
      mkProduct("prod_6","BEV-003","Energy Drink 250ml",249,"Beverages","standard","012345678906","draft",false,100,5),
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
        return HttpResponse.json({
          product_id: id,
          locations: [
            { location_id: "loc_1", location_code: "MAIN-FLR", location_name: "Main Floor", quantity_on_hand: 48, quantity_committed: 6, quantity_available: 42, average_cost_cents: p.raw_cost_price_cents },
            { location_id: "loc_2", location_code: "WAREHOUSE", location_name: "Warehouse", quantity_on_hand: 120, quantity_committed: 0, quantity_available: 120, average_cost_cents: p.raw_cost_price_cents },
          ],
        });
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

      http.post(`${V1}/catalog/import-csv`, async () => {
        await lat();
        return HttpResponse.json({ imported: 3, skipped: 0, errors: [] }, { status: 200 });
      }),

      // ── Categories ────────────────────────────────────────────────────────
      http.get(`${V1}/catalog/categories`, async () => {
        await lat();
        return HttpResponse.json({ items: categories });
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
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Workflows ─────────────────────────────────────────────────────────────
  ...(() => {
    let wfSeq   = 10;
    let stepSeq = 10;

    type Step = {
      id: string; workflowId: string; tenantId: string; name: string;
      stepType: string; triggerCondition: string;
      config: Record<string, unknown>; position: number;
      enabled: boolean; createdAt: number; updatedAt: number;
    };
    type WF = {
      id: string; tenantId: string; name: string; description: string | null;
      outletId: string | null; enabled: boolean; steps: Step[];
      createdAt: number; updatedAt: number;
    };

    const now = Date.now();
    let workflows: WF[] = [
      {
        id: "wf_demo_1", tenantId: "t1",
        name: "Age Verification",
        description: "Require age check before selling restricted items",
        outletId: null, enabled: true,
        createdAt: now - 60 * 86_400_000, updatedAt: now - 10 * 86_400_000,
        steps: [
          {
            id: "step_demo_1", workflowId: "wf_demo_1", tenantId: "t1",
            name: "Prompt cashier for ID",
            stepType: "prompt", triggerCondition: "age_verification",
            config: { message: "Check customer ID before proceeding." },
            position: 1, enabled: true,
            createdAt: now - 60 * 86_400_000, updatedAt: now - 10 * 86_400_000,
          },
          {
            id: "step_demo_2", workflowId: "wf_demo_1", tenantId: "t1",
            name: "Gate: confirm 18+",
            stepType: "gate", triggerCondition: "age_verification",
            config: { minAge: 18 },
            position: 2, enabled: true,
            createdAt: now - 60 * 86_400_000, updatedAt: now - 10 * 86_400_000,
          },
        ],
      },
      {
        id: "wf_demo_2", tenantId: "t1",
        name: "Loyalty Capture",
        description: "Capture loyalty member info at checkout",
        outletId: null, enabled: false,
        createdAt: now - 30 * 86_400_000, updatedAt: now - 5 * 86_400_000,
        steps: [
          {
            id: "step_demo_3", workflowId: "wf_demo_2", tenantId: "t1",
            name: "Ask for loyalty ID",
            stepType: "capture", triggerCondition: "loyalty_capture",
            config: { field: "loyalty_id", label: "Loyalty card number" },
            position: 1, enabled: true,
            createdAt: now - 30 * 86_400_000, updatedAt: now - 5 * 86_400_000,
          },
        ],
      },
    ];

    function withSteps(wf: WF) { return { ...wf, steps: workflows.find((w) => w.id === wf.id)?.steps ?? [] }; }

    return [
      http.get(`${V1}/workflows`, async () => {
        await lat();
        return HttpResponse.json({ items: workflows });
      }),

      http.get(`${V1}/workflows/:id`, async ({ params }) => {
        await lat();
        const wf = workflows.find((w) => w.id === String(params["id"]));
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(wf);
      }),

      http.post(`${V1}/workflows`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { name: string; description?: string; outletId?: string | null };
        const wf: WF = {
          id: `wf_${++wfSeq}`, tenantId: "t1", name: b.name,
          description: b.description ?? null, outletId: b.outletId ?? null,
          enabled: false, steps: [],
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        workflows.push(wf);
        return HttpResponse.json(wf, { status: 201 });
      }),

      http.patch(`${V1}/workflows/:id`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Partial<{ name: string; description: string; enabled: boolean; outletId: string | null }>;
        const idx = workflows.findIndex((w) => w.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        workflows[idx] = { ...workflows[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(withSteps(workflows[idx]));
      }),

      http.delete(`${V1}/workflows/:id`, async ({ params }) => {
        await lat();
        const before = workflows.length;
        workflows = workflows.filter((w) => w.id !== String(params["id"]));
        if (workflows.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
      }),

      // Steps
      http.post(`${V1}/workflows/:workflowId/steps`, async ({ params, request }) => {
        await lat();
        const wfId = String(params["workflowId"]);
        const wf = workflows.find((w) => w.id === wfId);
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { name: string; stepType: string; triggerCondition: string; config?: Record<string, unknown>; position?: number };
        const step: Step = {
          id: `step_${++stepSeq}`, workflowId: wfId, tenantId: "t1",
          name: b.name, stepType: b.stepType, triggerCondition: b.triggerCondition,
          config: b.config ?? {},
          position: b.position ?? wf.steps.length + 1,
          enabled: true, createdAt: Date.now(), updatedAt: Date.now(),
        };
        wf.steps.push(step);
        return HttpResponse.json(step, { status: 201 });
      }),

      http.patch(`${V1}/workflows/:workflowId/steps/:stepId`, async ({ params, request }) => {
        await lat();
        const wf = workflows.find((w) => w.id === String(params["workflowId"]));
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<{ name: string; enabled: boolean; config: Record<string, unknown> }>;
        const idx = wf.steps.findIndex((s) => s.id === String(params["stepId"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        wf.steps[idx] = { ...wf.steps[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(wf.steps[idx]);
      }),

      http.delete(`${V1}/workflows/:workflowId/steps/:stepId`, async ({ params }) => {
        await lat();
        const wf = workflows.find((w) => w.id === String(params["workflowId"]));
        if (!wf) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const before = wf.steps.length;
        wf.steps = wf.steps.filter((s) => s.id !== String(params["stepId"]));
        if (wf.steps.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
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

lightspeedHandlers.push(
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
lightspeedHandlers.push(
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
lightspeedHandlers.push(
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
  http.put(`${V1}/ecommerce/products/:productId/online`, async ({ params, request }) => {
    await lat();
    const id = String(params.productId);
    const b = (await request.json()) as any;
    if (b.online) onlineProducts.set(id, { id, sku: `SKU-${id.slice(-4)}`, name: `Product ${id.slice(-4)}`, price_cents: 1500, category: "general" });
    else onlineProducts.delete(id);
    return HttpResponse.json({ productId: id, ecommerce: !!b.online });
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
        { id: "eco_1", so_number: "SO-00001", customer_id: "cust_1", customer_name: "Alice Johnson", status: "pending_approve", total_cents: 12500, store_id: "ecommerce", created_at: Date.now() - 3600000 },
        { id: "eco_2", so_number: "SO-00002", customer_id: "cust_2", customer_name: "Bob Smith", status: "confirmed", total_cents: 8750, store_id: "ecommerce", created_at: Date.now() - 7200000 },
        { id: "eco_3", so_number: "SO-00003", customer_id: "cust_3", customer_name: "Carol Davis", status: "invoiced", total_cents: 22000, store_id: "ecommerce", created_at: Date.now() - 86400000 },
      ],
    });
  }),
);

// ── Settings + global search ────────────────────────────────────────────────
let smSeq = 0, ptSeq = 0, pmSeq = 0, txSeq = 0;
lightspeedHandlers.push(
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
lightspeedHandlers.push(
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
lightspeedHandlers.push(
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

  // ── PO detail (GET /purchasing/orders/:id) ────────────────────────────────
  http.get(`${V1}/purchasing/orders/:id`, async ({ params }) => {
    await lat();
    const id = String(params.id);
    const seed: Record<string, any> = {
      po_1: { id: "po_1", tenant_id: "tnt_demo", supplier_id: "sup_acme", status: "received", receive_status: "received", total_cost_cents: 24000, created_at: Date.now() - 86400000, received_at: Date.now() - 3600000, lines: [
        { id: "pol_1a", tenant_id: "tnt_demo", po_id: "po_1", product_id: "prod_1", quantity: 24, unit_cost_cents: 600, line_cost_cents: 14400, received_qty: 24, expiry_date: null, lot_code: "LOT-001" },
        { id: "pol_1b", tenant_id: "tnt_demo", po_id: "po_1", product_id: "prod_2", quantity: 12, unit_cost_cents: 800, line_cost_cents: 9600, received_qty: 12, expiry_date: Date.now() + 90 * 86400000, lot_code: "LOT-002" },
      ]},
      po_2: { id: "po_2", tenant_id: "tnt_demo", supplier_id: "sup_tea", status: "ordered", receive_status: "pending", total_cost_cents: 11250, created_at: Date.now() - 3600000, received_at: null, lines: [
        { id: "pol_2a", tenant_id: "tnt_demo", po_id: "po_2", product_id: "prod_2", quantity: 15, unit_cost_cents: 750, line_cost_cents: 11250, received_qty: 0, expiry_date: null, lot_code: null },
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

  // ── Insights: Scheduled Reports ────────────────────────────────────────────
  ...(() => {
    let srpSeq = 0;
    let scheduledReports: Array<{
      id: string; name: string; reportType: string; frequency: string;
      recipientEmails: string[]; enabled: boolean;
      lastSentAt: number | null; nextSendAt: number; createdAt: number; updatedAt: number;
    }> = [
      {
        id: "srp_demo_1", name: "Weekly Sales Summary", reportType: "sales_summary",
        frequency: "weekly", recipientEmails: ["owner@finder-pos.dev"], enabled: true,
        lastSentAt: Date.now() - 7 * 86_400_000, nextSendAt: Date.now() + 7 * 86_400_000,
        createdAt: Date.now() - 30 * 86_400_000, updatedAt: Date.now() - 7 * 86_400_000,
      },
      {
        id: "srp_demo_2", name: "Monthly P&L Report", reportType: "p_l",
        frequency: "monthly", recipientEmails: ["owner@finder-pos.dev", "cfo@finder-pos.dev"], enabled: true,
        lastSentAt: Date.now() - 30 * 86_400_000, nextSendAt: Date.now() + 30 * 86_400_000,
        createdAt: Date.now() - 60 * 86_400_000, updatedAt: Date.now() - 30 * 86_400_000,
      },
    ];
    return [
      http.get(`${V1}/insights/scheduled-reports`, async () => {
        await lat();
        return HttpResponse.json({ items: scheduledReports });
      }),
      http.post(`${V1}/insights/scheduled-reports`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as { name: string; reportType: string; frequency: string; recipientEmails: string[] };
        const r = {
          id: `srp_${++srpSeq}`, name: b.name, reportType: b.reportType,
          frequency: b.frequency, recipientEmails: b.recipientEmails, enabled: true,
          lastSentAt: null as number | null, nextSendAt: Date.now() + 86_400_000,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        scheduledReports.push(r);
        return HttpResponse.json(r, { status: 201 });
      }),
      http.patch(`${V1}/insights/scheduled-reports/:id`, async ({ params, request }) => {
        await lat();
        const b = (await request.json()) as Partial<{ name: string; reportType: string; frequency: string; recipientEmails: string[]; enabled: boolean }>;
        const idx = scheduledReports.findIndex((x) => x.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        scheduledReports[idx] = { ...scheduledReports[idx], ...b, updatedAt: Date.now() };
        return HttpResponse.json(scheduledReports[idx]);
      }),
      http.delete(`${V1}/insights/scheduled-reports/:id`, async ({ params }) => {
        await lat();
        const before = scheduledReports.length;
        scheduledReports = scheduledReports.filter((x) => x.id !== String(params["id"]));
        if (scheduledReports.length === before) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${V1}/insights/scheduled-reports/:id/trigger`, async ({ params }) => {
        await lat();
        const r = scheduledReports.find((x) => x.id === String(params["id"]));
        if (!r) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        r.lastSentAt = Date.now();
        r.nextSendAt = Date.now() + 86_400_000;
        r.updatedAt = Date.now();
        return HttpResponse.json(r);
      }),
    ];
  })(),

  // ── Insights: Inventory Forecasting ───────────────────────────────────────
  http.get(`${V1}/insights/reorder`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { productId: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", currentStock: 6, reorderPoint: 8, reorderQuantity: 24, leadTimeDays: 5, velocityPerDay: 1.2, daysOfStock: 5, belowReorderPoint: true, supplierId: null },
      { productId: "prod_4", sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", currentStock: 0, reorderPoint: 4, reorderQuantity: 12, leadTimeDays: 7, velocityPerDay: 0.8, daysOfStock: 0, belowReorderPoint: true, supplierId: null },
      { productId: "prod_3", sku: "APP-TSHIRT-001", name: "Finder Logo T-Shirt", currentStock: 17, reorderPoint: 5, reorderQuantity: 20, leadTimeDays: 14, velocityPerDay: 1.5, daysOfStock: 11, belowReorderPoint: false, supplierId: null },
    ]});
  }),
  http.get(`${V1}/insights/order-recommendations`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { productId: "prod_1", sku: "GRO-COFFEE-001", name: "Organic Dark Roast Beans", totalUnitsSold: 186, revenueGrossCents: 278814, rank: 1, belowReorderPoint: false },
      { productId: "prod_2", sku: "GRO-HONEY-001", name: "Wildflower Honey", totalUnitsSold: 102, revenueGrossCents: 91698, rank: 2, belowReorderPoint: true },
      { productId: "prod_3", sku: "APP-TSHIRT-001", name: "Finder Logo T-Shirt", totalUnitsSold: 87, revenueGrossCents: 191400, rank: 3, belowReorderPoint: false },
      { productId: "prod_4", sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", totalUnitsSold: 64, revenueGrossCents: 76800, rank: 4, belowReorderPoint: true },
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

lightspeedHandlers.push(
  // ── Integration providers ──────────────────────────────────────────────────
  http.get(`${V1}/sync/integration-providers`, async () => {
    await lat();
    return HttpResponse.json({ items: [
      { id: "prov_shopify", name: "Shopify", provider_type: "ecommerce", is_active: true },
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
customerAddresses.set("cus_demo_1", [
  { id: "addr_1", address_type: "billing", address_line1: "123 Main St", city: "Houston", state: "TX", zip: "77001", country: "US", is_default: true },
]);
customerContacts.set("cus_demo_1", []);
customerNotes.set("cus_demo_1", []);

let invLocSeq = 2;
const inventoryLocations: any[] = [
  { id: "invloc_1", code: "MAIN-FLR", name: "Main Floor", location_type: "floor", outlet_id: "otl_main", is_sellable: true, is_receiving_location: false, is_active: true },
  { id: "invloc_2", code: "BACK-WH", name: "Back Warehouse", location_type: "warehouse", outlet_id: "otl_main", is_sellable: false, is_receiving_location: true, is_active: true },
];

lightspeedHandlers.push(
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
    const contact = { id: `con_${Math.random().toString(36).slice(2, 10)}`, ...b };
    const list = customerContacts.get(String(params.id)) ?? [];
    list.push(contact);
    customerContacts.set(String(params.id), list);
    return HttpResponse.json(contact, { status: 201 });
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

  // ── Loyalty Programme ─────────────────────────────────────────────────────
  ...(() => {
    const LY_BASE = Date.now();

    // ---- Tiers ----
    interface TierRecord {
      id: string; name: string; level: string;
      points_required: number; discount_pct: number;
      description: string | null; member_count: number;
      created_at: number; updated_at: number;
    }
    let tierSeq = 4;
    let tiers: TierRecord[] = [
      { id: "tier_1", name: "Bronze",   level: "bronze",   points_required: 0,    discount_pct: 0,  description: "Entry level for all new members.",       member_count: 142, created_at: LY_BASE - 86400000 * 90, updated_at: LY_BASE - 86400000 * 90 },
      { id: "tier_2", name: "Silver",   level: "silver",   points_required: 500,  discount_pct: 3,  description: "3% discount on every purchase.",          member_count: 67,  created_at: LY_BASE - 86400000 * 90, updated_at: LY_BASE - 86400000 * 90 },
      { id: "tier_3", name: "Gold",     level: "gold",     points_required: 1500, discount_pct: 7,  description: "7% discount plus priority support.",      member_count: 28,  created_at: LY_BASE - 86400000 * 90, updated_at: LY_BASE - 86400000 * 90 },
      { id: "tier_4", name: "Platinum", level: "platinum", points_required: 5000, discount_pct: 12, description: "12% discount and exclusive early access.", member_count: 9,   created_at: LY_BASE - 86400000 * 90, updated_at: LY_BASE - 86400000 * 90 },
    ];

    // ---- Members ----
    interface MemberRecord {
      id: string; customer_id: string; customer_name: string; customer_email: string | null;
      tier_id: string; tier_name: string; tier_level: string;
      points_balance: number; points_lifetime: number;
      joined_at: number; last_activity_at: number | null;
    }
    const members: MemberRecord[] = [
      { id: "lm_1",  customer_id: "cust_001", customer_name: "Alice Johnson",   customer_email: "alice@example.com",   tier_id: "tier_3", tier_name: "Gold",     tier_level: "gold",     points_balance: 320,  points_lifetime: 2140, joined_at: LY_BASE - 86400000 * 180, last_activity_at: LY_BASE - 86400000 * 2  },
      { id: "lm_2",  customer_id: "cust_002", customer_name: "Bob Martinez",    customer_email: "bob@example.com",     tier_id: "tier_2", tier_name: "Silver",   tier_level: "silver",   points_balance: 88,   points_lifetime: 620,  joined_at: LY_BASE - 86400000 * 120, last_activity_at: LY_BASE - 86400000 * 5  },
      { id: "lm_3",  customer_id: "cust_003", customer_name: "Carol White",     customer_email: null,                  tier_id: "tier_4", tier_name: "Platinum", tier_level: "platinum", points_balance: 1200, points_lifetime: 7800, joined_at: LY_BASE - 86400000 * 365, last_activity_at: LY_BASE - 86400000 * 1  },
      { id: "lm_4",  customer_id: "cust_004", customer_name: "David Kim",       customer_email: "david@example.com",   tier_id: "tier_1", tier_name: "Bronze",   tier_level: "bronze",   points_balance: 45,   points_lifetime: 45,   joined_at: LY_BASE - 86400000 * 14,  last_activity_at: LY_BASE - 86400000 * 3  },
      { id: "lm_5",  customer_id: "cust_005", customer_name: "Emma Davis",      customer_email: "emma@example.com",    tier_id: "tier_2", tier_name: "Silver",   tier_level: "silver",   points_balance: 210,  points_lifetime: 890,  joined_at: LY_BASE - 86400000 * 200, last_activity_at: LY_BASE - 86400000 * 8  },
      { id: "lm_6",  customer_id: "cust_006", customer_name: "Frank Brown",     customer_email: "frank@example.com",   tier_id: "tier_1", tier_name: "Bronze",   tier_level: "bronze",   points_balance: 170,  points_lifetime: 420,  joined_at: LY_BASE - 86400000 * 60,  last_activity_at: LY_BASE - 86400000 * 12 },
      { id: "lm_7",  customer_id: "cust_007", customer_name: "Grace Lee",       customer_email: "grace@example.com",   tier_id: "tier_3", tier_name: "Gold",     tier_level: "gold",     points_balance: 55,   points_lifetime: 1650, joined_at: LY_BASE - 86400000 * 270, last_activity_at: LY_BASE - 86400000 * 4  },
      { id: "lm_8",  customer_id: "cust_008", customer_name: "Henry Wilson",    customer_email: null,                  tier_id: "tier_1", tier_name: "Bronze",   tier_level: "bronze",   points_balance: 30,   points_lifetime: 30,   joined_at: LY_BASE - 86400000 * 7,   last_activity_at: LY_BASE - 86400000 * 7  },
    ];

    // ---- Rewards ----
    interface RewardRecord {
      id: string; name: string; description: string | null;
      points_cost: number; discount_cents: number;
      status: string; redemption_count: number;
      created_at: number; updated_at: number;
    }
    let rewardSeq = 5;
    let rewards: RewardRecord[] = [
      { id: "rwd_1", name: "$5 Off Next Purchase",   description: "Redeem for $5 off any order over $20.",       points_cost: 100,  discount_cents: 500,  status: "active",   redemption_count: 312, created_at: LY_BASE - 86400000 * 60, updated_at: LY_BASE - 86400000 * 60 },
      { id: "rwd_2", name: "$10 Off Next Purchase",  description: "Redeem for $10 off any order over $40.",      points_cost: 200,  discount_cents: 1000, status: "active",   redemption_count: 148, created_at: LY_BASE - 86400000 * 60, updated_at: LY_BASE - 86400000 * 60 },
      { id: "rwd_3", name: "Free Beverage",          description: "One complimentary beverage of your choice.",  points_cost: 150,  discount_cents: 350,  status: "active",   redemption_count: 94,  created_at: LY_BASE - 86400000 * 45, updated_at: LY_BASE - 86400000 * 45 },
      { id: "rwd_4", name: "Double Points Weekend",  description: "Earn 2× points on all purchases this weekend.", points_cost: 50, discount_cents: 0,    status: "inactive", redemption_count: 23,  created_at: LY_BASE - 86400000 * 30, updated_at: LY_BASE - 86400000 * 15 },
      { id: "rwd_5", name: "$25 Off (Gold+ only)",   description: "Exclusive $25 reward for Gold and Platinum members.", points_cost: 400, discount_cents: 2500, status: "active", redemption_count: 41, created_at: LY_BASE - 86400000 * 20, updated_at: LY_BASE - 86400000 * 20 },
    ];

    return [
      // ── TIERS ─────────────────────────────────────────────────────────────
      http.get(`${V1}/loyalty/tiers`, async () => {
        await lat();
        return HttpResponse.json({ items: [...tiers].sort((a, b) => a.points_required - b.points_required) });
      }),

      http.post(`${V1}/loyalty/tiers`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<TierRecord>;
        const now = Date.now();
        const tier: TierRecord = {
          id: `tier_${++tierSeq}`,
          name: b.name ?? "New Tier",
          level: b.level ?? "bronze",
          points_required: b.points_required ?? 0,
          discount_pct: b.discount_pct ?? 0,
          description: b.description ?? null,
          member_count: 0,
          created_at: now, updated_at: now,
        };
        tiers.push(tier);
        return HttpResponse.json(tier, { status: 201 });
      }),

      http.patch(`${V1}/loyalty/tiers/:id`, async ({ request, params }) => {
        await lat();
        const idx = tiers.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<TierRecord>;
        tiers[idx] = { ...tiers[idx], ...b, updated_at: Date.now() };
        return HttpResponse.json(tiers[idx]);
      }),

      http.delete(`${V1}/loyalty/tiers/:id`, async ({ params }) => {
        await lat();
        const idx = tiers.findIndex(t => t.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        if (tiers[idx].member_count > 0) {
          return HttpResponse.json({ error: { code: "has_members", message: "Cannot delete a tier with active members. Move them to another tier first." } }, { status: 422 });
        }
        tiers.splice(idx, 1);
        return new HttpResponse(null, { status: 204 });
      }),

      // ── MEMBERS ───────────────────────────────────────────────────────────
      http.get(`${V1}/loyalty/members`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const q       = url.searchParams.get("q");
        const tierId  = url.searchParams.get("tier_id");
        const limit   = Number(url.searchParams.get("limit")  ?? 50);
        const offset  = Number(url.searchParams.get("offset") ?? 0);

        let filtered = members;
        if (q)      filtered = filtered.filter(m => m.customer_name.toLowerCase().includes(q.toLowerCase()) || (m.customer_email ?? "").toLowerCase().includes(q.toLowerCase()));
        if (tierId) filtered = filtered.filter(m => m.tier_id === tierId);

        const total = filtered.length;
        const page  = filtered.slice(offset, offset + limit);
        return HttpResponse.json({ items: page, total });
      }),

      http.get(`${V1}/loyalty/members/:id`, async ({ params }) => {
        await lat();
        const member = members.find(m => m.id === String(params["id"]));
        if (!member) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        return HttpResponse.json(member);
      }),

      // Adjust points manually (manager action)
      http.post(`${V1}/loyalty/members/:id/adjust`, async ({ request, params }) => {
        await lat();
        const idx = members.findIndex(m => m.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as { delta: number; reason?: string };
        const member = members[idx];
        const newBalance  = Math.max(0, member.points_balance + b.delta);
        const newLifetime = b.delta > 0 ? member.points_lifetime + b.delta : member.points_lifetime;
        members[idx] = { ...member, points_balance: newBalance, points_lifetime: newLifetime, last_activity_at: Date.now() };
        return HttpResponse.json(members[idx]);
      }),

      // ── REWARDS ───────────────────────────────────────────────────────────
      http.get(`${V1}/loyalty/rewards`, async ({ request }) => {
        await lat();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        let filtered = rewards;
        if (status && status !== "all") filtered = filtered.filter(r => r.status === status);
        return HttpResponse.json({ items: [...filtered].sort((a, b) => a.points_cost - b.points_cost) });
      }),

      http.post(`${V1}/loyalty/rewards`, async ({ request }) => {
        await lat();
        const b = (await request.json()) as Partial<RewardRecord>;
        const now = Date.now();
        const reward: RewardRecord = {
          id: `rwd_${++rewardSeq}`,
          name: b.name ?? "New Reward",
          description: b.description ?? null,
          points_cost: b.points_cost ?? 100,
          discount_cents: b.discount_cents ?? 0,
          status: "active",
          redemption_count: 0,
          created_at: now, updated_at: now,
        };
        rewards.push(reward);
        return HttpResponse.json(reward, { status: 201 });
      }),

      http.patch(`${V1}/loyalty/rewards/:id`, async ({ request, params }) => {
        await lat();
        const idx = rewards.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        const b = (await request.json()) as Partial<RewardRecord>;
        rewards[idx] = { ...rewards[idx], ...b, updated_at: Date.now() };
        return HttpResponse.json(rewards[idx]);
      }),

      http.delete(`${V1}/loyalty/rewards/:id`, async ({ params }) => {
        await lat();
        const idx = rewards.findIndex(r => r.id === String(params["id"]));
        if (idx === -1) return HttpResponse.json({ error: { code: "not_found" } }, { status: 404 });
        rewards[idx] = { ...rewards[idx], status: "archived", updated_at: Date.now() };
        return new HttpResponse(null, { status: 204 });
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
      { id: "notif_7", type: "sync_error", severity: "critical", title: "Sync error: Shopify", body: "Product sync failed with HTTP 503. Retry scheduled.", resource_id: null, resource_type: null, read: false, created_at: BASE - 300000 },
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
        let filtered = [...events];
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
      lines: Array<{ id: string; orderId: string; productId: string; name: string; quantity: number; unitCents: number; taxCents: number; lineCents: number; taxable: boolean }>;
      createdAt: number; updatedAt: number;
    }

    const termOrders = new Map<string, TermOrder>();

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
);
