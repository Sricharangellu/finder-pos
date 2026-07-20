import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
}
async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  role: string = "owner",
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

async function makeProduct(app: App, sku: string, priceCents = 1000, costCents = 500): Promise<string> {
  const { status, json } = await call(app, "POST", "/api/catalog/", {
    sku, name: `Product ${sku}`, price_cents: priceCents, raw_cost_price_cents: costCents,
  });
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id;
}

// ─── Stock / sales / purchases / invoices / returns — read views ─────────────

test("stock: empty locations for a fresh product", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-STOCK-1");
  const r = await call(app, "GET", `/api/catalog/${id}/stock`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.locations, []);
});

test("stock: unknown product 404s", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/catalog/prod_missing/stock");
  assert.equal(r.status, 404);
});

test("sales: no orders yet returns zeroed totals", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-SALES-1");
  const r = await call(app, "GET", `/api/catalog/${id}/sales`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, []);
  assert.equal(r.json.total_units_sold, 0);
  assert.equal(r.json.total_revenue_cents, 0);
});

test("sales-by-customer: empty summary for a fresh product", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-SBC-1");
  const r = await call(app, "GET", `/api/catalog/${id}/sales-by-customer`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, []);
  assert.equal(r.json.summary.unique_customers, 0);
});

test("purchases/invoices: empty for a product with no POs", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-PO-1");
  const purchases = await call(app, "GET", `/api/catalog/${id}/purchases`);
  assert.equal(purchases.status, 200);
  assert.deepEqual(purchases.json.items, []);
  const invoices = await call(app, "GET", `/api/catalog/${id}/invoices`);
  assert.equal(invoices.status, 200);
  assert.deepEqual(invoices.json.items, []);
});

test("returns: empty when nothing has been refunded", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-RET-1");
  const r = await call(app, "GET", `/api/catalog/${id}/returns`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, []);
  assert.equal(r.json.total_units_returned, 0);
});

// ─── Reorder suggestions / analytics / supplier-price-comparison ─────────────

test("reorder-suggestions: no stock rows yet reads as critical (available <= 0)", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-REORDER-1");
  const r = await call(app, "GET", `/api/catalog/${id}/reorder-suggestions`);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "critical");
  assert.equal(r.json.current_stock, 0);
});

test("analytics: fresh product has zeroed summary and empty trend", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-ANALYTICS-1");
  const r = await call(app, "GET", `/api/catalog/${id}/analytics?period=30d`);
  assert.equal(r.status, 200);
  assert.equal(r.json.period, "30d");
  assert.deepEqual(r.json.trend, []);
  assert.equal(r.json.summary.units_sold, 0);
  assert.equal(r.json.summary.abc_class, "C");
});

