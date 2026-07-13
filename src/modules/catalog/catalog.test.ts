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

test("variants: assign children to a master, list them, and exclude master from excludeMasters listing (BE-8)", async () => {
  const app = await freshApp();

  const master = await call(app, "POST", "/api/catalog/", { sku: "VAR-MASTER", name: "T-Shirt", price_cents: 0, category: "apparel" });
  const small = await call(app, "POST", "/api/catalog/", { sku: "VAR-S", name: "T-Shirt - Small", price_cents: 1999, category: "apparel" });
  const large = await call(app, "POST", "/api/catalog/", { sku: "VAR-L", name: "T-Shirt - Large", price_cents: 1999, category: "apparel", variant_label: "Large" });

  const assign = await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, {
    productIds: [small.json.id, large.json.id],
  });
  assert.equal(assign.status, 200);

  const variants = await call(app, "GET", `/api/catalog/${master.json.id}/variants`);
  assert.equal(variants.status, 200);
  assert.equal(variants.json.items.length, 2);
  assert.ok(variants.json.items.every((p: any) => p.parent_product_id === master.json.id));
  assert.equal(variants.json.items.find((p: any) => p.id === large.json.id).variant_label, "Large");

  const excluding = await call(app, "GET", "/api/catalog/?excludeMasters=true&limit=200");
  assert.ok(!excluding.json.items.some((p: any) => p.id === master.json.id));
  assert.ok(excluding.json.items.some((p: any) => p.id === small.json.id));

  const including = await call(app, "GET", "/api/catalog/?limit=200");
  assert.ok(including.json.items.some((p: any) => p.id === master.json.id));
});

test("variants: create a child directly, list it, and clear its parent", async () => {
  const app = await freshApp();

  const master = await call(app, "POST", "/api/catalog/", { sku: "DIRECT-MASTER", name: "Running Shoe", price_cents: 0, category: "footwear" });
  const child = await call(app, "POST", "/api/catalog/", {
    sku: "DIRECT-CHILD-9",
    name: "Running Shoe - Size 9",
    price_cents: 7499,
    category: "footwear",
    parent_product_id: master.json.id,
    variant_label: "Size 9",
  });

  assert.equal(child.status, 201);
  assert.equal(child.json.parent_product_id, master.json.id);
  assert.equal(child.json.variant_label, "Size 9");

  const variants = await call(app, "GET", `/api/catalog/${master.json.id}/variants`);
  assert.deepEqual(variants.json.items.map((p: any) => p.id), [child.json.id]);

  const cleared = await call(app, "PATCH", `/api/catalog/${child.json.id}`, {
    parent_product_id: null,
    variant_label: null,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.parent_product_id, null);
  assert.equal(cleared.json.variant_label, null);

  const afterClear = await call(app, "GET", `/api/catalog/${master.json.id}/variants`);
  assert.equal(afterClear.json.items.length, 0);
});

test("variants: assign can set a label and unlink a child", async () => {
  const app = await freshApp();

  const master = await call(app, "POST", "/api/catalog/", { sku: "LINK-MASTER", name: "Bottle", price_cents: 0 });
  const child = await call(app, "POST", "/api/catalog/", { sku: "LINK-CHILD", name: "Bottle 1L", price_cents: 1299 });

  const assign = await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, {
    productIds: [child.json.id],
    label: "1L",
  });
  assert.equal(assign.status, 200);
  assert.equal(assign.json.items.length, 1);
  assert.equal(assign.json.items[0].parent_product_id, master.json.id);
  assert.equal(assign.json.items[0].variant_label, "1L");

  const unlink = await call(app, "DELETE", `/api/catalog/${master.json.id}/variants/${child.json.id}`);
  assert.equal(unlink.status, 200);
  assert.equal(unlink.json.parent_product_id, null);
  assert.equal(unlink.json.variant_label, null);
});

