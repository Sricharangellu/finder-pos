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

async function mkProduct(app: App, sku: string, name: string) {
  const r = await call(app, "POST", "/api/catalog/", { sku, name, price_cents: 1000, category: "general" });
  assert.equal(r.status, 201, `catalog create failed: ${JSON.stringify(r.json)}`);
  return r.json as { id: string };
}

async function mkCustomer(app: App, name: string, email?: string) {
  const r = await call(app, "POST", "/api/customers/", { name, email });
  assert.equal(r.status, 201, `customer create failed: ${JSON.stringify(r.json)}`);
  return r.json as { id: string };
}

async function mkSupplier(app: App, name: string) {
  const r = await call(app, "POST", "/api/purchasing/suppliers", { name });
  assert.equal(r.status, 201, `supplier create failed: ${JSON.stringify(r.json)}`);
  return r.json as { id: string };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("empty query is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/search/?q=", undefined);
  assert.equal(r.status, 400);
});

test("whitespace-only query is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/search/?q=%20%20", undefined);
  assert.equal(r.status, 400);
});

test("search returns grouped results structure", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/search/?q=anything", undefined);
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.query, "string");
  assert.equal(typeof r.json.results, "object");
  // All groups are always present even when empty
  assert.ok(Array.isArray(r.json.results.products));
  assert.ok(Array.isArray(r.json.results.customers));
  assert.ok(Array.isArray(r.json.results.vendors));
  assert.ok(Array.isArray(r.json.results.invoices));
});

test("product search finds by name", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "WDG-001", "Blue Widget");

  const r = await call(app, "GET", "/api/search/?q=Blue+Widget", undefined);
  assert.equal(r.status, 200);
  assert.ok(
    r.json.results.products.some((p: { id: string; type: string }) => p.id === prod.id && p.type === "product"),
  );
});

test("product search finds by SKU", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "UNIQUE-SKU-XYZ", "Some Product");

  const r = await call(app, "GET", "/api/search/?q=UNIQUE-SKU-XYZ", undefined);
  assert.equal(r.status, 200);
  assert.ok(r.json.results.products.some((p: { id: string }) => p.id === prod.id));
});

test("customer search finds by name", async () => {
  const app = await freshApp();
  const cus = await mkCustomer(app, "Archipelago Corp");

  const r = await call(app, "GET", "/api/search/?q=Archipelago", undefined);
  assert.equal(r.status, 200);
  assert.ok(
    r.json.results.customers.some((c: { id: string; type: string }) => c.id === cus.id && c.type === "customer"),
  );
});

test("customer search finds by email", async () => {
  const app = await freshApp();
  const cus = await mkCustomer(app, "Jane Doe", "jane@uniquedomain.io");

  const r = await call(app, "GET", "/api/search/?q=uniquedomain.io", undefined);
  assert.equal(r.status, 200);
  assert.ok(r.json.results.customers.some((c: { id: string }) => c.id === cus.id));
});

test("vendor search finds by name", async () => {
  const app = await freshApp();
  const sup = await mkSupplier(app, "PrecisionParts Wholesale");

  const r = await call(app, "GET", "/api/search/?q=PrecisionParts", undefined);
  assert.equal(r.status, 200);
  assert.ok(r.json.results.vendors.some((v: { id: string; type: string }) => v.id === sup.id && v.type === "vendor"));
});

test("type filter restricts results to a single group", async () => {
  const app = await freshApp();
  await mkProduct(app, "FILT-1", "Filter Test Product");
  await mkCustomer(app, "Filter Test Customer");

  // Only request products
  const r = await call(app, "GET", "/api/search/?q=Filter+Test&type=product", undefined);
  assert.equal(r.status, 200);
  // products group should be populated
  assert.ok(r.json.results.products.length > 0);
  // customer group should be absent or empty when type filter is active
  assert.ok(!r.json.results.customers || r.json.results.customers.length === 0);
});

test("search is case-insensitive", async () => {
  const app = await freshApp();
  const prod = await mkProduct(app, "CASE-1", "CaseSensitiveItem");

  const lower = await call(app, "GET", "/api/search/?q=casesensitiveitem", undefined);
  assert.ok(lower.json.results.products.some((p: { id: string }) => p.id === prod.id));

  const upper = await call(app, "GET", "/api/search/?q=CASESENSITIVEITEM", undefined);
  assert.ok(upper.json.results.products.some((p: { id: string }) => p.id === prod.id));
});

test("search result hits include label and sublabel", async () => {
  const app = await freshApp();
  await mkProduct(app, "LBL-1", "Labelled Product");

  const r = await call(app, "GET", "/api/search/?q=Labelled", undefined);
  const hit = r.json.results.products[0] as { label: string; sublabel: string };
  assert.ok(typeof hit.label === "string" && hit.label.length > 0);
  assert.ok(typeof hit.sublabel === "string" && hit.sublabel.length > 0); // sublabel = SKU
});

test("no results returns empty arrays, not 404", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/search/?q=zzz_no_match_xyz_9999", undefined);
  assert.equal(r.status, 200);
  assert.equal(r.json.results.products.length, 0);
  assert.equal(r.json.results.customers.length, 0);
});
