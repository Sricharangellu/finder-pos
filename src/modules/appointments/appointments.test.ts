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

// Regression test for business-pack isolation: before requireModule() existed,
// ANY tenant (regardless of selected business type) could call a vertical
// module's routes directly — isolation was frontend-only. The demo tenant
// defaults to the "retail" business type, whose bundle does not include
// "appointments" (that's part of the "services" bundle), so it must now be
// denied until the tenant actually opts into that business pack.
test("a retail-default tenant is denied direct access to /api/v1/appointments", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/v1/appointments");
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "module_not_enabled");
});

test("switching business type to services unlocks /api/v1/appointments", async () => {
  const app = await freshApp();
  const switched = await call(app, "POST", "/api/v1/settings/business-profile", { businessType: "services" });
  assert.equal(switched.status, 200);

  const list = await call(app, "GET", "/api/v1/appointments");
  assert.equal(list.status, 200);

  const created = await call(app, "POST", "/api/v1/appointments", {
    service: "Haircut",
    startsAt: Date.now() + 3_600_000,
    endsAt: Date.now() + 5_400_000,
  });
  assert.equal(created.status, 201);
});