test("variants: assign rolls back all children when one child is invalid", async () => {
  const app = await freshApp();

  const targetMaster = await call(app, "POST", "/api/catalog/", { sku: "ROLLBACK-MASTER", name: "Target master", price_cents: 0 });
  const goodChild = await call(app, "POST", "/api/catalog/", { sku: "ROLLBACK-GOOD", name: "Good child", price_cents: 100 });
  const existingMaster = await call(app, "POST", "/api/catalog/", { sku: "ROLLBACK-BAD-MASTER", name: "Existing master", price_cents: 0 });
  await call(app, "POST", "/api/catalog/", {
    sku: "ROLLBACK-BAD-CHILD",
    name: "Existing child",
    price_cents: 100,
    parent_product_id: existingMaster.json.id,
  });

  const assign = await call(app, "POST", `/api/catalog/${targetMaster.json.id}/variants/assign`, {
    productIds: [goodChild.json.id, existingMaster.json.id],
    label: "Should not persist",
  });
  assert.equal(assign.status, 409);
  assert.equal(assign.json.error.code, "conflict");

  const goodAfter = await call(app, "GET", `/api/catalog/${goodChild.json.id}`);
  assert.equal(goodAfter.json.parent_product_id, null);
  assert.equal(goodAfter.json.variant_label, null);
  const targetVariants = await call(app, "GET", `/api/catalog/${targetMaster.json.id}/variants`);
  assert.equal(targetVariants.json.items.length, 0);
});

test("variants: matrix generation creates missing children and is idempotent", async () => {
  const app = await freshApp();

  const master = await call(app, "POST", "/api/catalog/", {
    sku: "MATRIX-TEE",
    name: "Matrix Tee",
    price_cents: 2500,
    category: "apparel",
    brand: "Ascend",
  });

  const generated = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Black"] },
    ],
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.json.items.length, 2);
  // Standardized separator (" - "), never "/".
  assert.deepEqual(generated.json.items.map((p: any) => p.variant_label).sort(), ["M - Black", "S - Black"]);
  assert.ok(generated.json.items.every((p: any) => !String(p.variant_label).includes("/")));
  assert.ok(generated.json.items.every((p: any) => p.parent_product_id === master.json.id));
  assert.ok(generated.json.items.every((p: any) => p.brand === "Ascend"));

  const repeated = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Black"] },
    ],
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.json.items.length, 2);
});

test("variants: matrix generation rolls back created children when SKU allocation later fails", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", {
    sku: "ROLLBACK-MATRIX",
    name: "Rollback Matrix",
    price_cents: 2500,
    category: "apparel",
  });

  const now = Date.now();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    await app.db.query(
      `INSERT INTO products (id, tenant_id, sku, name, price_cents, created_at, updated_at)
       VALUES (@id, @tenantId, @sku, @name, 100, @now, @now)`,
      {
        id: `prod_collision_${attempt}`,
        tenantId: "tnt_demo",
        sku: `ROLLBACK-MATRIX-M${suffix}`,
        name: `Collision ${attempt}`,
        now,
      },
    );
  }

  const generated = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S", "M"] }],
  });
  assert.equal(generated.status, 409);
  assert.equal(generated.json.error.code, "conflict");

  const variants = await call(app, "GET", `/api/catalog/${master.json.id}/variants`);
  assert.equal(variants.json.items.length, 0);
  const rolledBackSku = await call(app, "GET", "/api/catalog/?limit=200");
  assert.ok(!rolledBackSku.json.items.some((product: any) => product.sku === "ROLLBACK-MATRIX-S"));
});

test("variants: reject nested master/child graphs", async () => {
  const app = await freshApp();

  const master = await call(app, "POST", "/api/catalog/", { sku: "NEST-MASTER", name: "Master", price_cents: 0 });
  const child = await call(app, "POST", "/api/catalog/", {
    sku: "NEST-CHILD",
    name: "Child",
    price_cents: 100,
    parent_product_id: master.json.id,
  });
  const grandchild = await call(app, "POST", "/api/catalog/", { sku: "NEST-GRAND", name: "Grandchild", price_cents: 100 });

  const childAsMaster = await call(app, "POST", `/api/catalog/${child.json.id}/variants/assign`, {
    productIds: [grandchild.json.id],
  });
  assert.equal(childAsMaster.status, 409);
  assert.equal(childAsMaster.json.error.code, "conflict");

  const masterAsChild = await call(app, "PATCH", `/api/catalog/${master.json.id}`, {
    parent_product_id: grandchild.json.id,
  });
  assert.equal(masterAsChild.status, 409);
  assert.equal(masterAsChild.json.error.code, "conflict");
});

