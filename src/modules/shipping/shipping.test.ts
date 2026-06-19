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

/** Create a customer, product, order+payment, invoice — then return the invoice id. */
async function mkInvoice(app: App) {
  const customer = (await call(app, "POST", "/api/customers/", { name: "Ship Co" })).json;
  const prod = (await call(app, "POST", "/api/catalog/", { sku: "SHP-P1", name: "Shippable Widget", price_cents: 2000, category: "general" })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 50 });

  const order = (await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 2 }],
  })).json;
  await call(app, "POST", "/api/payments/", { orderId: order.id, method: "card", cardCents: order.total_cents });

  const inv = (await call(app, "POST", "/api/billing/invoices", {
    customerId: customer.id,
    orderId: order.id,
    totalCents: order.total_cents,
  })).json;
  assert.ok(inv.id, "invoice created");
  return { invoiceId: inv.id as string, productId: prod.id as string };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("create a shipment from an invoice", async () => {
  const app = await freshApp();
  const { invoiceId, productId } = await mkInvoice(app);

  const r = await call(app, "POST", "/api/shipping/", {
    invoiceId,
    method: "delivery",
    lines: [{ productId, quantity: 2 }],
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("shp_"));
  assert.match(r.json.ship_number, /^SHP-/);
  assert.equal(r.json.status, "pending_shipment");
  assert.equal(r.json.invoice_id, invoiceId);
  assert.equal(r.json.lines.length, 1);
  assert.equal(r.json.lines[0].quantity, 2);
  assert.equal(r.json.lines[0].packed, 0);
});

test("createFromInvoice is idempotent — returns same shipment on duplicate", async () => {
  const app = await freshApp();
  const { invoiceId, productId } = await mkInvoice(app);

  const first = (await call(app, "POST", "/api/shipping/", { invoiceId, lines: [{ productId, quantity: 2 }] })).json;
  const second = (await call(app, "POST", "/api/shipping/", { invoiceId, lines: [{ productId, quantity: 2 }] })).json;
  assert.equal(first.id, second.id, "same shipment returned");
});

test("pack a line, then ship and deliver", async () => {
  const app = await freshApp();
  const { invoiceId, productId } = await mkInvoice(app);

  const shp = (await call(app, "POST", "/api/shipping/", {
    invoiceId,
    lines: [{ productId, quantity: 2 }],
  })).json;
  const lineId = shp.lines[0].id;

  // Pack the line
  const packed = await call(app, "POST", `/api/shipping/${shp.id}/lines/${lineId}/pack`, {});
  assert.equal(packed.status, 200);
  assert.equal(packed.json.lines[0].packed, 1);

  // Ship it
  const shipped = await call(app, "POST", `/api/shipping/${shp.id}/ship`, {
    carrier: "FedEx",
    trackingNumber: "1Z999AA10123456784",
  });
  assert.equal(shipped.status, 200);
  assert.equal(shipped.json.status, "shipped");
  assert.equal(shipped.json.carrier, "FedEx");
  assert.ok(shipped.json.shipped_date != null);

  // Deliver it
  const delivered = await call(app, "POST", `/api/shipping/${shp.id}/deliver`, {});
  assert.equal(delivered.status, 200);
  assert.equal(delivered.json.status, "delivered");
  assert.ok(delivered.json.delivered_date != null);
});

test("cancel a pending shipment", async () => {
  const app = await freshApp();
  const { invoiceId, productId } = await mkInvoice(app);
  const shp = (await call(app, "POST", "/api/shipping/", { invoiceId, lines: [{ productId, quantity: 1 }] })).json;

  const cancelled = await call(app, "POST", `/api/shipping/${shp.id}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.status, "cancelled");
});

test("list shipments and get by id", async () => {
  const app = await freshApp();
  const { invoiceId, productId } = await mkInvoice(app);
  const shp = (await call(app, "POST", "/api/shipping/", { invoiceId, lines: [{ productId, quantity: 1 }] })).json;

  const list = await call(app, "GET", "/api/shipping/");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((s: { id: string }) => s.id === shp.id));

  const got = await call(app, "GET", `/api/shipping/${shp.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.id, shp.id);
});

test("shipment requires an existing invoice", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/shipping/", { invoiceId: "inv_nonexistent" });
  assert.equal(r.status, 404);
});