test("reorder-suggestions: incoming_stock reflects true remaining after a partial receive (regression for received_qty vs billed_qty bug)", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-REORDER-INCOMING-1");

  const supplier = await call(app, "POST", "/api/purchasing/suppliers", { name: "Regression Supplier" });
  assert.equal(supplier.status, 201, `supplier create failed: ${JSON.stringify(supplier.json)}`);

  const po = await call(app, "POST", "/api/purchasing/orders", {
    supplierId: supplier.json.id,
    lines: [{ productId: id, quantity: 20, unitCostCents: 100 }],
  });
  assert.equal(po.status, 201, `PO create failed: ${JSON.stringify(po.json)}`);
  assert.equal(po.json.status, "ordered");
  const lineId = po.json.lines[0].id;

  // Before any receiving: all 20 units are incoming.
  const before = await call(app, "GET", `/api/catalog/${id}/reorder-suggestions`);
  assert.equal(before.status, 200);
  assert.equal(before.json.incoming_stock, 20);

  // Partially receive 8 of 20 — PO moves to 'partially_received', 12 remain incoming.
  const receive = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/receive`, {
    lines: [{ lineId, qty: 8 }],
  });
  assert.equal(receive.status, 200, `receive failed: ${JSON.stringify(receive.json)}`);
  assert.equal(receive.json.status, "partially_received");

  const after = await call(app, "GET", `/api/catalog/${id}/reorder-suggestions`);
  assert.equal(after.status, 200);
  // Must be 12 (20 - 8 received), not 20 — proves incoming_stock is driven by
  // received_qty (physical receipt progress), not billed_qty (invoice reconciliation,
  // which stays NULL here and would wrongly report the full original 20).
  assert.equal(after.json.incoming_stock, 12);
});

test("supplier-price-comparison: empty when no suppliers are linked", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-SPC-1");
  const r = await call(app, "GET", `/api/catalog/${id}/supplier-price-comparison`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.items, []);
  assert.equal(r.json.best_price_supplier_id, "");
});

// ─── Suppliers CRUD ───────────────────────────────────────────────────────────

test("suppliers: add creates-by-name, set preferred is exclusive, update, delete", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-SUP-1");

  const add1 = await call(app, "POST", `/api/catalog/${id}/suppliers`, {
    vendor_name: "Acme Distributors", cost_cents: 300, is_preferred: true, lead_time_days: 5,
  });
  assert.equal(add1.status, 201);
  assert.equal(add1.json.vendor_name, "Acme Distributors");
  assert.equal(add1.json.is_preferred, true);

  const add2 = await call(app, "POST", `/api/catalog/${id}/suppliers`, {
    vendor_name: "Beta Supply", cost_cents: 250, is_preferred: true,
  });
  assert.equal(add2.status, 201);

  // Setting the 2nd preferred must un-set the 1st (exclusive).
  const list = await call(app, "GET", `/api/catalog/${id}/suppliers`);
  assert.equal(list.status, 200);
  const preferredCount = list.json.items.filter((s: { is_preferred: boolean }) => s.is_preferred).length;
  assert.equal(preferredCount, 1);
  assert.equal(list.json.items.find((s: { id: string }) => s.id === add2.json.id).is_preferred, true);

  // Re-adding the same vendor name upserts the existing product_suppliers row
  // (same id, same supplier) instead of colliding on the UNIQUE constraint.
  const add3 = await call(app, "POST", `/api/catalog/${id}/suppliers`, { vendor_name: "acme distributors", cost_cents: 310 });
  assert.equal(add3.status, 201);
  assert.equal(add3.json.vendor_id, add1.json.vendor_id);
  assert.equal(add3.json.id, add1.json.id);
  assert.equal(add3.json.cost_cents, 310);

  const patched = await call(app, "PATCH", `/api/catalog/${id}/suppliers/${add1.json.id}`, { cost_cents: 275 });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.cost_cents, 275);

  const del = await call(app, "DELETE", `/api/catalog/${id}/suppliers/${add1.json.id}`);
  assert.equal(del.status, 204);
  const afterDelete = await call(app, "GET", `/api/catalog/${id}/suppliers`);
  assert.equal(afterDelete.json.items.some((s: { id: string }) => s.id === add1.json.id), false);
});

test("suppliers: cross-product id is not found (scoped by product)", async () => {
  const app = await freshApp();
  const idA = await makeProduct(app, "DV-SUP-A");
  const idB = await makeProduct(app, "DV-SUP-B");
  const add = await call(app, "POST", `/api/catalog/${idA}/suppliers`, { vendor_name: "Only A's vendor" });
  assert.equal(add.status, 201);
  const crossDelete = await call(app, "DELETE", `/api/catalog/${idB}/suppliers/${add.json.id}`);
  assert.equal(crossDelete.status, 404);
});

// ─── Pricing + tiers ──────────────────────────────────────────────────────────

test("pricing: get defaults, patch wholesale/map, add + delete a quantity tier", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-PRICE-1");

  const initial = await call(app, "GET", `/api/catalog/${id}/pricing`);
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.json.tiers, []);
  assert.equal(initial.json.wholesale_price_cents, null);

  const patched = await call(app, "PATCH", `/api/catalog/${id}/pricing`, { wholesale_price_cents: 800, map_price_cents: 950 });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.wholesale_price_cents, 800);
  assert.equal(patched.json.map_price_cents, 950);

  const tier = await call(app, "POST", `/api/catalog/${id}/pricing/tiers`, { min_qty: 12, price_cents: 900, label: "Case" });
  assert.equal(tier.status, 201);
  assert.equal(tier.json.min_qty, 12);

  const badTier = await call(app, "POST", `/api/catalog/${id}/pricing/tiers`, { min_qty: 0, price_cents: 100 });
  assert.equal(badTier.status, 400);

  const afterAdd = await call(app, "GET", `/api/catalog/${id}/pricing`);
  assert.equal(afterAdd.json.tiers.length, 1);

  const del = await call(app, "DELETE", `/api/catalog/${id}/pricing/tiers/${tier.json.id}`);
  assert.equal(del.status, 204);
  const afterDelete = await call(app, "GET", `/api/catalog/${id}/pricing`);
  assert.equal(afterDelete.json.tiers.length, 0);
});

// ─── Expiry CRUD ──────────────────────────────────────────────────────────────

test("expiry: add computes status from expiry_date, patch and delete work", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-EXP-1");

  const soon = Date.now() + 3 * 86_400_000; // 3 days out -> critical
  const add = await call(app, "POST", `/api/catalog/${id}/expiry`, {
    batch_number: "B100", quantity: 50, unit_cost_cents: 200, expiry_date: soon,
  });
  assert.equal(add.status, 201);
  assert.equal(add.json.expiry_status, "critical");
  assert.equal(add.json.batch_number, "B100");

  const patched = await call(app, "PATCH", `/api/catalog/${id}/expiry/${add.json.id}`, { quantity: 40 });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.quantity, 40);

  const list = await call(app, "GET", `/api/catalog/${id}/expiry`);
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const del = await call(app, "DELETE", `/api/catalog/${id}/expiry/${add.json.id}`);
  assert.equal(del.status, 204);
  const afterDelete = await call(app, "GET", `/api/catalog/${id}/expiry`);
  assert.equal(afterDelete.json.items.length, 0);
});

test("expiry: quantity must be positive", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-EXP-2");
  const r = await call(app, "POST", `/api/catalog/${id}/expiry`, { quantity: 0 });
  assert.equal(r.status, 400);
});

// ─── Images (patch primary + nested delete) ──────────────────────────────────

test("images: patch sets primary exclusively, nested delete removes the image", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-IMG-1");

  const img1 = await call(app, "POST", `/api/catalog/${id}/images`, { imageUrl: "https://example.com/a.jpg" });
  assert.equal(img1.status, 201);
  const img2 = await call(app, "POST", `/api/catalog/${id}/images`, { imageUrl: "https://example.com/b.jpg" });
  assert.equal(img2.status, 201);

  const setPrimary = await call(app, "PATCH", `/api/catalog/${id}/images/${img2.json.id}`, { is_primary: true });
  assert.equal(setPrimary.status, 200);

  const list = await call(app, "GET", `/api/catalog/${id}/images`);
  const primaries = list.json.items.filter((i: { is_primary: boolean }) => i.is_primary);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, img2.json.id);

  const del = await call(app, "DELETE", `/api/catalog/${id}/images/${img1.json.id}`);
  assert.equal(del.status, 204);
  const afterDelete = await call(app, "GET", `/api/catalog/${id}/images`);
  assert.equal(afterDelete.json.items.length, 1);
});

test("images: nested delete for an image belonging to a different product 404s", async () => {
  const app = await freshApp();
  const idA = await makeProduct(app, "DV-IMG-A");
  const idB = await makeProduct(app, "DV-IMG-B");
  const img = await call(app, "POST", `/api/catalog/${idA}/images`, { imageUrl: "https://example.com/a.jpg" });
  const crossDelete = await call(app, "DELETE", `/api/catalog/${idB}/images/${img.json.id}`);
  assert.equal(crossDelete.status, 404);
});

// ─── Duplicate ────────────────────────────────────────────────────────────────

test("duplicate: clones fields, gets a deduplicated SKU, and starts as draft", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-DUP-1", 1999, 900);
  const copy = await call(app, "POST", `/api/catalog/${id}/duplicate`);
  assert.equal(copy.status, 201);
  assert.equal(copy.json.sku, "DV-DUP-1-COPY");
  assert.equal(copy.json.name, "Product DV-DUP-1 (Copy)");
  assert.equal(copy.json.price_cents, 1999);
  assert.equal(copy.json.status, "draft");

  // A second duplicate must not collide on SKU.
  const copy2 = await call(app, "POST", `/api/catalog/${id}/duplicate`);
  assert.equal(copy2.status, 201);
  assert.equal(copy2.json.sku, "DV-DUP-1-COPY2");
});

// ─── Audit log ────────────────────────────────────────────────────────────────

test("audit-log: create then update produce flattened, per-field entries", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-AUDIT-1");

  await call(app, "PATCH", `/api/catalog/${id}`, { name: "Renamed Widget", price_cents: 2500 });

  const log = await call(app, "GET", `/api/catalog/${id}/audit-log`);
  assert.equal(log.status, 200);
  assert.ok(log.json.items.length >= 2, "expect at least a create entry + one update field entry");

  const created = log.json.items.find((e: { action: string }) => e.action === "create");
  assert.ok(created, "expected a create entry");

  const nameChange = log.json.items.find((e: { field: string | null }) => e.field === "name");
  assert.ok(nameChange, "expected a per-field 'name' entry");
  assert.equal(nameChange.action, "update");
  assert.equal(nameChange.new_value, "Renamed Widget");
  assert.equal(nameChange.old_value, "Product DV-AUDIT-1");
});

test("audit-log: archiving is classified as an 'archive' action", async () => {
  const app = await freshApp();
  const id = await makeProduct(app, "DV-AUDIT-2");
  const del = await call(app, "DELETE", `/api/catalog/${id}`);
  assert.equal(del.status, 200);
  const log = await call(app, "GET", `/api/catalog/${id}/audit-log`);
  const archived = log.json.items.find((e: { action: string }) => e.action === "archive");
  assert.ok(archived, "expected an archive entry");
  assert.equal(archived.field, "status");
  assert.equal(archived.new_value, "archived");
});