test("a product cannot be assigned as its own variant parent", async () => {
  const app = await freshApp();
  const product = await call(app, "POST", "/api/catalog/", { sku: "SELF-VAR", name: "Self", price_cents: 100 });
  const { status, json } = await call(app, "PATCH", `/api/catalog/${product.json.id}`, { parent_product_id: product.json.id });
  assert.equal(status, 409);
  assert.equal(json.error.code, "conflict");
});

test("bulk-update applies a field change to many products at once (BE-7)", async () => {
  const app = await freshApp();
  const a = await call(app, "POST", "/api/catalog/", { sku: "BULK-A", name: "A", price_cents: 100, category: "general" });
  const b = await call(app, "POST", "/api/catalog/", { sku: "BULK-B", name: "B", price_cents: 200, category: "general" });

  const { status, json } = await call(app, "POST", "/api/catalog/bulk-update", {
    ids: [a.json.id, b.json.id],
    update: { category: "clearance", status: "draft" },
  });
  assert.equal(status, 200);
  assert.equal(json.updated, 2);
  assert.ok(json.items.every((p: any) => p.category === "clearance" && p.status === "draft"));
});

test("bulk-update is manager/owner-gated", async () => {
  const app = await freshApp();
  const { default: request } = await import("./test-request.js");
  const a = await call(app, "POST", "/api/catalog/", { sku: "GATE-A", name: "A", price_cents: 100 });
  const { status, json } = await request(app.express, "POST", "/api/catalog/bulk-update", { ids: [a.json.id], update: { category: "x" } }, "cashier");
  assert.equal(status, 403);
  assert.equal(json.error.code, "forbidden");
});

test("CSV export round-trips through CSV import (BE-7)", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/catalog/", { sku: "CSV-1", name: "Widget One", price_cents: 1000, category: "general", barcode: "1111111111111" });
  await call(app, "POST", "/api/catalog/", { sku: "CSV-2", name: "Widget, Two", price_cents: 2000, category: "general" });

  const exported = await call(app, "GET", "/api/catalog/export");
  assert.equal(exported.status, 200);
  assert.match(exported.json, /sku,name,price_cents/);
  assert.match(exported.json, /CSV-1/);
  assert.match(exported.json, /"Widget, Two"/); // comma-containing field is quoted

  // Re-import the exported CSV into a fresh app (header uses price_cents, which import-csv accepts).
  const app2 = await freshApp();
  const imported = await call(app2, "POST", "/api/catalog/import-csv", { csv: exported.json });
  assert.equal(imported.status, 200);
  assert.ok(imported.json.imported >= 2);

  const list = await call(app2, "GET", "/api/catalog/?limit=200");
  assert.ok(list.json.items.some((p: any) => p.sku === "CSV-1" && p.price_cents === 1000));
  assert.ok(list.json.items.some((p: any) => p.sku === "CSV-2" && p.name === "Widget, Two"));
});

test("import-csv rejects rows missing required fields", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/catalog/import-csv", { csv: "sku,name,priceCents\nBAD-1,,100" });
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
});

test("bulk-barcodes generates EAN-13 barcodes only for products missing one (BE-7)", async () => {
  const app = await freshApp();
  const withBarcode = await call(app, "POST", "/api/catalog/", { sku: "BC-HAS", name: "Has barcode", price_cents: 100, barcode: "9999999999999" });
  const withoutBarcode = await call(app, "POST", "/api/catalog/", { sku: "BC-NONE", name: "No barcode", price_cents: 100 });

  const { status, json } = await call(app, "POST", "/api/catalog/bulk-barcodes", { ids: [withBarcode.json.id, withoutBarcode.json.id] });
  assert.equal(status, 200);
  assert.equal(json.generated.length, 1);
  assert.equal(json.generated[0].id, withoutBarcode.json.id);
  assert.equal(json.generated[0].barcode.length, 13);

  const updated = await call(app, "GET", `/api/catalog/${withoutBarcode.json.id}`);
  assert.equal(updated.json.barcode, json.generated[0].barcode);
});

