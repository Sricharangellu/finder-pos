/**
 * store_locations.test.ts — integration coverage for store_locations
 * (aisle/shelf/bin placement + product-to-location assignment).
 *
 * Covers: location CRUD, product-location assignment (single + bulk), the
 * store-map aggregate view, validation (400s), 404s, role gating, and tenant
 * isolation, all against real embedded Postgres.
 *
 * Also a regression proof for a real bug found while writing these tests:
 * this module's own `product_locations` table collided with an
 * already-registered, incompatible `product_locations` table owned by the
 * `fulfillment` module (single pick-location per product, no id/qty/notes
 * columns). Because `fulfillment` registers earlier in
 * src/modules/index.ts, its schema won the `CREATE TABLE IF NOT EXISTS`
 * race and every store_locations product-assignment write 500'd — the same
 * failure class as the `quotes` vs. `sales` `quotations` collision. Fixed by
 * renaming this module's table to `store_location_products`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

function tokenFor(tenantId: string, role: "owner" | "manager" | "cashier"): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign({ sub: `usr_${tenantId}_${role}`, tenantId, role }, secret, { expiresIn: "1h" });
}
function callAs(
  app: App,
  method: string,
  path: string,
  tenantId: string,
  role: "owner" | "manager" | "cashier",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const full = path.startsWith("/api/v1/") ? path : path.replace("/api/", "/api/v1/");
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") { server.close(); reject(new Error("bind failed")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1", port: address.port, path: full, method,
          headers: {
            authorization: `Bearer ${tokenFor(tenantId, role)}`,
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }); });
        },
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// A real product row must exist for product-location assignment FKs (there's
// no formal FK constraint, but the joined SELECT in listProductLocations does
// an inner JOIN on products, so an unknown product_id would silently vanish
// from list output rather than 404 — seed a real one via /api/v1/catalog).
async function seedProduct(app: App, tenantId: string): Promise<string> {
  const r = await callAs(app, "POST", "/api/v1/catalog", tenantId, "owner", {
    sku: `SL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "Store Location Test Widget",
    price_cents: 999,
    category: "general",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

// ─── Location CRUD ──────────────────────────────────────────────────────────

test("store_locations: create computes label, get/list/update/delete round-trip", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/store-locations", { aisle: "a1", shelf: "s2", bin: "b3", description: "back corner" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.label, "A1-s2-b3");
  assert.equal(created.json.aisle, "a1");
  const id = created.json.id;

  const list = await call(app, "GET", "/api/store-locations");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((l: any) => l.id === id));

  const patched = await call(app, "PATCH", `/api/store-locations/${id}`, { shelf: "s9" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.shelf, "s9");
  assert.equal(patched.json.label, "A1-s9-b3", "label recomputed on update");

  const del = await call(app, "DELETE", `/api/store-locations/${id}`);
  assert.equal(del.status, 204);

  const after = await call(app, "GET", "/api/store-locations");
  assert.ok(!after.json.items.some((l: any) => l.id === id));
});

test("store_locations: label omits empty shelf/bin segments", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/store-locations", { aisle: "b7" });
  assert.equal(created.status, 201);
  assert.equal(created.json.label, "B7");
});

// ─── Validation (400s) ──────────────────────────────────────────────────────

test("store_locations: create rejects missing/empty aisle", async () => {
  const app = await freshApp();
  const r1 = await call(app, "POST", "/api/store-locations", { shelf: "s1" });
  assert.equal(r1.status, 400);
  const r2 = await call(app, "POST", "/api/store-locations", { aisle: "" });
  assert.equal(r2.status, 400);
});

test("store_locations: product-location assignment rejects missing product_id/location_id", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/product-locations", { product_id: "", location_id: "" });
  assert.equal(r.status, 400);
});

test("store_locations: bulk assign rejects empty assignments array", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/product-locations/bulk", { assignments: [] });
  assert.equal(r.status, 400);
});

test("store_locations: DELETE /product-locations without query params returns 400", async () => {
  const app = await freshApp();
  const r = await call(app, "DELETE", "/api/product-locations");
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "missing_params");
});

// ─── 404s ───────────────────────────────────────────────────────────────────

test("store_locations: 404 for get(unused)/patch/delete on an unknown id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/store-locations/loc_missing", { aisle: "z1" })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/store-locations/loc_missing")).status, 404);
});

// ─── Product-location assignment + store map (regression: table collision) ─

test("store_locations: assign a product to a location, list by product/location, remove", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const loc = (await call(app, "POST", "/api/store-locations", { aisle: "a2", shelf: "s1" })).json;

  const assigned = await call(app, "POST", "/api/product-locations", {
    product_id: productId, location_id: loc.id, qty_at_location: 5, notes: "front shelf",
  });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.json));
  assert.equal(assigned.json.qty_at_location, 5);

  const byProduct = await call(app, "GET", `/api/product-locations?product_id=${productId}`);
  assert.equal(byProduct.status, 200);
  assert.equal(byProduct.json.items.length, 1);
  assert.equal(byProduct.json.items[0].location_id, loc.id);
  assert.equal(byProduct.json.items[0].aisle, "a2", "joined location fields present");
  assert.equal(byProduct.json.items[0].product_sku !== undefined, true, "joined product fields present");

  const byLocation = await call(app, "GET", `/api/product-locations?location_id=${loc.id}`);
  assert.equal(byLocation.status, 200);
  assert.equal(byLocation.json.items.length, 1);

  // Re-assigning the same (product, location) pair updates qty in place (upsert).
  const reassigned = await call(app, "POST", "/api/product-locations", {
    product_id: productId, location_id: loc.id, qty_at_location: 12,
  });
  assert.equal(reassigned.status, 201);
  assert.equal(reassigned.json.qty_at_location, 12);
  assert.equal(reassigned.json.notes, "front shelf", "notes preserved when omitted on upsert");

  const removed = await call(app, "DELETE", `/api/product-locations?product_id=${productId}&location_id=${loc.id}`);
  assert.equal(removed.status, 204);
  const afterRemove = await call(app, "GET", `/api/product-locations?product_id=${productId}`);
  assert.equal(afterRemove.json.items.length, 0);
});

test("store_locations: bulk assign multiple products to locations", async () => {
  const app = await freshApp();
  const p1 = await seedProduct(app, "tnt_demo");
  const p2 = await seedProduct(app, "tnt_demo");
  const loc = (await call(app, "POST", "/api/store-locations", { aisle: "a3" })).json;

  const bulk = await call(app, "POST", "/api/product-locations/bulk", {
    assignments: [
      { product_id: p1, location_id: loc.id },
      { product_id: p2, location_id: loc.id, notes: "bulk note" },
    ],
  });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.json));
  assert.equal(bulk.json.assigned, 2);

  const byLocation = await call(app, "GET", `/api/product-locations?location_id=${loc.id}`);
  assert.equal(byLocation.json.items.length, 2);
});

test("store_locations: store map groups locations by aisle/shelf with assigned products", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const loc = (await call(app, "POST", "/api/store-locations", { aisle: "m1", shelf: "top" })).json;
  await call(app, "POST", "/api/product-locations", { product_id: productId, location_id: loc.id, qty_at_location: 3 });

  const map = await call(app, "GET", "/api/store-locations/map");
  assert.equal(map.status, 200);
  const aisle = map.json.aisles.find((a: any) => a.name === "m1");
  assert.ok(aisle, "aisle m1 present in map");
  const shelf = aisle.shelves.find((s: any) => s.name === "top");
  assert.ok(shelf, "shelf 'top' present");
  const bin = shelf.bins.find((b: any) => b.location.id === loc.id);
  assert.ok(bin, "bin present with the created location");
  assert.equal(bin.products.length, 1);
  assert.equal(bin.products[0].product_id, productId);
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("store_locations: cashier is rejected (403) from location + assignment mutations, but reads are open", async () => {
  const app = await freshApp();
  const createByCashier = await callAs(app, "POST", "/api/v1/store-locations", "tnt_demo", "cashier", { aisle: "c1" });
  assert.equal(createByCashier.status, 403);

  const loc = (await call(app, "POST", "/api/store-locations", { aisle: "c2" })).json;
  const patchByCashier = await callAs(app, "PATCH", `/api/v1/store-locations/${loc.id}`, "tnt_demo", "cashier", { shelf: "x" });
  assert.equal(patchByCashier.status, 403);

  const deleteByCashier = await callAs(app, "DELETE", `/api/v1/store-locations/${loc.id}`, "tnt_demo", "cashier");
  assert.equal(deleteByCashier.status, 403);

  const assignByCashier = await callAs(app, "POST", "/api/v1/product-locations", "tnt_demo", "cashier", { product_id: "p1", location_id: loc.id });
  assert.equal(assignByCashier.status, 403);

  // Reads have no requireRole guard — cashier can list.
  const readByCashier = await callAs(app, "GET", "/api/v1/store-locations", "tnt_demo", "cashier");
  assert.equal(readByCashier.status, 200);
});

test("store_locations: manager (not just owner) can create/patch/delete", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/store-locations", "tnt_demo", "manager", { aisle: "mg1" });
  assert.equal(created.status, 201);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("store_locations: tenant isolation — a location + assignment created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const loc = (await callAs(app, "POST", "/api/v1/store-locations", "tnt_demo", "owner", { aisle: "iso1" })).json;
  await callAs(app, "POST", "/api/v1/product-locations", "tnt_demo", "owner", { product_id: productId, location_id: loc.id, qty_at_location: 4 });

  const crossList = await callAs(app, "GET", "/api/v1/store-locations", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.ok(!crossList.json.items.some((l: any) => l.id === loc.id), "cross-tenant list must not leak the location");

  const crossPatch = await callAs(app, "PATCH", `/api/v1/store-locations/${loc.id}`, "tnt_other", "owner", { shelf: "hack" });
  assert.equal(crossPatch.status, 404, "cross-tenant patch must 404");

  const crossDelete = await callAs(app, "DELETE", `/api/v1/store-locations/${loc.id}`, "tnt_other", "owner");
  assert.equal(crossDelete.status, 404, "cross-tenant delete must 404");

  const crossProductList = await callAs(app, "GET", `/api/v1/product-locations?location_id=${loc.id}`, "tnt_other", "owner");
  assert.equal(crossProductList.status, 200);
  assert.equal(crossProductList.json.items.length, 0, "cross-tenant product-location list must not leak rows");

  // Original tenant still sees it, untouched.
  const ownList = await callAs(app, "GET", "/api/v1/store-locations", "tnt_demo", "owner");
  assert.ok(ownList.json.items.some((l: any) => l.id === loc.id));
});
