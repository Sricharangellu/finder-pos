import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function mkProduct(app: App, sku: string, priceCents: number) {
  const prod = (await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 100 });
  return prod as { id: string; name: string };
}

async function mkCustomer(app: App, name = "Wholesale Corp") {
  const r = await call(app, "POST", "/api/customers/", { name });
  assert.equal(r.status, 201);
  return r.json as { id: string };
}

// ─── Quotations ───────────────────────────────────────────────────────────────

test("create a quotation with lines and list it", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "QT-A", 2500);

  const r = await call(app, "POST", "/api/sales/quotations", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 3 }],
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("qot_"));
  assert.match(r.json.quote_number, /^QT-/);
  assert.equal(r.json.status, "draft");
  assert.equal(r.json.customer_id, customer.id);
  assert.ok(Array.isArray(r.json.lines) && r.json.lines.length === 1);
  assert.equal(r.json.lines[0].quantity, 3);
  assert.equal(r.json.lines[0].line_cents, 7500); // 3 × 2500

  const list = await call(app, "GET", "/api/sales/quotations");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((q: { id: string }) => q.id === r.json.id));
});

test("quotation lifecycle: draft → sent → accepted", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "QT-B", 1000);

  const qt = (await call(app, "POST", "/api/sales/quotations", { customerId: customer.id, lines: [{ productId: prod.id, quantity: 1 }] })).json;
  assert.equal(qt.status, "draft");

  const sent = (await call(app, "POST", `/api/sales/quotations/${qt.id}/send`, {})).json;
  assert.equal(sent.status, "sent");

  const accepted = (await call(app, "POST", `/api/sales/quotations/${qt.id}/accept`, {})).json;
  assert.equal(accepted.status, "accepted");
});

test("convert accepted quotation to sales order", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "QT-C", 3000);

  const qt = (await call(app, "POST", "/api/sales/quotations", { customerId: customer.id, lines: [{ productId: prod.id, quantity: 2 }] })).json;
  await call(app, "POST", `/api/sales/quotations/${qt.id}/send`, {});
  await call(app, "POST", `/api/sales/quotations/${qt.id}/accept`, {});

  const so = await call(app, "POST", `/api/sales/quotations/${qt.id}/convert`, {});
  assert.equal(so.status, 201);
  assert.ok(so.json.id.startsWith("sso_"));
  assert.match(so.json.so_number, /^SO-/);
  assert.equal(so.json.status, "pending_approve");
  assert.equal(so.json.customer_id, customer.id);
});

// ─── Sales Orders ─────────────────────────────────────────────────────────────

test("create sales order directly and approve it", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "SO-A", 5000);

  const so = await call(app, "POST", "/api/sales/sales-orders", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 1 }],
  });
  assert.equal(so.status, 201);
  assert.equal(so.json.status, "pending_approve");

  const approved = (await call(app, "POST", `/api/sales/sales-orders/${so.json.id}/approve`, {}));
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");
});

test("sales order list and get by id", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "SO-B", 1500);

  const so = (await call(app, "POST", "/api/sales/sales-orders", { customerId: customer.id, lines: [{ productId: prod.id, quantity: 4 }] })).json;

  const list = await call(app, "GET", "/api/sales/sales-orders");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((s: { id: string }) => s.id === so.id));

  const got = await call(app, "GET", `/api/sales/sales-orders/${so.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.id, so.id);
  assert.equal(got.json.total_cents, 6000); // 4 × 1500
});

test("quotation requires at least one line", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const r = await call(app, "POST", "/api/sales/quotations", { customerId: customer.id, lines: [] });
  assert.equal(r.status, 400);
});

test("cannot convert a cancelled quotation", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const prod = await mkProduct(app, "QT-D", 500);
  const qt = (await call(app, "POST", "/api/sales/quotations", { customerId: customer.id, lines: [{ productId: prod.id, quantity: 1 }] })).json;

  // Cancel the quotation first
  const cancelled = await call(app, "POST", `/api/sales/quotations/${qt.id}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.status, "cancelled");

  // Cancelled → convert should be rejected with 409
  const r = await call(app, "POST", `/api/sales/quotations/${qt.id}/convert`, {});
  assert.equal(r.status, 409);
});