test("category mutations are manager/owner-gated", async () => {
  const app = await freshApp();
  const { default: request } = await import("./test-request.js");
  const { status, json } = await request(app.express, "POST", "/api/catalog/categories", { name: "Should Fail" }, "cashier");
  assert.equal(status, 403);
  assert.equal(json.error.code, "forbidden");
});

test("generated variant name uses the standardized separator, never '/' (#3)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "COKE", name: "Coca-Cola", price_cents: 0, category: "beverages" });
  const gen = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["330ml"] }, { name: "Pack", values: ["6ct"] }],
  });
  assert.equal(gen.status, 200);
  const v = gen.json.items[0];
  assert.equal(v.variant_label, "330ml - 6ct");     // one separator between values
  assert.equal(v.name, "Coca-Cola - 330ml - 6ct");  // master joined by the same separator
  assert.ok(!v.name.includes("/"));                 // never a slash
});

test("assigning a product as a variant inherits the master's category (#1)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "BEV-M", name: "Soda", price_cents: 0, category: "beverages" });
  const child = await call(app, "POST", "/api/catalog/", { sku: "BEV-C1", name: "Soda 1L", price_cents: 299, category: "general" });
  assert.equal(child.json.category, "general");
  await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, { productIds: [child.json.id] });
  const after = await call(app, "GET", `/api/catalog/${child.json.id}`);
  assert.equal(after.json.category, "beverages"); // inherited from master
});

test("a child variant's category cannot be changed independently (#1)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "BEV-M2", name: "Juice", price_cents: 0, category: "beverages" });
  const child = await call(app, "POST", "/api/catalog/", { sku: "BEV-C2", name: "Juice S", price_cents: 199, category: "beverages" });
  await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, { productIds: [child.json.id] });
  // Attempt to move just the child to another category — must be coerced back to the master's.
  const patched = await call(app, "PATCH", `/api/catalog/${child.json.id}`, { category: "electronics" });
  assert.equal(patched.json.category, "beverages");
});

test("changing a master's category cascades to all its variants (#1)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "BEV-M3", name: "Water", price_cents: 0, category: "beverages" });
  const c1 = await call(app, "POST", "/api/catalog/", { sku: "BEV-C3A", name: "Water 500ml", price_cents: 99, category: "beverages" });
  const c2 = await call(app, "POST", "/api/catalog/", { sku: "BEV-C3B", name: "Water 1L", price_cents: 149, category: "beverages" });
  await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, { productIds: [c1.json.id, c2.json.id] });
  await call(app, "PATCH", `/api/catalog/${master.json.id}`, { category: "groceries" });
  const variants = await call(app, "GET", `/api/catalog/${master.json.id}/variants`);
  assert.ok(variants.json.items.length === 2 && variants.json.items.every((v: any) => v.category === "groceries"));
});

async function mkMasterWith3Variants(app: App) {
  const master = await call(app, "POST", "/api/catalog/", { sku: "TEE", name: "Tee", price_cents: 0, category: "apparel" });
  const v1 = await call(app, "POST", "/api/catalog/", { sku: "TEE-S", name: "S", price_cents: 100 });
  const v2 = await call(app, "POST", "/api/catalog/", { sku: "TEE-M", name: "M", price_cents: 300 });
  const v3 = await call(app, "POST", "/api/catalog/", { sku: "TEE-L", name: "L", price_cents: 200 });
  await call(app, "POST", `/api/catalog/${master.json.id}/variants/assign`, { productIds: [v1.json.id, v2.json.id, v3.json.id] });
  return { master: master.json.id, v1: v1.json.id, v2: v2.json.id, v3: v3.json.id };
}

