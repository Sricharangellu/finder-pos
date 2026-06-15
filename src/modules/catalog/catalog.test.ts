import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

// Per-test schema isolation against the shared Postgres instance.
let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
import type { DomainEvent } from "../../shared/types.js";

async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
}

async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  // Drive express directly via a minimal mock req/res to avoid a network listen.
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

test("create product returns 201 with created product", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/catalog/", {
    sku: "TEST-001",
    name: "Test Widget",
    price_cents: 1500,
    category: "general",
  });
  assert.equal(status, 201);
  assert.ok(json.id.startsWith("prod_"));
  assert.equal(json.sku, "TEST-001");
  assert.equal(json.price_cents, 1500);
  assert.equal(json.tax_class, "standard");
  assert.equal(json.status, "active");
});

test("grocery category auto-forces tax_class exempt", async () => {
  const app = await freshApp();
  const { json } = await call(app, "POST", "/api/catalog/", {
    sku: "GRO-XYZ",
    name: "Bananas",
    price_cents: 120,
    category: "groceries",
    tax_class: "standard", // caller override should be ignored for groceries
  });
  assert.equal(json.category, "groceries");
  assert.equal(json.tax_class, "exempt");
});

test("caller may set tax_class exempt on non-grocery", async () => {
  const app = await freshApp();
  const { json } = await call(app, "POST", "/api/catalog/", {
    sku: "MED-001",
    name: "Prescription Item",
    price_cents: 500,
    category: "pharmacy",
    tax_class: "exempt",
  });
  assert.equal(json.tax_class, "exempt");
});

test("list with category filter returns Page shape", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/catalog/", { sku: "A-1", name: "A", price_cents: 100, category: "apparel" });
  await call(app, "POST", "/api/catalog/", { sku: "G-1", name: "G", price_cents: 200, category: "groceries" });

  const { status, json } = await call(app, "GET", "/api/catalog/?category=apparel");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.equal(typeof json.total, "number");
  assert.equal(typeof json.limit, "number");
  assert.equal(typeof json.offset, "number");
  assert.ok(json.items.every((p: any) => p.category === "apparel"));
});

test("list with status filter", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", { sku: "S-1", name: "S", price_cents: 100 });
  await call(app, "DELETE", `/api/catalog/${created.json.id}`);
  const archived = await call(app, "GET", "/api/catalog/?status=archived");
  assert.ok(archived.json.items.some((p: any) => p.id === created.json.id));
  const active = await call(app, "GET", "/api/catalog/?status=active");
  assert.ok(!active.json.items.some((p: any) => p.id === created.json.id));
});

test("list with unknown status filter returns 400", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/catalog/?status=bogus");
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
});

test("get missing product returns 404", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/catalog/prod_does_not_exist");
  assert.equal(status, 404);
  assert.equal(json.error.code, "not_found");
});

test("update mutable fields", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", { sku: "U-1", name: "Old", price_cents: 100 });
  const { status, json } = await call(app, "PATCH", `/api/catalog/${created.json.id}`, {
    name: "New Name",
    price_cents: 250,
  });
  assert.equal(status, 200);
  assert.equal(json.name, "New Name");
  assert.equal(json.price_cents, 250);
  assert.ok(json.updated_at >= created.json.updated_at);
});

test("updating category to groceries flips tax_class to exempt", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", { sku: "U-2", name: "Item", price_cents: 100, category: "general" });
  assert.equal(created.json.tax_class, "standard");
  const { json } = await call(app, "PATCH", `/api/catalog/${created.json.id}`, { category: "groceries" });
  assert.equal(json.category, "groceries");
  assert.equal(json.tax_class, "exempt");
});

