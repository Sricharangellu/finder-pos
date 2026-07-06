import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

test("sales summary aggregates orders, revenue, and captured payments for the tenant", async () => {
  const app = await freshApp();

  let r = await call(app, "GET", "/api/reports/summary");
  assert.equal(r.status, 200);
  assert.equal(r.json.orders.total, 0);
  assert.equal(r.json.revenue.grossCents, 0);
  assert.equal(r.json.payments.capturedCount, 0);

  const p = await call(app, "POST", "/api/catalog/", {
    sku: "RPT-001", name: "Report Widget", price_cents: 1000, category: "general",
  });
  assert.equal(p.status, 201);
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 10 });

  // 2 units @ $10 = $20 subtotal, CA tax 8.25% = $1.65, total $21.65.
  const o = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: p.json.id, quantity: 2 }],
  });
  assert.equal(o.status, 201);
  assert.equal(o.json.total_cents, 2165);

  // Full cash payment -> order completes, payment captured.
  const pay = await call(app, "POST", "/api/payments/", {
    orderId: o.json.id, method: "cash", tenderedCents: 2165,
  });
  assert.equal(pay.status, 201);

  r = await call(app, "GET", "/api/reports/summary");
  assert.equal(r.status, 200);
  assert.equal(r.json.orders.completed, 1, "one completed order");
  assert.equal(r.json.orders.total, 1);
  assert.equal(r.json.revenue.grossCents, 2165, "gross = completed order total");
  assert.equal(r.json.revenue.taxCents, 165, "tax recognised");
  assert.equal(r.json.revenue.netCents, 2000, "net = gross - tax");
  assert.equal(r.json.payments.capturedCount, 1);
  assert.equal(r.json.payments.capturedCents, 2165);
  assert.equal(r.json.payments.byMethod.cash, 2165);
});

test("reports reflect only the caller's tenant data", async () => {
  const app = await freshApp();
  const p = await call(app, "POST", "/api/catalog/", {
    sku: "RPT-ISO", name: "Iso Widget", price_cents: 500, category: "general",
  });
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 5 });
  const o = await call(app, "POST", "/api/orders/", {
    stateCode: "TX", lines: [{ productId: p.json.id, quantity: 1 }],
  });
  await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: o.json.total_cents });

  const r = await call(app, "GET", "/api/reports/summary");
  assert.equal(r.json.orders.total, 1);
  assert.equal(r.json.payments.capturedCount, 1);
});

