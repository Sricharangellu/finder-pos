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

test("create outlet and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/outlets/", { name: "Main Street", timezone: "America/New_York" });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("otl_"));
  assert.equal(r.json.name, "Main Street");
  assert.equal(r.json.timezone, "America/New_York");
  assert.equal(r.json.tenant_id, "tnt_demo");

  const list = await call(app, "GET", "/api/outlets/");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((o: { id: string }) => o.id === r.json.id));
});

test("add a register to an outlet", async () => {
  const app = await freshApp();
  const outlet = (await call(app, "POST", "/api/outlets/", { name: "Downtown" })).json;

  const reg = await call(app, "POST", `/api/outlets/${outlet.id}/registers`, { name: "Till 1" });
  assert.equal(reg.status, 201);
  assert.ok(reg.json.id.startsWith("reg_"));
  assert.equal(reg.json.name, "Till 1");
  assert.equal(reg.json.status, "closed");
  assert.equal(reg.json.outlet_id, outlet.id);

  // Register appears nested in outlet list
  const list = await call(app, "GET", "/api/outlets/");
  const found = list.json.items.find((o: { id: string }) => o.id === outlet.id);
  assert.ok(found, "outlet in list");
  assert.equal(found.registers.length, 1);
  assert.equal(found.registers[0].name, "Till 1");
});

test("open and close a register session", async () => {
  const app = await freshApp();
  const outlet = (await call(app, "POST", "/api/outlets/", { name: "Uptown" })).json;
  const reg = (await call(app, "POST", `/api/outlets/${outlet.id}/registers`, { name: "Till A" })).json;

  // Open session
  const opened = await call(app, "POST", `/api/outlets/registers/${reg.id}/open`, { openingFloatCents: 20000 });
  assert.equal(opened.status, 201);
  assert.equal(opened.json.status, "open");
  assert.equal(opened.json.opening_float_cents, 20000);
  assert.equal(opened.json.closing_float_cents, null);

  // Opening twice should fail
  const dupe = await call(app, "POST", `/api/outlets/registers/${reg.id}/open`, { openingFloatCents: 0 });
  assert.equal(dupe.status, 409);

  // Close session
  const closed = await call(app, "POST", `/api/outlets/registers/${reg.id}/close`, {
    countedCashCents: 19500,
    closingFloatCents: 19500,
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.json.status, "closed");
  assert.equal(closed.json.counted_cash_cents, 19500);
  // variance = expectedCash - counted = 20000 - 19500 = +500
  assert.equal(closed.json.variance_cents, 500);
});

test("expected cash endpoint returns a total", async () => {
  const app = await freshApp();
  const outlet = (await call(app, "POST", "/api/outlets/", { name: "Westside" })).json;
  const reg = (await call(app, "POST", `/api/outlets/${outlet.id}/registers`, { name: "Till W" })).json;
  await call(app, "POST", `/api/outlets/registers/${reg.id}/open`, { openingFloatCents: 10000 });

  const ec = await call(app, "GET", `/api/outlets/registers/${reg.id}/expected-cash`);
  assert.equal(ec.status, 200);
  assert.ok(typeof ec.json.expectedCashCents === "number");
});

test("creating an outlet requires a name", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/outlets/", { timezone: "UTC" });
  assert.equal(r.status, 400);
});
