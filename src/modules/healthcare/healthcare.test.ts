import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

// Regression: (1) double URL prefix (mount /api/v1/healthcare + internal
// /healthcare/patients = /api/v1/healthcare/healthcare/patients, 404 in prod);
// (2) business-pack isolation was never enforced server-side — a retail
// tenant could otherwise read real patient records directly.
test("a retail-default tenant is denied direct access to /api/v1/healthcare/patients", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/v1/healthcare/patients");
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "module_not_enabled");
});

test("switching business type to healthcare unlocks the single-prefix path", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "POST", "/api/v1/settings/business-profile", { businessType: "healthcare" })).status, 200);
  const list = await call(app, "GET", "/api/v1/healthcare/patients");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json.items));
});
