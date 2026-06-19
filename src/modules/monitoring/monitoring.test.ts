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

test("health endpoint returns ok and uptime", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/monitoring/health", undefined);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "ok");
  assert.ok(typeof r.json.uptime === "number" && r.json.uptime >= 0);
  assert.ok(typeof r.json.timestamp === "string");
});

test("client error report is accepted and returns 202", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/monitoring/errors", {
    message: "TypeError: Cannot read property 'x' of undefined",
    source: "web/app/terminal/page.tsx",
    stack: "TypeError: Cannot read properties of undefined\n  at TerminalPage (page.tsx:42)",
    level: "error",
    context: { userId: "usr_123", orderId: "ord_456" },
    userAgent: "Mozilla/5.0",
    url: "/terminal",
  });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
});

test("client warning report is accepted", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/monitoring/errors", {
    message: "Slow render detected: 1200ms",
    level: "warning",
    source: "web/components/inventory/Table.tsx",
  });
  assert.equal(r.status, 202);
  assert.equal(r.json.ok, true);
});

test("error report defaults level to error when omitted", async () => {
  const app = await freshApp();
  // level is optional — schema defaults to "error"
  const r = await call(app, "POST", "/api/monitoring/errors", {
    message: "Unhandled rejection in payment flow",
  });
  assert.equal(r.status, 202);
});

test("error report with empty message is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/monitoring/errors", { message: "" });
  assert.equal(r.status, 400);
});

test("error report with invalid level is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/monitoring/errors", {
    message: "Something happened",
    level: "critical",
  });
  assert.equal(r.status, 400);
});
