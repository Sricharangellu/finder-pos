/**
 * route-mount.test.ts — mock-vs-real route drift (session D, loop iter 3)
 *
 * customer_invoices, service_orders, and product_batches register top-level
 * resource routes (router.get("/customer-invoices", …)) but shipped WITHOUT a
 * mountPath, so the default /api/v1/<underscore_name> prefix produced dead
 * paths like /api/v1/customer_invoices/customer-invoices. The web client and
 * MSW mocks call the hyphenated top-level paths, so these pages worked in dev
 * and 404'd in production. These tests assert the real assembled app now
 * serves the hyphenated paths the client actually calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `mount_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

// Each entry: the exact hyphenated path the web client calls, on the real mount.
const LIST_ROUTES = [
  "/api/v1/customer-invoices",
  "/api/v1/service-orders",
  "/api/v1/product-batches",
  "/api/v1/product-batches/summary",
];

test("client-facing hyphenated routes resolve on the real backend (not 404)", async () => {
  const app = await buildApp({ schema: __schema() });
  for (const path of LIST_ROUTES) {
    const { status } = await call(app, "GET", path);
    assert.notEqual(status, 404, `${path} must be served by the real backend, got 404`);
    assert.ok(status < 500, `${path} returned ${status} — route resolved but errored`);
  }
});

test("the old underscore mount path is NOT served (confirms the drift was real)", async () => {
  const app = await buildApp({ schema: __schema() });
  // The broken default would have been /api/v1/customer_invoices/... — assert the
  // bare underscore resource is a 404 so this test fails loudly if someone
  // reverts to the default mount.
  const { status } = await call(app, "GET", "/api/v1/customer_invoices/customer-invoices");
  assert.equal(status, 404, "underscore mount should not resolve");
});
