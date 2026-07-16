import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";
import { FulfillmentService } from "../fulfillment/service.js";
import { ShippingService } from "./service.js";
import { SalesService } from "../sales/service.js";

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

// Issue an authenticated request as a specific role (the shared test-request helper
// always signs `owner`); used to prove server-side role gating.
function callAs(app: App, role: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: "usr_role_test", tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
  const p = path.startsWith("/api/") && !path.startsWith("/api/v1/") && !path.startsWith("/api/identity/") ? path.replace("/api/", "/api/v1/") : path;
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(payload)); }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method, path: p, headers }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); let json: any; try { json = data ? JSON.parse(data) : undefined; } catch { json = data; } resolve({ status: res.statusCode ?? 0, json }); });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

async function mkProduct(app: App, sku: string, priceCents: number) {
  const prod = (await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 100 });
  return prod as { id: string; name: string };
}
async function mkCustomer(app: App, name = "Pipeline Corp") {
  return (await call(app, "POST", "/api/customers/", { name })).json as { id: string };
}
let __so = 0;
async function mkSalesOrder(app: App) {
  const customer = await mkCustomer(app);
  // Unique SKUs per call so a test can create more than one sales order in the
  // same app without colliding on the tenant-unique SKU constraint.
  const n = __so++;
  const p1 = await mkProduct(app, `PIPE-A-${n}`, 2500);
  const p2 = await mkProduct(app, `PIPE-B-${n}`, 1000);
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

test("pick-lists and shipments are queryable by sales order (no full-table scan)", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const pl = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json as { id: string; lines: Array<{ id: string }> };
  for (const line of pl.lines) await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/lines/${line.id}/pick`, {});
  await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/pack`, {}); // auto-creates the shipment

  const byOrder = (await call(app, "GET", `/api/fulfillment/pick-lists?orderId=${so.id}`)).json.items as Array<{ id: string; order_id: string }>;
  assert.equal(byOrder.length, 1);
  assert.equal(byOrder[0]!.id, pl.id);
  assert.equal(byOrder[0]!.order_id, so.id);

  const ships = (await call(app, "GET", `/api/shipping/?salesOrderId=${so.id}`)).json.items as Array<{ sales_order_id: string | null }>;
  assert.equal(ships.length, 1);
  assert.equal(ships[0]!.sales_order_id, so.id);

  // A different sales order returns nothing from either filter.
  const other = await mkSalesOrder(app);
  assert.equal((await call(app, "GET", `/api/fulfillment/pick-lists?orderId=${other.id}`)).json.items.length, 0);
  assert.equal((await call(app, "GET", `/api/shipping/?salesOrderId=${other.id}`)).json.items.length, 0);
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

// Regression: re-requesting a pick list after the order has advanced past
// `picking` must return the existing list without trying to move the order back
// to `picking` (which would 409). Guards the buildPickList `created`-flag path.
test("re-picking a packed sales order returns the existing list, does not revert status", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const pl = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json as { id: string; lines: Array<{ id: string }> };
  for (const line of pl.lines) await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/lines/${line.id}/pick`, {});
  await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/pack`, {});
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "packed");

  const again = await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id });
  assert.equal(again.status, 201);
  assert.equal(again.json.id, pl.id, "returns the same pick list");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "packed", "order stays packed, not reverted to picking");
});

