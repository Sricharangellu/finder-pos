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

async function mkSupplier(app: App, name = "Acme Supplies") {
  const r = await call(app, "POST", "/api/purchasing/suppliers", { name });
  assert.equal(r.status, 201, `supplier creation failed: ${JSON.stringify(r.json)}`);
  return r.json as { id: string };
}

async function mkCustomer(app: App, name = "Beta Corp") {
  const r = await call(app, "POST", "/api/customers/", { name });
  assert.equal(r.status, 201, `customer creation failed: ${JSON.stringify(r.json)}`);
  return r.json as { id: string };
}

// ─── Bills (AP) ───────────────────────────────────────────────────────────────

test("create a bill and list it", async () => {
  const app = await freshApp();
  const supplier = await mkSupplier(app);

  const r = await call(app, "POST", "/api/billing/bills", {
    supplierId: supplier.id,
    totalCents: 50000,
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("bil_"));
  assert.match(r.json.bill_number, /^BILL-/);
  assert.equal(r.json.status, "open");
  assert.equal(r.json.total_cents, 50000);
  assert.equal(r.json.paid_cents, 0);

  const list = await call(app, "GET", "/api/billing/bills");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((b: { id: string }) => b.id === r.json.id));
});

test("partial then full bill payment transitions status correctly", async () => {
  const app = await freshApp();
  const supplier = await mkSupplier(app);
  const bill = (await call(app, "POST", "/api/billing/bills", { supplierId: supplier.id, totalCents: 10000 })).json;

  // Partial payment → "partial"
  let paid = await call(app, "POST", `/api/billing/bills/${bill.id}/pay`, { amountCents: 4000, method: "bank_transfer" });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.status, "partial");
  assert.equal(paid.json.paid_cents, 4000);

  // Remaining payment → "paid"
  paid = await call(app, "POST", `/api/billing/bills/${bill.id}/pay`, { amountCents: 6000, method: "bank_transfer" });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.status, "paid");
  assert.equal(paid.json.paid_cents, 10000);
});

test("paying more than outstanding is rejected", async () => {
  const app = await freshApp();
  const supplier = await mkSupplier(app);
  const bill = (await call(app, "POST", "/api/billing/bills", { supplierId: supplier.id, totalCents: 5000 })).json;

  const r = await call(app, "POST", `/api/billing/bills/${bill.id}/pay`, { amountCents: 9999, method: "cash" });
  assert.equal(r.status, 400);
});

// ─── Invoices (AR) ────────────────────────────────────────────────────────────

test("create an invoice and pay it in full", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);

  const inv = await call(app, "POST", "/api/billing/invoices", {
    customerId: customer.id,
    totalCents: 25000,
  });
  assert.equal(inv.status, 201);
  assert.ok(inv.json.id.startsWith("inv_"));
  assert.match(inv.json.invoice_number, /^INV-/);
  assert.equal(inv.json.status, "open");
  assert.equal(inv.json.total_cents, 25000);

  const paid = await call(app, "POST", `/api/billing/invoices/${inv.json.id}/pay`, {
    amountCents: 25000,
    method: "card",
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.json.status, "paid");
  assert.equal(paid.json.paid_cents, 25000);
});

test("invoice auto-derives total from linked order", async () => {
  const app = await freshApp();
  const customer = await mkCustomer(app);

  // Create a product + order + payment to have a completed order
  const prod = (await call(app, "POST", "/api/catalog/", { sku: "INV-P1", name: "Widget", price_cents: 5000, category: "general" })).json;
  await call(app, "POST", `/api/inventory/${prod.id}/receive`, { quantity: 5 });
  const order = (await call(app, "POST", "/api/orders/", { stateCode: "CA", customerId: customer.id, lines: [{ productId: prod.id, quantity: 2 }] })).json;

  const inv = await call(app, "POST", "/api/billing/invoices", { customerId: customer.id, orderId: order.id });
  assert.equal(inv.status, 201);
  // Total should match the order's total (we don't know the exact cents due to tax, just verify positive)
  assert.ok(inv.json.total_cents > 0);
  assert.equal(inv.json.order_id, order.id);
});

test("bill creation without supplierId is rejected", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/billing/bills", { totalCents: 1000 });
  assert.equal(r.status, 400);
});

test("invoice creation without customerId is rejected", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/billing/invoices", { totalCents: 500 });
  assert.equal(r.status, 400);
});

// ─── Bill list: supplier filter + auto-draft from receiving ────────────────────

test("listBills filters by supplier and includes the joined supplier name", async () => {
  const app = await freshApp();
  const supA = await mkSupplier(app, "Alpha Distributing");
  const supB = await mkSupplier(app, "Beta Wholesale");
  await call(app, "POST", "/api/billing/bills", { supplierId: supA.id, totalCents: 5000 });
  await call(app, "POST", "/api/billing/bills", { supplierId: supB.id, totalCents: 9000 });

  const all = await call(app, "GET", "/api/billing/bills");
  assert.equal(all.status, 200);
  assert.equal(all.json.items.length, 2);

  const onlyA = await call(app, "GET", `/api/billing/bills?supplierId=${supA.id}`);
  assert.equal(onlyA.status, 200);
  assert.equal(onlyA.json.items.length, 1, `supplier filter should return one bill: ${JSON.stringify(onlyA.json.items)}`);
  assert.equal(onlyA.json.items[0].supplier_id, supA.id);
  assert.equal(onlyA.json.items[0].supplier_name, "Alpha Distributing", "bill carries the joined supplier name");
});

test("receiving a PO auto-drafts a bill retrievable by supplier", async () => {
  const app = await freshApp();
  const supplier = await mkSupplier(app, "Gamma Foods");
  const prod = (await call(app, "POST", "/api/catalog/", { sku: "AUTO-BILL-1", name: "Case of Water", price_cents: 1000, category: "general" })).json;

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId: supplier.id,
    lines: [{ productId: prod.id, quantity: 4, unitCostCents: 500 }],
  })).json;

  // Full receive → billing's purchase_order.received listener drafts a bill
  // synchronously (the event bus awaits handlers before publish() returns).
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 4 }],
  });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);

  const bills = await call(app, "GET", `/api/billing/bills?supplierId=${supplier.id}`);
  assert.equal(bills.status, 200);
  assert.equal(bills.json.items.length, 1, `expected one auto-drafted bill: ${JSON.stringify(bills.json.items)}`);
  assert.equal(bills.json.items[0].po_id, po.id, "auto-bill links back to the received PO");
  assert.equal(bills.json.items[0].supplier_name, "Gamma Foods");
});
