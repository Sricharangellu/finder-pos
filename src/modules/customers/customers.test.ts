import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

test("create + fetch + list customers (tenant-scoped)", async () => {
  const app = await freshApp();
  const c = await call(app, "POST", "/api/customers/", { name: "Ada Lovelace", email: "ada@example.com" });
  assert.equal(c.status, 201);
  assert.ok(c.json.id.startsWith("cus_"));
  assert.equal(c.json.points, 0);
  assert.equal(c.json.tenant_id, "tnt_demo");

  const got = await call(app, "GET", `/api/customers/${c.json.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.email, "ada@example.com");

  const list = await call(app, "GET", "/api/customers/");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.length >= 1);
});

test("loyalty: points are awarded on payment.captured for the order's customer", async () => {
  const app = await freshApp();
  const c = await call(app, "POST", "/api/customers/", { name: "Grace Hopper" });
  const cusId = c.json.id;

  const p = await call(app, "POST", "/api/catalog/", { sku: "LOY-1", name: "Loyalty Widget", price_cents: 1000, category: "general" });
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 10 });

  // Order linked to the customer: 2 @ $10, CA tax 8.25% => total 2165.
  const o = await call(app, "POST", "/api/orders/", {
    stateCode: "CA", customerId: cusId, lines: [{ productId: p.json.id, quantity: 2 }],
  });
  assert.equal(o.status, 201);
  const total = o.json.total_cents;

  // Pay in full -> payment.captured -> loyalty awards floor(total/100) points.
  const pay = await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "cash", tenderedCents: total });
  assert.equal(pay.status, 201);

  const after = await call(app, "GET", `/api/customers/${cusId}`);
  assert.equal(after.json.points, Math.floor(total / 100), "points = $1 per dollar of order total");
});

test("redeem: 100 points -> $5, validates balance and multiples", async () => {
  const app = await freshApp();
  const c = await call(app, "POST", "/api/customers/", { name: "Redeemer" });
  const id = c.json.id;

  // No points yet -> insufficient.
  let r = await call(app, "POST", `/api/customers/${id}/redeem`, { points: 100 });
  assert.equal(r.status, 400);

  // Earn 250 points via an order/payment of $250+.
  const p = await call(app, "POST", "/api/catalog/", { sku: "RDM-1", name: "Big Item", price_cents: 25000, category: "general" });
  await call(app, "POST", `/api/inventory/${p.json.id}/receive`, { quantity: 5 });
  const o = await call(app, "POST", "/api/orders/", { stateCode: "TX", customerId: id, lines: [{ productId: p.json.id, quantity: 1 }] });
  await call(app, "POST", "/api/payments/", { orderId: o.json.id, method: "card", cardCents: o.json.total_cents });
  const bal = (await call(app, "GET", `/api/customers/${id}`)).json.points;
  assert.ok(bal >= 250, "earned points");

  // Non-multiple rejected.
  r = await call(app, "POST", `/api/customers/${id}/redeem`, { points: 150 });
  assert.equal(r.status, 400);

  // Redeem 200 -> $10, balance decremented.
  r = await call(app, "POST", `/api/customers/${id}/redeem`, { points: 200 });
  assert.equal(r.status, 200);
  assert.equal(r.json.valueCents, 1000);
  assert.equal(r.json.pointsRemaining, bal - 200);
});