test("end-of-day report: transactions, sales, tenders, top items, cash drawer", async () => {
  const app = await freshApp();

  // Register with an open session so the drawer section has a float.
  const outlet = (await call(app, "POST", "/api/outlets/", { name: "EOD Store" })).json;
  const reg = (await call(app, "POST", `/api/outlets/${outlet.id}/registers`, { name: "Till Z" })).json;
  const opened = await call(app, "POST", `/api/outlets/registers/${reg.id}/open`, { openingFloatCents: 20000 });
  assert.equal(opened.status, 201);

  // Catalog + stock.
  const p = await call(app, "POST", "/api/catalog/", {
    sku: "EOD-001", name: "Z Widget", price_cents: 1000, category: "general",
  });
  assert.equal(p.status, 201);
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 10 });

  // Sale 1: 2 units, CA tax, paid cash with change (tendered over total).
  const o1 = (await call(app, "POST", "/api/orders/", {
    stateCode: "CA", lines: [{ productId: p.json.id, quantity: 2 }],
  })).json;
  const pay1 = await call(app, "POST", "/api/payments/", {
    orderId: o1.id, method: "cash", tenderedCents: 3000,
  });
  assert.equal(pay1.status, 201);

  // Sale 2: 1 unit paid cash exactly, then refunded — refund must subtract
  // from net sales and cash refunds must reduce expected drawer cash.
  const o2 = (await call(app, "POST", "/api/orders/", {
    stateCode: "CA", lines: [{ productId: p.json.id, quantity: 1 }],
  })).json;
  await call(app, "POST", "/api/payments/", { orderId: o2.id, method: "cash", tenderedCents: o2.total_cents });
  const refunded = await call(app, "POST", `/api/orders/${o2.id}/refund`);
  assert.equal(refunded.status, 200);

  const r = await call(app, "GET", "/api/reports/end-of-day");
  assert.equal(r.status, 200);
  const eod = r.json;

  // Session state.
  assert.equal(eod.status, "open");
  assert.equal(eod.closedAt, null);

  // Transactions: 2 sold (1 completed + 1 refunded), no voids.
  assert.equal(eod.transactions.count, 2);
  assert.equal(eod.transactions.refundCount, 1);
  assert.equal(eod.transactions.voidCount, 0);

  // Sales: gross = subtotals (2+1 units @ $10 = $30.00); refund subtracts o2 total.
  assert.equal(eod.sales.grossSales_cents, 3000);
  assert.equal(eod.sales.refunds_cents, o2.total_cents);
  assert.equal(eod.sales.netSales_cents, 3000 - o2.total_cents);
  assert.equal(eod.sales.totalCollected_cents, eod.sales.netSales_cents + eod.sales.taxCollected_cents);

  // Tenders: two cash payments; cash total is net of change given on sale 1.
  const cash = eod.tenders.find((t: { method: string }) => t.method === "Cash");
  assert.equal(cash.count, 2);
  assert.equal(cash.total_cents, o1.total_cents + o2.total_cents);

  // Top items: our single product with 3 units.
  assert.equal(eod.topItems.length, 1);
  assert.equal(eod.topItems[0].quantitySold, 3);

  // Drawer while open: expected = float + cash sales − cash refunds; no variance yet.
  assert.equal(eod.cashDrawer.openingFloat_cents, 20000);
  assert.equal(eod.cashDrawer.cashRefunds_cents, o2.total_cents);
  assert.equal(eod.cashDrawer.expectedCash_cents, 20000 + o1.total_cents);
  assert.equal(eod.cashDrawer.actualCash_cents, null);
  assert.equal(eod.cashDrawer.variance_cents, null);

  // Close the register counting a $5.00 overage — variance must surface it.
  const counted = 20000 + o1.total_cents + 500;
  const closed = await call(app, "POST", `/api/outlets/registers/${reg.id}/close`, { countedCashCents: counted });
  assert.equal(closed.status, 200);

  const r2 = await call(app, "GET", "/api/reports/end-of-day");
  assert.equal(r2.json.status, "closed");
  assert.equal(r2.json.cashDrawer.actualCash_cents, counted);
  assert.equal(r2.json.cashDrawer.variance_cents, 500);

  // Bad date is a 400, not a crash.
  const bad = await call(app, "GET", "/api/reports/end-of-day?date=not-a-date");
  assert.equal(bad.status, 400);
});

test("retail-proof: seeded demo tenant (products, no stock/sales) is not ready", async () => {
  const app = await freshApp();

  const r = await call(app, "GET", "/api/reports/retail-proof");
  assert.equal(r.status, 200);
  assert.equal(r.json.ready, false, "no sales yet -> not ready");
  // Demo tenant boots with products + a default outlet/register, but no stock,
  // no tax rate, no payment modes, no receipt, no orders.
  assert.equal(r.json.setup.outlet, true);
  assert.equal(r.json.setup.register, true);
  assert.equal(r.json.setup.firstProduct, true, "demo products seeded");
  assert.equal(r.json.setup.firstReceiving, false, "no stock received yet");
  assert.equal(r.json.setup.taxRate, false);
  assert.ok(r.json.metrics.productCount >= 4, "seeded products counted");
  assert.equal(r.json.metrics.orderCount, 0);
  const codes = r.json.signals.map((s: { code: string }) => s.code);
  assert.ok(codes.includes("setup_incomplete"), "flags remaining setup");
  assert.ok(codes.includes("no_sales_yet"), "flags no sales");
  assert.ok(!codes.includes("no_products"), "products exist -> no no_products signal");
  assert.equal(r.json.expenses.available, true, "expenses module is live");
  assert.equal(r.json.expenses.totalCents, 0, "seeded demo tenant has no expenses");
});

