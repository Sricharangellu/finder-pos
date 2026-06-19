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

/** Create a product with stock, place + pay an order, return orderId & productId. */
async function mkPaidOrder(app: App) {
  const prod = (await call(app, "POST", "/api/catalog/", {
    sku: `FF-${Date.now()}`,
    name: "Fulfillable Widget",
    price_cents: 1000,
    category: "general",
  })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 50 });

  const customer = (await call(app, "POST", "/api/customers/", { name: "Pick Co" })).json;
  const order = (await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 3 }],
  })).json;
  await call(app, "POST", "/api/payments/", {
    orderId: order.id,
    method: "card",
    cardCents: order.total_cents,
  });
  return { orderId: order.id as string, productId: prod.id as string };
}

// ─── Locations ────────────────────────────────────────────────────────────────

test("create a location and list it", async () => {
  const app = await freshApp();

  const r = await call(app, "POST", "/api/fulfillment/locations", {
    code: "A-01-01",
    name: "Aisle A Shelf 1 Bin 1",
    kind: "bin",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("loc_"));
  assert.equal(r.json.code, "A-01-01");
  assert.equal(r.json.kind, "bin");

  const list = await call(app, "GET", "/api/fulfillment/locations");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((l: { id: string }) => l.id === r.json.id));
});

test("location code must be unique per tenant", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/fulfillment/locations", { code: "Z-99", kind: "zone" });
  const dupe = await call(app, "POST", "/api/fulfillment/locations", { code: "Z-99", kind: "bin" });
  assert.equal(dupe.status, 409);
});

test("assign a product to a location", async () => {
  const app = await freshApp();
  const prod = (await call(app, "POST", "/api/catalog/", {
    sku: "ASSIGN-1",
    name: "Assignable Product",
    price_cents: 500,
    category: "general",
  })).json;
  const loc = (await call(app, "POST", "/api/fulfillment/locations", { code: "BIN-01", kind: "bin" })).json;

  const r = await call(app, "POST", "/api/fulfillment/assign", {
    productId: prod.id,
    locationId: loc.id,
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

// ─── Pick Lists ───────────────────────────────────────────────────────────────

test("create a pick list from an order", async () => {
  const app = await freshApp();
  const { orderId } = await mkPaidOrder(app);

  const r = await call(app, "POST", "/api/fulfillment/pick-lists", { orderId });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("pik_"));
  assert.equal(r.json.status, "picking");
  assert.ok(Array.isArray(r.json.lines) && r.json.lines.length > 0);
  assert.equal(r.json.lines[0].quantity, 3);
  assert.equal(r.json.lines[0].picked_qty, 0);
});

test("list pick lists and get by id", async () => {
  const app = await freshApp();
  const { orderId } = await mkPaidOrder(app);
  const pkl = (await call(app, "POST", "/api/fulfillment/pick-lists", { orderId })).json;

  const list = await call(app, "GET", "/api/fulfillment/pick-lists");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((p: { id: string }) => p.id === pkl.id));

  const got = await call(app, "GET", `/api/fulfillment/pick-lists/${pkl.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.id, pkl.id);
  assert.ok(Array.isArray(got.json.lines));
});

test("pick a line, then pack the pick list", async () => {
  const app = await freshApp();
  const { orderId } = await mkPaidOrder(app);
  const pkl = (await call(app, "POST", "/api/fulfillment/pick-lists", { orderId })).json;
  const lineId = pkl.lines[0].id;

  // Pick partial quantity (1 of 3)
  const afterPick = await call(app, "POST", `/api/fulfillment/pick-lists/${pkl.id}/lines/${lineId}/pick`, { quantity: 1 });
  assert.equal(afterPick.status, 200);
  assert.equal(afterPick.json.lines[0].picked_qty, 1);
  assert.equal(afterPick.json.lines[0].status, "pending"); // not fully picked yet

  // Pick all (no qty = pick full line.quantity)
  const afterPickAll = await call(app, "POST", `/api/fulfillment/pick-lists/${pkl.id}/lines/${lineId}/pick`, {});
  assert.equal(afterPickAll.status, 200);
  assert.equal(afterPickAll.json.lines[0].picked_qty, 3);
  assert.equal(afterPickAll.json.lines[0].status, "picked");

  // Pack → pick list transitions to "packed"
  const packed = await call(app, "POST", `/api/fulfillment/pick-lists/${pkl.id}/pack`, {});
  assert.equal(packed.status, 200);
  assert.equal(packed.json.status, "packed");
});

test("pick list requires a valid order id", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/fulfillment/pick-lists", { orderId: "ord_nonexistent" });
  assert.equal(r.status, 404);
});
