/**
 * movements-pagination.test.ts — movement history pagination + route drift fix
 *
 * Pins two behaviors (session D):
 *   1. GET /inventory/movements?product_id=… exists on the REAL backend.
 *      The web client (InventoryTab, MovementsDrawer) always called this
 *      shape, but it existed only in MSW mocks — the real backend bound
 *      productId="movements" and returned [], leaving movement panels
 *      silently empty in production.
 *   2. Movement history is keyset-paginated (append-only unbounded table).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `movpg_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

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

test("GET /inventory/movements?product_id= returns pages with a working cursor", async () => {
  const app = await freshApp();

  // Three movements: receive, adjust up, adjust down.
  await call(app, "POST", "/api/inventory/prod_pg/receive", { quantity: 10 });
  await call(app, "POST", "/api/inventory/prod_pg/adjust", { delta: 3, reason: "adjustment" });
  await call(app, "POST", "/api/inventory/prod_pg/adjust", { delta: -2, reason: "adjustment" });

  const p1 = await call(app, "GET", "/api/inventory/movements?product_id=prod_pg&limit=2");
  assert.equal(p1.status, 200);
  assert.equal(p1.json.items.length, 2, "first page holds the limit");
  assert.ok(p1.json.nextCursor, "full page yields a cursor");

  const p2 = await call(
    app,
    "GET",
    `/api/inventory/movements?product_id=prod_pg&limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`,
  );
  assert.equal(p2.status, 200);
  assert.equal(p2.json.items.length, 1, "second page holds the remainder");

  const ids = [...p1.json.items, ...p2.json.items].map((m: { id: string }) => m.id);
  assert.equal(new Set(ids).size, 3, "no movement is duplicated or skipped across pages");
});

test("GET /inventory/movements without product_id is a 400, not an empty success", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/inventory/movements");
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
});

test("legacy /:productId/movements still returns a bare array", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_legacy/receive", { quantity: 4 });

  const { status, json } = await call(app, "GET", "/api/inventory/prod_legacy/movements");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json), "legacy shape preserved");
  assert.equal(json.length, 1);
  assert.equal(json[0].reason, "receiving");
});