test("variant manual reorder is per-channel and independent (#3)", async () => {
  const app = await freshApp();
  const { master, v1, v2, v3 } = await mkMasterWith3Variants(app);
  const reordered = await call(app, "POST", `/api/catalog/${master}/variants/reorder`, { channel: "online", orderedIds: [v3, v1, v2] });
  assert.equal(reordered.status, 200);

  const online = await call(app, "GET", `/api/catalog/${master}/variants?channel=online`);
  assert.deepEqual(online.json.items.map((p: any) => p.id), [v3, v1, v2]); // manual order

  // Offline is untouched — still the default (sku) order, proving independence.
  const offline = await call(app, "GET", `/api/catalog/${master}/variants?channel=offline`);
  assert.deepEqual(offline.json.items.map((p: any) => p.id), [v3, v2, v1]); // TEE-L, TEE-M, TEE-S
});

test("variant sort mode price_asc orders by price (#3)", async () => {
  const app = await freshApp();
  const { master, v1, v2, v3 } = await mkMasterWith3Variants(app);
  const set = await call(app, "PATCH", `/api/catalog/${master}/variants/sort`, { channel: "online", mode: "price_asc" });
  assert.equal(set.status, 200);
  const online = await call(app, "GET", `/api/catalog/${master}/variants?channel=online`);
  assert.deepEqual(online.json.items.map((p: any) => p.id), [v1, v3, v2]); // 100, 200, 300
});

test("reorder rejects ids that are not the master's variants (#3)", async () => {
  const app = await freshApp();
  const { master, v1, v2 } = await mkMasterWith3Variants(app);
  const bad = await call(app, "POST", `/api/catalog/${master}/variants/reorder`, { channel: "online", orderedIds: [v1, v2] }); // missing one
  assert.equal(bad.status, 400);
});

test("variant sort/reorder require manager role (#3, #11)", async () => {
  const app = await freshApp();
  const { master, v1, v2, v3 } = await mkMasterWith3Variants(app);
  const { default: request } = await import("./test-request.js");
  const r = await request(app.express, "POST", `/api/catalog/${master}/variants/reorder`, { channel: "online", orderedIds: [v3, v1, v2] }, "cashier");
  assert.equal(r.status, 403);
});

test("bulk-price: increase selling price by percent (#4)", async () => {
  const app = await freshApp();
  const a = await call(app, "POST", "/api/catalog/", { sku: "BP-A", name: "A", price_cents: 100 });
  const b = await call(app, "POST", "/api/catalog/", { sku: "BP-B", name: "B", price_cents: 250 });
  const r = await call(app, "POST", "/api/catalog/bulk-price", { ids: [a.json.id, b.json.id], target: "selling", op: "inc_pct", value: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.json.updated, 2);
  const pa = await call(app, "GET", `/api/catalog/${a.json.id}`);
  const pb = await call(app, "GET", `/api/catalog/${b.json.id}`);
  assert.equal(pa.json.price_cents, 110);
  assert.equal(pb.json.price_cents, 275);
});

test("bulk-price: set exact cost across products (#4)", async () => {
  const app = await freshApp();
  const a = await call(app, "POST", "/api/catalog/", { sku: "BP-C", name: "C", price_cents: 100, raw_cost_price_cents: 40 });
  const b = await call(app, "POST", "/api/catalog/", { sku: "BP-D", name: "D", price_cents: 100 });
  await call(app, "POST", "/api/catalog/bulk-price", { ids: [a.json.id, b.json.id], target: "cost", op: "set", value: 55 });
  const pa = await call(app, "GET", `/api/catalog/${a.json.id}`);
  const pb = await call(app, "GET", `/api/catalog/${b.json.id}`);
  assert.equal(pa.json.raw_cost_price_cents, 55);
  assert.equal(pb.json.raw_cost_price_cents, 55);
});

test("bulk-price: round to .99 and clamp at zero (#4)", async () => {
  const app = await freshApp();
  const a = await call(app, "POST", "/api/catalog/", { sku: "BP-E", name: "E", price_cents: 149 });
  const b = await call(app, "POST", "/api/catalog/", { sku: "BP-F", name: "F", price_cents: 300 });
  await call(app, "POST", "/api/catalog/bulk-price", { ids: [a.json.id, b.json.id], target: "selling", op: "round_99" });
  assert.equal((await call(app, "GET", `/api/catalog/${a.json.id}`)).json.price_cents, 199); // 1.49 -> 1.99
  assert.equal((await call(app, "GET", `/api/catalog/${b.json.id}`)).json.price_cents, 399); // 3.00 -> 3.99
  // Decrease by a fixed amount larger than the price clamps to 0, never negative.
  await call(app, "POST", "/api/catalog/bulk-price", { ids: [a.json.id], target: "selling", op: "dec_amount", value: 100000 });
  assert.equal((await call(app, "GET", `/api/catalog/${a.json.id}`)).json.price_cents, 0);
});

test("bulk-price requires a value for non-round ops and manager role (#4, #11)", async () => {
  const app = await freshApp();
  const a = await call(app, "POST", "/api/catalog/", { sku: "BP-G", name: "G", price_cents: 100 });
  const missing = await call(app, "POST", "/api/catalog/bulk-price", { ids: [a.json.id], target: "selling", op: "inc_pct" });
  assert.equal(missing.status, 400);
  const { default: request } = await import("./test-request.js");
  const denied = await request(app.express, "POST", "/api/catalog/bulk-price", { ids: [a.json.id], target: "selling", op: "set", value: 10 }, "cashier");
  assert.equal(denied.status, 403);
});

// ── Variant engine foundation: structured options + non-destructive regen ──────

test("generate stores structured variant_options per child (#1/#8)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "OPT-M", name: "Tee", price_cents: 2000, category: "apparel" });
  const gen = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Red"] }],
  });
  const v = gen.json.items[0];
  assert.deepEqual(JSON.parse(v.variant_options), { Size: "S", Color: "Red" });
  assert.equal(v.variant_label, "S - Red");
  assert.equal(v.name, "Tee - S - Red");
});

