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

// ─── Seed Defaults ────────────────────────────────────────────────────────────

test("seed defaults populates shipping, terms, and modes", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/seed", {});
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  const sm = await call(app, "GET", "/api/settings/shipping-methods");
  assert.ok(sm.json.items.length >= 2, "at least 2 shipping methods seeded");

  const pt = await call(app, "GET", "/api/settings/payment-terms");
  assert.ok(pt.json.items.length >= 3, "at least 3 payment terms seeded");

  const pm = await call(app, "GET", "/api/settings/payment-modes");
  assert.ok(pm.json.items.length >= 5, "at least 5 payment modes seeded");
});

test("seed defaults is idempotent", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/settings/seed", {});
  await call(app, "POST", "/api/settings/seed", {});

  const sm = await call(app, "GET", "/api/settings/shipping-methods");
  // Second seed should not double-insert
  assert.ok(sm.json.items.length === 2, "still exactly 2 after double seed");
});

// ─── Shipping Methods ─────────────────────────────────────────────────────────

test("create a shipping method and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/shipping-methods", {
    name: "Express Delivery",
    amountCents: 2500,
    freeLimitCents: 10000,
    ecommerce: true,
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("shm_"));
  assert.equal(r.json.name, "Express Delivery");
  assert.equal(r.json.amount_cents, 2500);
  assert.equal(r.json.free_limit_cents, 10000);
  assert.equal(r.json.ecommerce, 1);

  const list = await call(app, "GET", "/api/settings/shipping-methods");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((s: { id: string }) => s.id === r.json.id));
});

test("delete a shipping method", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/settings/shipping-methods", { name: "Trash Me", amountCents: 0 })).json;

  const del = await call(app, "DELETE", `/api/settings/shipping-methods/${created.id}`, undefined);
  assert.equal(del.status, 200);
  assert.equal(del.json.ok, true);

  const list = await call(app, "GET", "/api/settings/shipping-methods");
  assert.ok(!list.json.items.some((s: { id: string }) => s.id === created.id));
});

test("delete nonexistent shipping method returns 404", async () => {
  const app = await freshApp();
  const r = await call(app, "DELETE", "/api/settings/shipping-methods/shm_nonexistent", undefined);
  assert.equal(r.status, 404);
});

// ─── Payment Terms ────────────────────────────────────────────────────────────

test("create a payment term and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/payment-terms", {
    name: "Net 60",
    daysDue: 60,
    description: "Due in 60 days",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("pt_"));
  assert.equal(r.json.name, "Net 60");
  assert.equal(r.json.days_due, 60);
  assert.equal(r.json.description, "Due in 60 days");

  const list = await call(app, "GET", "/api/settings/payment-terms");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((t: { id: string }) => t.id === r.json.id));
});

// ─── Payment Modes ────────────────────────────────────────────────────────────

test("create a payment mode and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/payment-modes", { name: "Crypto" });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("pm_"));
  assert.equal(r.json.name, "Crypto");
  assert.equal(r.json.active, 1);

  const list = await call(app, "GET", "/api/settings/payment-modes");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((m: { id: string }) => m.id === r.json.id));
});

// ─── Tax Rates ────────────────────────────────────────────────────────────────

test("create a tax rate and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/tax-rates", {
    name: "CA Sales Tax",
    rateBps: 725,      // 7.25%
    state: "CA",
    applyToCategory: "general",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("tax_"));
  assert.equal(r.json.name, "CA Sales Tax");
  assert.equal(r.json.rate_bps, 725);
  assert.equal(r.json.state, "CA");
  assert.equal(r.json.apply_to_category, "general");

  const list = await call(app, "GET", "/api/settings/tax-rates");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((t: { id: string }) => t.id === r.json.id));
});

test("tax rate without category or state is valid", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/tax-rates", { name: "Global VAT", rateBps: 2000 });
  assert.equal(r.status, 201);
  assert.equal(r.json.state, null);
  assert.equal(r.json.apply_to_category, null);
});

// ─── Business Profile ─────────────────────────────────────────────────────────

test("get and update business profile", async () => {
  const app = await freshApp();

  // Fresh profile is empty
  const empty = await call(app, "GET", "/api/settings/business");
  assert.equal(empty.status, 200);

  // PUT merges fields
  const updated = await call(app, "PUT", "/api/settings/business", {
    name: "Acme Corp",
    address: "123 Main St",
    phone: "555-1234",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.name, "Acme Corp");

  // GET returns the merged profile
  const fetched = await call(app, "GET", "/api/settings/business");
  assert.equal(fetched.json.name, "Acme Corp");
  assert.equal(fetched.json.phone, "555-1234");
});

test("PATCH business profile merges rather than replaces", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/settings/business", { name: "Acme", city: "LA" });
  const patched = await call(app, "PATCH", "/api/settings/business", { city: "SF" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.name, "Acme");
  assert.equal(patched.json.city, "SF");
});

// ─── Feature Flags ────────────────────────────────────────────────────────────

test("get and update feature flags", async () => {
  const app = await freshApp();

  const flags = await call(app, "GET", "/api/settings/feature-flags");
  assert.equal(flags.status, 200);

  // Enable a flag
  const updated = await call(app, "PUT", "/api/settings/feature-flags", { ecommerce: true, batchDeposits: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.ecommerce, true);
  assert.equal(updated.json.batchDeposits, false);

  // Verify persistence
  const re = await call(app, "GET", "/api/settings/feature-flags");
  assert.equal(re.json.ecommerce, true);
  assert.equal(re.json.batchDeposits, false);
});

// ─── Edition Presets ──────────────────────────────────────────────────────────

test("set edition to retail enables groupRetailPOS only", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "retail" });
  assert.equal(r.status, 200);
  assert.equal(r.json.groupRetailPOS, true);
  assert.equal(r.json.groupWholesale, false);
  assert.equal(r.json.groupEnterprise, false);
});

test("set edition to enterprise enables all groups", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "enterprise" });
  assert.equal(r.status, 200);
  assert.equal(r.json.groupRetailPOS, true);
  assert.equal(r.json.groupWholesale, true);
  assert.equal(r.json.groupEnterprise, true);
});

test("invalid edition is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "invalid" });
  assert.equal(r.status, 400);
});
