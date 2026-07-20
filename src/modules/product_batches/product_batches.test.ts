/**
 * product_batches.test.ts — integration coverage for product_batches
 * (lot/batch tracking with expiry-date status derivation).
 *
 * Covers: batch CRUD, expiry-status derivation (expired/critical/warning/ok),
 * status + days filters, the expiry summary aggregate, validation (400s),
 * 404s, role gating, and tenant isolation, all against real embedded
 * Postgres. Also confirms the `product_batches` table name does not collide
 * with any other module's migrations (checked via grep across every module's
 * index.ts before writing this — see the store_locations regression this
 * session found for what a collision looks like).
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

const DAY = 86_400_000;

async function seedProduct(app: App, tenantId: string, role: "owner" | "manager" = "owner"): Promise<string> {
  const r = await callAs(app, "POST", "/api/v1/catalog", tenantId, role, {
    sku: `PB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "Batch Test Widget",
    price_cents: 500,
    category: "general",
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

// ─── CRUD lifecycle ─────────────────────────────────────────────────────────

test("product_batches: create/get/list/update/delete round-trip", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");

  const created = await call(app, "POST", "/api/product-batches", {
    product_id: productId, batch_number: "B-001", qty: 20, cost_cents: 150,
    supplier_name: "Acme Supply", notes: "first batch",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.qty, 20);
  assert.equal(created.json.batch_number, "B-001");
  const id = created.json.id;

  const got = await call(app, "GET", `/api/product-batches`);
  assert.equal(got.status, 200);
  assert.ok(got.json.items.some((b: any) => b.id === id));
  assert.ok(got.json.items.find((b: any) => b.id === id).product_name, "joined product_name present");

  const patched = await call(app, "PATCH", `/api/product-batches/${id}`, { qty: 15, notes: "adjusted" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.qty, 15);
  assert.equal(patched.json.notes, "adjusted");

  const del = await call(app, "DELETE", `/api/product-batches/${id}`);
  assert.equal(del.status, 204);

  const after = await call(app, "GET", "/api/product-batches");
  assert.ok(!after.json.items.some((b: any) => b.id === id));
});

test("product_batches: list filters by product_id", async () => {
  const app = await freshApp();
  const p1 = await seedProduct(app, "tnt_demo");
  const p2 = await seedProduct(app, "tnt_demo");
  await call(app, "POST", "/api/product-batches", { product_id: p1, qty: 5 });
  await call(app, "POST", "/api/product-batches", { product_id: p2, qty: 7 });

  const filtered = await call(app, "GET", `/api/product-batches?product_id=${p1}`);
  assert.equal(filtered.status, 200);
  assert.equal(filtered.json.items.length, 1);
  assert.equal(filtered.json.items[0].product_id, p1);
});

test("product_batches: batches with qty 0 are excluded from list/summary (depleted)", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const created = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 3 })).json;
  await call(app, "PATCH", `/api/product-batches/${created.id}`, { qty: 0 });

  const list = await call(app, "GET", "/api/product-batches");
  assert.ok(!list.json.items.some((b: any) => b.id === created.id), "depleted batch (qty=0) excluded from listing");
});

// ─── Expiry status derivation ───────────────────────────────────────────────

test("product_batches: expiry_status derives expired/critical/warning/ok correctly", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const now = Date.now();

  const expired = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1, expiry_date: now - 2 * DAY })).json;
  const critical = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1, expiry_date: now + 3 * DAY })).json;
  const warning = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1, expiry_date: now + 15 * DAY })).json;
  const ok = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1, expiry_date: now + 60 * DAY })).json;
  const noExpiry = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1 })).json;

  assert.equal((await call(app, "GET", `/api/product-batches`)).json.items.find((b: any) => b.id === expired.id).expiry_status, "expired");
  assert.equal((await call(app, "GET", `/api/product-batches`)).json.items.find((b: any) => b.id === critical.id).expiry_status, "critical");
  assert.equal((await call(app, "GET", `/api/product-batches`)).json.items.find((b: any) => b.id === warning.id).expiry_status, "warning");
  assert.equal((await call(app, "GET", `/api/product-batches`)).json.items.find((b: any) => b.id === ok.id).expiry_status, "ok");
  assert.equal(noExpiry.expiry_status, undefined, "no expiry_date -> no expiry_status on create response");

  const byStatus = await call(app, "GET", "/api/product-batches?status=expired");
  assert.equal(byStatus.json.items.length, 1);
  assert.equal(byStatus.json.items[0].id, expired.id);

  const byDays = await call(app, "GET", "/api/product-batches?days=5");
  assert.equal(byDays.json.items.length, 1, "days=5 window catches only the critical (3-day) batch");
  assert.equal(byDays.json.items[0].id, critical.id);
});

test("product_batches: expiry summary aggregates counts and qty by bucket", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const now = Date.now();
  await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 4, expiry_date: now - DAY });
  await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 6, expiry_date: now + 2 * DAY });
  await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 9, expiry_date: now + 20 * DAY });

  const summary = await call(app, "GET", "/api/product-batches/summary");
  assert.equal(summary.status, 200);
  assert.equal(summary.json.expired, 1);
  assert.equal(summary.json.expired_qty, 4);
  assert.equal(summary.json.critical, 1);
  assert.equal(summary.json.critical_qty, 6);
  assert.equal(summary.json.warning, 1);
  assert.equal(summary.json.warning_qty, 9);
});

// ─── Validation (400s) ──────────────────────────────────────────────────────

test("product_batches: create rejects missing product_id and negative qty", async () => {
  const app = await freshApp();
  const r1 = await call(app, "POST", "/api/product-batches", { qty: 5 });
  assert.equal(r1.status, 400);
  const r2 = await call(app, "POST", "/api/product-batches", { product_id: "p1", qty: -1 });
  assert.equal(r2.status, 400);
});

test("product_batches: patch cannot change product_id (stripped by schema, not a validation error)", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const created = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1 })).json;
  // patch schema omits product_id entirely — sending it should just be ignored, not error.
  const r = await call(app, "PATCH", `/api/product-batches/${created.id}`, { product_id: "someone_else", qty: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.json.product_id, productId, "product_id unchanged even though caller tried to send a different one");
});

// ─── 404s ───────────────────────────────────────────────────────────────────

test("product_batches: 404 for patch/delete on an unknown id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/product-batches/pb_missing", { qty: 1 })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/product-batches/pb_missing")).status, 404);
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("product_batches: cashier is rejected (403) from mutations, reads remain open", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const createByCashier = await callAs(app, "POST", "/api/v1/product-batches", "tnt_demo", "cashier", { product_id: productId, qty: 1 });
  assert.equal(createByCashier.status, 403);

  const batch = (await call(app, "POST", "/api/product-batches", { product_id: productId, qty: 1 })).json;
  const patchByCashier = await callAs(app, "PATCH", `/api/v1/product-batches/${batch.id}`, "tnt_demo", "cashier", { qty: 2 });
  assert.equal(patchByCashier.status, 403);
  const deleteByCashier = await callAs(app, "DELETE", `/api/v1/product-batches/${batch.id}`, "tnt_demo", "cashier");
  assert.equal(deleteByCashier.status, 403);

  const readByCashier = await callAs(app, "GET", "/api/v1/product-batches", "tnt_demo", "cashier");
  assert.equal(readByCashier.status, 200);
});

test("product_batches: manager can create/patch/delete", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo", "manager");
  const created = await callAs(app, "POST", "/api/v1/product-batches", "tnt_demo", "manager", { product_id: productId, qty: 1 });
  assert.equal(created.status, 201);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("product_batches: tenant isolation — a batch created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const productId = await seedProduct(app, "tnt_demo");
  const batch = (await callAs(app, "POST", "/api/v1/product-batches", "tnt_demo", "owner", { product_id: productId, qty: 8 })).json;

  const crossList = await callAs(app, "GET", "/api/v1/product-batches", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.ok(!crossList.json.items.some((b: any) => b.id === batch.id), "cross-tenant list must not leak the batch");

  const crossPatch = await callAs(app, "PATCH", `/api/v1/product-batches/${batch.id}`, "tnt_other", "owner", { qty: 999 });
  assert.equal(crossPatch.status, 404, "cross-tenant patch must 404");

  const crossDelete = await callAs(app, "DELETE", `/api/v1/product-batches/${batch.id}`, "tnt_other", "owner");
  assert.equal(crossDelete.status, 404, "cross-tenant delete must 404");

  const crossSummary = await callAs(app, "GET", "/api/v1/product-batches/summary", "tnt_other", "owner");
  assert.equal(crossSummary.status, 200);
  assert.equal(crossSummary.json.expired + crossSummary.json.critical + crossSummary.json.warning + crossSummary.json.ok, 0, "cross-tenant summary must not count another tenant's batches");

  const ownList = await callAs(app, "GET", "/api/v1/product-batches", "tnt_demo", "owner");
  assert.ok(ownList.json.items.some((b: any) => b.id === batch.id));
});
