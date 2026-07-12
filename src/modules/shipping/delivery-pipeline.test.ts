import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

/**
 * End-to-end delivery pipeline: a sales order (B2B / ecommerce) flows through
 * fulfillment (pick → pack) into shipping (ship → deliver), with fulfillment_status
 * propagating back to the sales order at every stage. This proves the seams that
 * previously left fulfillment/shipping disconnected from sales orders.
 */

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

async function mkProduct(app: App, sku: string, priceCents: number) {
  const prod = (await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 100 });
  return prod as { id: string; name: string };
}
async function mkCustomer(app: App, name = "Pipeline Corp") {
  return (await call(app, "POST", "/api/customers/", { name })).json as { id: string };
}
async function mkSalesOrder(app: App) {
  const customer = await mkCustomer(app);
  const p1 = await mkProduct(app, "PIPE-A", 2500);
  const p2 = await mkProduct(app, "PIPE-B", 1000);
  const so = (await call(app, "POST", "/api/sales/sales-orders", {
    customerId: customer.id,
    lines: [{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 3 }],
  })).json;
  return so as { id: string; fulfillment_status: string };
}

test("sales order starts unfulfilled", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  assert.equal(so.fulfillment_status, "unfulfilled");
});

test("full pipeline: sales order → pick → pack → ship → deliver propagates fulfillment_status", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);

  // 1) Pick list from the sales order → SO moves to picking.
  const plRes = await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id });
  assert.equal(plRes.status, 201);
  const pl = plRes.json as { id: string; source_type: string; lines: Array<{ id: string }> };
  assert.equal(pl.source_type, "sales_order");
  assert.equal(pl.lines.length, 2);
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "picking");

  // 2) Pick every line.
  for (const line of pl.lines) {
    await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/lines/${line.id}/pick`, {});
  }

  // 3) Pack → SO moves to packed AND a shipment is auto-created for the SO.
  const packed = await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/pack`, {});
  assert.equal(packed.status, 200);
  assert.equal(packed.json.status, "packed");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "packed");

  const shipments = (await call(app, "GET", "/api/shipping/")).json.items as Array<{ id: string; sales_order_id: string | null; invoice_id: string | null; status: string }>;
  const shipment = shipments.find((s) => s.sales_order_id === so.id);
  assert.ok(shipment, "a shipment was auto-created for the packed sales order");
  assert.equal(shipment!.invoice_id, null);
  assert.equal(shipment!.status, "pending_shipment");

  // 4) Ship → SO moves to shipped.
  const shipped = await call(app, "POST", `/api/shipping/${shipment!.id}/ship`, { carrier: "UPS", trackingNumber: "1Z-PIPE" });
  assert.equal(shipped.json.status, "shipped");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "shipped");

  // 5) Deliver → SO moves to delivered.
  const delivered = await call(app, "POST", `/api/shipping/${shipment!.id}/deliver`, {});
  assert.equal(delivered.json.status, "delivered");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "delivered");
});

test("pick list from a sales order is idempotent", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const a = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json;
  const b = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json;
  assert.equal(a.id, b.id);
});

test("shipment from a sales order is idempotent (auto + manual converge)", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const pl = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json as { id: string; lines: Array<{ id: string }> };
  for (const line of pl.lines) await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/lines/${line.id}/pick`, {});
  await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/pack`, {}); // auto-creates shipment
  const manual = await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: so.id });
  assert.equal(manual.status, 201);
  const shipments = (await call(app, "GET", "/api/shipping/")).json.items as Array<{ sales_order_id: string | null }>;
  assert.equal(shipments.filter((s) => s.sales_order_id === so.id).length, 1);
});

test("invoicing a sales order raises an AR invoice linked back to it", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);

  // Approve → invoice. Billing listens to sales_order.invoiced and raises the AR
  // invoice with sales_order_id set, so it is discoverable from the order.
  await call(app, "POST", `/api/sales/sales-orders/${so.id}/approve`, {});
  const invoiced = await call(app, "POST", `/api/sales/sales-orders/${so.id}/invoice`, {});
  assert.equal(invoiced.json.status, "invoiced");

  const linked = (await call(app, "GET", `/api/billing/invoices?salesOrderId=${so.id}`)).json.items as Array<{ id: string; sales_order_id: string | null; total_cents: number }>;
  assert.equal(linked.length, 1, "exactly one AR invoice linked to the sales order");
  assert.equal(linked[0]!.sales_order_id, so.id);
  assert.ok(linked[0]!.total_cents > 0);
});

test("fulfillment status cannot skip stages", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  // A shipment cannot be shipped→delivered path without going through packing;
  // creating a shipment directly and shipping it requires the SO be packed first.
  const created = await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: so.id });
  assert.equal(created.status, 201);
  const shipRes = await call(app, "POST", `/api/shipping/${created.json.id}/ship`, {});
  // SO is still 'unfulfilled' → shipped is not a legal transition from there.
  assert.equal(shipRes.status, 409);
});