test("retail-proof: reflects receiving, cost gap, and a real sale", async () => {
  const app = await freshApp();

  // A brand-new product with stock but NO cost price.
  const p = await call(app, "POST", "/api/catalog/", {
    sku: "RP-PROOF", name: "Proof Widget", price_cents: 1000, category: "general",
  });
  assert.equal(p.status, 201);
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 5 });

  let r = await call(app, "GET", "/api/reports/retail-proof");
  assert.equal(r.json.setup.firstReceiving, true, "stock received");
  assert.ok(r.json.metrics.totalStockUnits >= 5);
  assert.ok(r.json.metrics.productsWithoutCost >= 1, "new product has no cost");
  let codes = r.json.signals.map((s: { code: string }) => s.code);
  assert.ok(codes.includes("products_without_cost"));
  assert.ok(codes.includes("no_sales_yet"), "still no completed sale");

  // Sell 2 units for cash -> completed order + revenue.
  const o = await call(app, "POST", "/api/orders/", {
    stateCode: "CA", lines: [{ productId: p.json.id, quantity: 2 }],
  });
  assert.equal(o.status, 201);
  await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: o.json.total_cents });

  r = await call(app, "GET", "/api/reports/retail-proof");
  assert.equal(r.json.metrics.orderCount, 1, "one completed sale");
  assert.equal(r.json.metrics.revenueCents, o.json.total_cents);
  codes = r.json.signals.map((s: { code: string }) => s.code);
  assert.ok(!codes.includes("no_sales_yet"), "sale recorded -> no_sales_yet cleared");
});

test("retail-proof: profit visibility — expenses reduce net profit and raise signals", async () => {
  const app = await freshApp();

  // Product with stock, sold for cash → revenue, gross profit (no cost → COGS 0).
  const p = await call(app, "POST", "/api/catalog/", {
    sku: "RP-PROFIT", name: "Profit Widget", price_cents: 1000, category: "general",
  });
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 5 });
  const o = await call(app, "POST", "/api/orders/", {
    stateCode: "CA", lines: [{ productId: p.json.id, quantity: 1 }],
  });
  assert.equal(o.status, 201, "order created");
  const pay = await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: o.json.total_cents });
  assert.equal(pay.status, 201, "payment captured");

  let r = await call(app, "GET", "/api/reports/retail-proof");
  const gross = r.json.metrics.grossProfitCents;
  assert.ok(gross > 0, "gross profit from the sale");
  assert.equal(r.json.expenses.available, true, "expenses module is live");
  assert.equal(r.json.expenses.totalCents, 0, "no expenses yet");
  assert.equal(r.json.metrics.netProfitCents, gross, "net == gross with no expenses");

  // Record an expense LARGER than gross profit → negative net + signals.
  const bigExpense = gross + 5000;
  const e = await call(app, "POST", "/api/expenses/", { amountCents: bigExpense }); // uncategorized
  assert.equal(e.status, 201);

  r = await call(app, "GET", "/api/reports/retail-proof");
  assert.equal(r.json.expenses.totalCents, bigExpense, "expense total reflected");
  assert.equal(r.json.expenses.uncategorizedCount, 1);
  assert.equal(r.json.metrics.expensesCents, bigExpense);
  assert.equal(r.json.metrics.netProfitCents, gross - bigExpense, "net = gross - expenses");
  assert.ok(r.json.metrics.netProfitCents < 0, "net profit is negative");
  assert.ok(typeof r.json.metrics.netMarginPct === "number", "net margin computed");
  const codes = r.json.signals.map((s: { code: string }) => s.code);
  assert.ok(codes.includes("negative_net_profit"), "flags negative net profit");
  assert.ok(codes.includes("uncategorized_expenses"), "flags uncategorized expense");
});

// ── Deterministic recommendation engine (issue #5) ──────────────────────────
const SEV_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const CATEGORIES = ["setup", "inventory", "pricing", "sales", "expenses", "profit"];

