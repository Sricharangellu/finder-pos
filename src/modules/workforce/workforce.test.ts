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

// Regression test for a double-URL-prefix bug: the module mounted at the
// default `/api/v1/workforce` while every route inside was ALSO prefixed
// with `/workforce`, producing `/api/v1/workforce/workforce/employees` — the
// single-prefix path the frontend actually calls 404'd.
test("single-prefix /api/v1/workforce/employees is reachable (not double-prefixed)", async () => {
  const app = await freshApp();
  const create = await call(app, "POST", "/api/v1/workforce/employees", { name: "Jordan" });
  assert.equal(create.status, 201);
  assert.equal(create.json.name, "Jordan");

  const list = await call(app, "GET", "/api/v1/workforce/employees");
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const doublePrefixed = await call(app, "GET", "/api/v1/workforce/workforce/employees");
  assert.equal(doublePrefixed.status, 404);
});