test("archive soft-deletes (status=archived)", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", { sku: "AR-1", name: "Arch", price_cents: 100 });
  const { status, json } = await call(app, "DELETE", `/api/catalog/${created.json.id}`);
  assert.equal(status, 200);
  assert.equal(json.status, "archived");
  // still retrievable (soft delete)
  const fetched = await call(app, "GET", `/api/catalog/${created.json.id}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.status, "archived");
});

test("product.created fires on the bus", async () => {
  const app = await freshApp();
  const events: DomainEvent[] = [];
  app.events.on("product.created", (e) => { events.push(e); });

  const { json } = await call(app, "POST", "/api/catalog/", {
    sku: "EVT-1",
    name: "Eventful",
    price_cents: 999,
    category: "groceries",
  });

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, "product.created");
  assert.equal(e.aggregateId, json.id);
  const p = e.payload as any;
  assert.equal(p.id, json.id);
  assert.equal(p.sku, "EVT-1");
  assert.equal(p.priceCents, 999);
  assert.equal(p.taxClass, "exempt");
});

test("product.updated fires with changed fields", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", { sku: "EVT-2", name: "Before", price_cents: 100 });
  const events: DomainEvent[] = [];
  app.events.on("product.updated", (e) => { events.push(e); });
  await call(app, "PATCH", `/api/catalog/${created.json.id}`, { name: "After" });
  assert.equal(events.length, 1);
  const p = events[0].payload as any;
  assert.equal(p.id, created.json.id);
  assert.equal(p.name, "After");
});

test("duplicate sku conflicts (409)", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/catalog/", { sku: "DUP-1", name: "First", price_cents: 100 });
  const { status, json } = await call(app, "POST", "/api/catalog/", { sku: "DUP-1", name: "Second", price_cents: 200 });
  assert.equal(status, 409);
  assert.equal(json.error.code, "conflict");
});

test("concurrent duplicate sku still conflicts (409), never leaks a 500", async () => {
  const app = await freshApp();
  // Fire both creates concurrently so they can both pass the pre-check and race
  // to INSERT. Exactly one must win (201); the loser must be a clean 409 from
  // the sku UNIQUE constraint, never a leaked 500.
  const [a, b] = await Promise.all([
    call(app, "POST", "/api/catalog/", { sku: "RACE-1", name: "A", price_cents: 100 }),
    call(app, "POST", "/api/catalog/", { sku: "RACE-1", name: "B", price_cents: 200 }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.json.error.code, "conflict");
});

test("demo products are seeded on init", async () => {
  const app = await freshApp();
  const { json } = await call(app, "GET", "/api/catalog/?limit=200");
  assert.ok(json.total >= 4);
  assert.ok(json.items.some((p: any) => p.name === "Organic Dark Roast Beans" && p.tax_class === "exempt"));
  assert.ok(json.items.some((p: any) => p.name === "Wildflower Honey"));
});

test("create accepts and update changes product detail fields (BE-6)", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/catalog/", {
    sku: "DETAIL-1",
    name: "Detailed Widget",
    price_cents: 999,
    description: "A widget with details",
    brand: "Acme",
    length_mm: 100,
    width_mm: 50,
    height_mm: 25,
    weight_grams: 300,
    image_url: "https://example.com/widget.png",
    vendor_upc: "0000111122223",
    min_qty_to_sell: 1,
    max_qty_to_sell: 10,
    qty_increment: 2,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.brand, "Acme");
  assert.equal(created.json.weight_grams, 300);
  assert.equal(created.json.qty_increment, 2);

  const updated = await call(app, "PATCH", `/api/catalog/${created.json.id}`, {
    brand: "Acme Industrial",
    image_url: null,
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.brand, "Acme Industrial");
  assert.equal(updated.json.image_url, null);
  assert.equal(updated.json.weight_grams, 300); // untouched fields persist
});

test("category tree: create, nest, assign to product, and delete reparents children", async () => {
  const app = await freshApp();

  const root = await call(app, "POST", "/api/catalog/categories", { name: "Beverages" });
  assert.equal(root.status, 201);
  assert.ok(root.json.id.startsWith("cat_"));
  assert.equal(root.json.parent_id, null);

  const child = await call(app, "POST", "/api/catalog/categories", { name: "Coffee", parent_id: root.json.id });
  assert.equal(child.status, 201);
  assert.equal(child.json.parent_id, root.json.id);

  const list = await call(app, "GET", "/api/catalog/categories");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((c: any) => c.id === root.json.id));
  assert.ok(list.json.items.some((c: any) => c.id === child.json.id));

  const product = await call(app, "POST", "/api/catalog/", { sku: "CAT-1", name: "Espresso Beans", price_cents: 1599 });
  const assign = await call(app, "PUT", `/api/catalog/${product.json.id}/categories`, { categoryIds: [child.json.id] });
  assert.equal(assign.status, 200);

  const productCats = await call(app, "GET", `/api/catalog/${product.json.id}/categories`);
  assert.deepEqual(productCats.json.items, [child.json.id]);

  // Deleting the root reparents the child to null rather than orphaning it.
  const del = await call(app, "DELETE", `/api/catalog/categories/${root.json.id}`);
  assert.equal(del.status, 200);
  const childAfter = await call(app, "GET", "/api/catalog/categories");
  const reparented = childAfter.json.items.find((c: any) => c.id === child.json.id);
  assert.equal(reparented.parent_id, null);
});

test("category mutations are manager/owner-gated", async () => {
  const app = await freshApp();
  const { default: request } = await import("./test-request.js");
  const { status, json } = await request(app.express, "POST", "/api/catalog/categories", { name: "Should Fail" }, "cashier");
  assert.equal(status, 403);
  assert.equal(json.error.code, "forbidden");
});