test("recommendations: ranked, actionable, and derived only from real signals", async () => {
  const app = await freshApp();

  const rec = await call(app, "GET", "/api/reports/recommendations");
  assert.equal(rec.status, 200);
  const items: any[] = rec.json.recommendations;
  assert.ok(Array.isArray(items) && items.length > 0, "seeded tenant yields recommendations");

  // Cross-check: every signal-backed recommendation traces to a real retail-proof signal.
  const proof = await call(app, "GET", "/api/reports/retail-proof");
  const signalCodes = new Set(proof.json.signals.map((s: { code: string }) => s.code));

  for (const [i, r] of items.entries()) {
    assert.equal(r.rank, i + 1, "ranks are contiguous 1..n in array order");
    assert.ok(r.title && r.action && r.href, "each recommendation is actionable (title/action/href)");
    assert.ok(CATEGORIES.includes(r.category), `valid category: ${r.category}`);
    if (r.signalCode !== null) assert.ok(signalCodes.has(r.signalCode), `${r.signalCode} is a real signal`);
    if (i > 0) assert.ok(SEV_RANK[items[i - 1].severity] <= SEV_RANK[r.severity], "sorted by severity");
  }

  // Setup is unfinished and nothing has sold on the seeded tenant.
  const ids = items.map((r) => r.id);
  assert.ok(ids.includes("rec_setup_incomplete"), "recommends finishing setup");
  assert.ok(ids.includes("rec_no_sales_yet"), "recommends recording a first sale");
  assert.ok(!ids.includes("rec_thin_margin"), "no thin-margin rec without revenue");

  // Summary mirrors the list.
  assert.equal(rec.json.summary.total, items.length);
  assert.equal(rec.json.summary.critical, items.filter((r) => r.severity === "critical").length);
  assert.equal(rec.json.summary.warning, items.filter((r) => r.severity === "warning").length);
  assert.equal(rec.json.summary.info, items.filter((r) => r.severity === "info").length);
});

test("recommendations: negative net profit is critical, ranks first, and suppresses thin-margin", async () => {
  const app = await freshApp();

  // Stocked product (no cost → COGS 0), one cash sale, then an outsized expense.
  const p = await call(app, "POST", "/api/catalog/", { sku: "REC-NEG", name: "Neg Widget", price_cents: 1000, category: "general" });
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 5 });
  const o = await call(app, "POST", "/api/orders/", { stateCode: "CA", lines: [{ productId: p.json.id, quantity: 1 }] });
  await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: o.json.total_cents });
  const e = await call(app, "POST", "/api/expenses/", { amountCents: o.json.total_cents + 5000 });
  assert.equal(e.status, 201);

  const rec = await call(app, "GET", "/api/reports/recommendations");
  const items: any[] = rec.json.recommendations;
  const neg = items.find((r) => r.id === "rec_negative_net_profit");
  assert.ok(neg, "negative net profit recommended");
  assert.equal(neg.severity, "critical");
  assert.equal(neg.category, "profit");
  assert.equal(items[0].id, "rec_negative_net_profit", "critical outranks all warnings/infos");
  assert.ok(!items.some((r) => r.id === "rec_thin_margin"), "thin-margin suppressed while net is negative");
});

test("recommendations: raises a thin-margin pricing rec when gross margin is low but net is positive", async () => {
  const app = await freshApp();

  // Real cost via the purchasing receive flow: cost 490 on a $5.00 product → thin margin.
  const p = await call(app, "POST", "/api/catalog/", { sku: "REC-THIN", name: "Thin Widget", price_cents: 500, category: "general" });
  const s = await call(app, "POST", "/api/purchasing/suppliers", { name: "Cost Co", email: "orders@costco.test" });
  const po = await call(app, "POST", "/api/purchasing/orders", {
    supplierId: s.json.id, lines: [{ productId: p.json.id, quantity: 10, unitCostCents: 490 }],
  });
  const recv = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/receive`, {
    lines: [{ lineId: po.json.lines[0].id, qty: 10 }],
  });
  assert.equal(recv.status, 200, `receive failed: ${JSON.stringify(recv.json)}`);
  const o = await call(app, "POST", "/api/orders/", { stateCode: "CA", lines: [{ productId: p.json.id, quantity: 1 }] });
  await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: o.json.total_cents });

  // Sanity: real data really is thin-margin and net-positive (no expenses).
  const proof = await call(app, "GET", "/api/reports/retail-proof");
  assert.ok(proof.json.metrics.grossMarginPct !== null && proof.json.metrics.grossMarginPct <= 15, `gm should be thin: ${proof.json.metrics.grossMarginPct}`);
  assert.ok(proof.json.metrics.netProfitCents >= 0, "net is positive");

  const rec = await call(app, "GET", "/api/reports/recommendations");
  const thin = rec.json.recommendations.find((r: any) => r.id === "rec_thin_margin");
  assert.ok(thin, "thin-margin recommended");
  assert.equal(thin.category, "pricing");
  assert.equal(thin.severity, "warning");
  assert.equal(thin.signalCode, null, "derived from metrics, not a signal");
  assert.ok(!rec.json.recommendations.some((r: any) => r.id === "rec_negative_net_profit"), "not negative net profit");
});