test("packing before all lines are picked is rejected (409 not_picked); order stays picking", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const pl = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json as { id: string };
  const packRes = await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/pack`, {});
  assert.equal(packRes.status, 409);
  assert.equal(packRes.json.error.code, "not_picked");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "picking");
});

test("delivering a shipment that has not shipped is rejected (409)", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const shipment = (await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: so.id })).json as { id: string; status: string };
  assert.equal(shipment.status, "pending_shipment");
  const deliverRes = await call(app, "POST", `/api/shipping/${shipment.id}/deliver`, {});
  assert.equal(deliverRes.status, 409);
});

test("pick list / shipment creation 404s on a missing sales order", async () => {
  const app = await freshApp();
  const pick = await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: "sso_does_not_exist" });
  assert.equal(pick.status, 404);
  assert.equal(pick.json.error.code, "not_found");
  const ship = await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: "sso_does_not_exist" });
  assert.equal(ship.status, 404);
  assert.equal(ship.json.error.code, "not_found");
});

test("pipeline mutations require manager role (cashier gets 403)", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const denied = await callAs(app, "cashier", "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "forbidden");
  // Same call as a manager-or-above (the shared helper signs owner) succeeds.
  const ok = await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id });
  assert.equal(ok.status, 201);
  // Shipping mutations are gated too.
  assert.equal((await callAs(app, "cashier", "POST", "/api/shipping/from-sales-order", { salesOrderId: so.id })).status, 403);
});

test("re-packing recovers a shipment whose creation was skipped on a prior pack", async () => {
  const app = await freshApp();
  const so = await mkSalesOrder(app);
  const pl = (await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: so.id })).json as { id: string; lines: Array<{ id: string }> };
  for (const line of pl.lines) await call(app, "POST", `/api/fulfillment/pick-lists/${pl.id}/lines/${line.id}/pick`, {});

  const sales = new SalesService(app.db, app.events);
  // Simulate a pack where the shipment did NOT get created (shipping not wired).
  await new FulfillmentService(app.db, sales).pack(pl.id, "tnt_demo");
  assert.equal((await call(app, "GET", `/api/shipping/?salesOrderId=${so.id}`)).json.items.length, 0, "no shipment after the skipped attempt");
  assert.equal((await call(app, "GET", `/api/sales/sales-orders/${so.id}`)).json.fulfillment_status, "packed");

  // Re-pack with shipping wired → the missing shipment is created (recovery), even
  // though the order is already `packed` (so no status-change event would fire).
  await new FulfillmentService(app.db, sales, new ShippingService(app.db, sales)).pack(pl.id, "tnt_demo");
  assert.equal((await call(app, "GET", `/api/shipping/?salesOrderId=${so.id}`)).json.items.length, 1, "re-pack created the missing shipment");
});

test("ship numbers are distinct and monotonic via the shared document counter", async () => {
  const app = await freshApp();
  const soA = await mkSalesOrder(app);
  const soB = await mkSalesOrder(app);
  const a = (await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: soA.id })).json as { ship_number: string };
  const b = (await call(app, "POST", "/api/shipping/from-sales-order", { salesOrderId: soB.id })).json as { ship_number: string };
  // Format preserved (first is 00001), numbers monotonic and never colliding —
  // the atomic counter replaces the racy COUNT(*)-derived number.
  assert.equal(a.ship_number, "SHP-00001");
  assert.equal(b.ship_number, "SHP-00002");
  assert.notEqual(a.ship_number, b.ship_number);
});

test("sales orders are filterable by fulfillment_status", async () => {
  const app = await freshApp();
  const picking = await mkSalesOrder(app);
  const untouched = await mkSalesOrder(app);
  await call(app, "POST", "/api/fulfillment/pick-lists/from-sales-order", { salesOrderId: picking.id }); // picking.id → picking

  const inPicking = (await call(app, "GET", "/api/sales/sales-orders?fulfillmentStatus=picking")).json.items as Array<{ id: string }>;
  assert.ok(inPicking.some((o) => o.id === picking.id), "picking order is returned");
  assert.ok(!inPicking.some((o) => o.id === untouched.id), "unfulfilled order is excluded");

  const inUnfulfilled = (await call(app, "GET", "/api/sales/sales-orders?fulfillmentStatus=unfulfilled")).json.items as Array<{ id: string }>;
  assert.ok(inUnfulfilled.some((o) => o.id === untouched.id), "unfulfilled order is returned");
  assert.ok(!inUnfulfilled.some((o) => o.id === picking.id), "picking order is excluded");
});
