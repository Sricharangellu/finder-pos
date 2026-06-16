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
  http.get(`${V1}/team`, async () => {
    await lat();
    return HttpResponse.json({
      items: [
        { id: "usr_demo_owner", email: "owner@finder-pos.dev", role: "owner", created_at: Date.now() },
        { id: "usr_demo_cashier", email: "cashier@finder-pos.dev", role: "cashier", created_at: Date.now() },
      ],
    });
  }),

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
);