test("re-generating with an added value keeps existing variants (same id/sku) and only adds the new one (#6)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "REG-M", name: "Tee", price_cents: 2000, category: "apparel" });
  const first = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S", "M"] }],
  });
  const sVar = first.json.items.find((p: any) => p.variant_label === "S");
  // Give the existing S variant a distinct SKU/price/upc/inventory-ish marker to prove preservation.
  await call(app, "PATCH", `/api/catalog/${sVar.id}`, { price_cents: 9999, barcode: "111222333" });

  const second = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S", "M", "L"] }],
  });
  assert.equal(second.json.items.length, 3); // S, M preserved + L added — never duplicated
  const sAfter = second.json.items.find((p: any) => p.variant_label === "S");
  assert.equal(sAfter.id, sVar.id);          // same variant, updated in place
  assert.equal(sAfter.sku, sVar.sku);        // SKU preserved
  assert.equal(sAfter.price_cents, 9999);    // pricing preserved
  assert.equal(sAfter.barcode, "111222333"); // upc/barcode preserved
});

test("re-generating with a changed attribute order does not duplicate (order-independent identity) (#4/#6)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "ORD-M", name: "Tee", price_cents: 2000, category: "apparel" });
  const first = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S"] }, { name: "Color", values: ["Red"] }],
  });
  const id1 = first.json.items[0].id;
  // Same combo, attributes listed in the opposite order → naming flips but identity holds.
  const second = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Color", values: ["Red"] }, { name: "Size", values: ["S"] }],
  });
  assert.equal(second.json.items.length, 1);      // not duplicated
  assert.equal(second.json.items[0].id, id1);     // same variant
  assert.equal(second.json.items[0].variant_label, "Red - S"); // name follows new order
});

test("editing a variant's options updates its name/label in place, preserving id and sku (#4)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "EDIT-M", name: "Tee", price_cents: 2000, category: "apparel" });
  const gen = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["S"] }],
  });
  const v = gen.json.items[0];
  const patched = await call(app, "PATCH", `/api/catalog/${v.id}`, { variant_options: JSON.stringify({ Size: "M" }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.id, v.id);              // never recreated
  assert.equal(patched.json.sku, v.sku);            // sku preserved
  assert.equal(patched.json.variant_label, "M");    // label recomputed
  assert.equal(patched.json.name, "Tee - M");       // name recomputed
});
