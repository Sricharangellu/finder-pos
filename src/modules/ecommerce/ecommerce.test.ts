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

async function mkProduct(app: App, sku: string, priceCents: number, category = "general") {
  const prod = (await call(app, "POST", "/api/catalog/", { sku, name: `EC ${sku}`, price_cents: priceCents, category })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 100 });
  return prod as { id: string; name: string };
}

async function mkCustomer(app: App, name = "Online Shopper") {
  const r = await call(app, "POST", "/api/customers/", { name });
  assert.equal(r.status, 201);
  return r.json as { id: string };
}

// ─── Online Catalog ───────────────────────────────────────────────────────────

test("set product online and fetch catalog", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "EC-A1", 2999);

  // Product is offline by default
  const before = await call(app, "GET", "/api/ecommerce/catalog");
  assert.equal(before.status, 200);
  const beforeCount = before.json.items.length;

  // Mark online
  const toggled = await call(app, "PUT", `/api/ecommerce/products/${prod.id}/online`, { online: true });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.json.ecommerce, true);
  assert.equal(toggled.json.productId, prod.id);

  const after = await call(app, "GET", "/api/ecommerce/catalog");
  assert.equal(after.status, 200);
  assert.equal(after.json.items.length, beforeCount + 1);
  assert.ok(after.json.items.some((i: { id: string }) => i.id === prod.id));
});

test("catalog search filters by query string", async () => {
  const app = await freshApp();
  const prodA = await mkProduct(app, "SRCH-A", 1000);
  const prodB = await mkProduct(app, "SRCH-B", 2000);

  // Mark both online
  await call(app, "PUT", `/api/ecommerce/products/${prodA.id}/online`, { online: true });
  await call(app, "PUT", `/api/ecommerce/products/${prodB.id}/online`, { online: true });

  const r = await call(app, "GET", `/api/ecommerce/catalog?q=SRCH-A`);
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((i: { id: string }) => i.id === prodA.id));
  // SRCH-B should not appear
  assert.ok(!r.json.items.some((i: { id: string }) => i.id === prodB.id));
});

test("set product offline removes it from catalog", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "OFF-1", 500);
  await call(app, "PUT", `/api/ecommerce/products/${prod.id}/online`, { online: true });

  // Verify it's in the catalog
  const on = await call(app, "GET", "/api/ecommerce/catalog");
  assert.ok(on.json.items.some((i: { id: string }) => i.id === prod.id));

  // Take offline
  await call(app, "PUT", `/api/ecommerce/products/${prod.id}/online`, { online: false });
  const off = await call(app, "GET", "/api/ecommerce/catalog");
  assert.ok(!off.json.items.some((i: { id: string }) => i.id === prod.id));
});

// ─── Checkout ─────────────────────────────────────────────────────────────────

test("online checkout creates a sales order", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "CHK-1", 4999);
  const customer = await mkCustomer(app);

  const r = await call(app, "POST", "/api/ecommerce/checkout", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 2 }],
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("sso_"));
  assert.match(r.json.so_number, /^SO-/);
  assert.equal(r.json.status, "pending_approve");
  assert.equal(r.json.store_id, "ecommerce");
  assert.equal(r.json.total_cents, 9998); // 2 × 4999
});

test("checkout requires at least one line", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);
  const r = await call(app, "POST", "/api/ecommerce/checkout", { customerId: customer.id, lines: [] });
  assert.equal(r.status, 400);
});

// ─── Admin Orders View ────────────────────────────────────────────────────────

test("orders list shows only ecommerce store orders", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "ORD-1", 1000);
  const customer = await mkCustomer(app);

  // Create an ecommerce order
  const ecOrder = (await call(app, "POST", "/api/ecommerce/checkout", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 1 }],
  })).json;

  // Create a regular POS order (should NOT appear in ecommerce orders)
  await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 1 }],
  });

  const r = await call(app, "GET", "/api/ecommerce/orders");
  assert.equal(r.status, 200);
  assert.ok(r.json.items.some((o: { id: string }) => o.id === ecOrder.id));
  // All items must have store_id = ecommerce
  assert.ok(r.json.items.every((o: { store_id: string }) => o.store_id === "ecommerce"));
});

// ─── Customer Portal ──────────────────────────────────────────────────────────

test("customer portal returns their orders and invoices", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "PRT-1", 2000);
  const customer = await mkCustomer(app, "Portal User");

  // Place an ecommerce order
  await call(app, "POST", "/api/ecommerce/checkout", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 1 }],
  });

  const r = await call(app, "GET", `/api/ecommerce/portal/${customer.id}/orders`);
  assert.equal(r.status, 200);
  assert.equal(r.json.customer.id, customer.id);
  assert.ok(Array.isArray(r.json.salesOrders) && r.json.salesOrders.length > 0);
  assert.ok(Array.isArray(r.json.invoices));
});

test("portal returns 404 for unknown customer", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/ecommerce/portal/cus_nonexistent/orders");
  assert.equal(r.status, 404);
});
