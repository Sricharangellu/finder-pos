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
// default `/api/v1/restaurant` while every route inside was ALSO prefixed
// with `/restaurant`, producing `/api/v1/restaurant/restaurant/tables` — the
// single-prefix path the frontend actually calls 404'd.
test("single-prefix /api/v1/restaurant/tables is reachable (not double-prefixed)", async () => {
  const app = await freshApp();
  const create = await call(app, "POST", "/api/v1/restaurant/tables", { tableNumber: "12", capacity: 4 });
  assert.equal(create.status, 201);
  assert.equal(create.json.table_number, "12");

  const list = await call(app, "GET", "/api/v1/restaurant/tables");
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const doublePrefixed = await call(app, "GET", "/api/v1/restaurant/restaurant/tables");
  assert.equal(doublePrefixed.status, 404);
});

test("bar tabs are reachable at the single-prefix path", async () => {
  const app = await freshApp();
  const opened = await call(app, "POST", "/api/v1/restaurant/tabs", { customerName: "Alex" });
  assert.equal(opened.status, 201);
  const list = await call(app, "GET", "/api/v1/restaurant/tabs");
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);
});
