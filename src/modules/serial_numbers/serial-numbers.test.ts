import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

// Per-test schema isolation against the shared Postgres instance.
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
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

async function makeProduct(app: App, sku: string): Promise<string> {
  const { status, json } = await call(app, "POST", "/api/catalog/", {
    sku, name: `Product ${sku}`, price_cents: 1000, raw_cost_price_cents: 500,
  });
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id;
}

// Regression: list()/get() joined a table called `catalog_products` that does
// not exist anywhere in the schema (the real catalog table is `products`) —
// every call 500'd against a real Postgres database. Fixed to join `products`.
// These are the first tests this module has ever had.

test("serials: list joins product name/sku without erroring (catalog_products regression)", async () => {
  const app = await freshApp();
  const productId = await makeProduct(app, "SN-1");

  const receive = await call(app, "POST", "/api/inventory/serials", {
    product_id: productId, serial: "SN-0001",
  });
  assert.equal(receive.status, 201, `receive failed: ${JSON.stringify(receive.json)}`);
  assert.equal(receive.json.status, "in_stock");

  const list = await call(app, "GET", "/api/inventory/serials");
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  const row = list.json.items[0];
  assert.equal(row.serial, "SN-0001");
  assert.equal(row.product_name, `Product SN-1`);
  assert.equal(row.product_sku, "SN-1");
});

test("serials: get by id joins product name/sku without erroring", async () => {
  const app = await freshApp();
  const productId = await makeProduct(app, "SN-2");
  const receive = await call(app, "POST", "/api/inventory/serials", {
    product_id: productId, serial: "SN-0002",
  });
  assert.equal(receive.status, 201);

  const get = await call(app, "GET", `/api/inventory/serials/${receive.json.id}`);
  assert.equal(get.status, 200);
  assert.equal(get.json.product_name, "Product SN-2");
  assert.equal(get.json.product_sku, "SN-2");
});

test("serials: update status", async () => {
  const app = await freshApp();
  const productId = await makeProduct(app, "SN-3");
  const receive = await call(app, "POST", "/api/inventory/serials", {
    product_id: productId, serial: "SN-0003",
  });
  const patch = await call(app, "PATCH", `/api/inventory/serials/${receive.json.id}`, {
    status: "sold",
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.status, "sold");
});
