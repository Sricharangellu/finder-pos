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
  assert.deepEqual(generated.json.items.map((p: any) => p.variant_label).sort(), ["M / Black", "S / Black"]);
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

test("generated variant name has no hyphen between master and label (#8)", async () => {
  const app = await freshApp();
  const master = await call(app, "POST", "/api/catalog/", { sku: "COKE", name: "Coca-Cola", price_cents: 0, category: "beverages" });
  const gen = await call(app, "POST", `/api/catalog/${master.json.id}/variants/generate`, {
    attributes: [{ name: "Size", values: ["330ml"] }],
  });
  assert.equal(gen.status, 200);
  const v = gen.json.items.find((p: any) => p.variant_label === "330ml");
  assert.equal(v.name, "Coca-Cola 330ml"); // not "Coca-Cola - 330ml"
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
