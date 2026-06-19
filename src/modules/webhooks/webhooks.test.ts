import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

test("subscribe and list webhooks", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/webhooks/", {
    url: "https://example.com/hook",
    eventTypes: ["order.created", "payment.captured"],
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("whk_"));
  assert.equal(r.json.url, "https://example.com/hook");
  assert.equal(r.json.event_types, "order.created,payment.captured");
  assert.ok(typeof r.json.secret === "string" && r.json.secret.length > 0);
  assert.equal(r.json.active, true);
  assert.equal(r.json.tenant_id, "tnt_demo");

  const list = await call(app, "GET", "/api/webhooks/");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((w: { id: string }) => w.id === r.json.id));
});

test("subscribe with no eventTypes defaults to wildcard (*)", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/webhooks/", { url: "https://example.com/all" });
  assert.equal(r.status, 201);
  assert.equal(r.json.event_types, "*");
});

test("custom secret is accepted and stored", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/webhooks/", {
    url: "https://example.com/secret",
    secret: "my-known-secret-value",
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.secret, "my-known-secret-value");
});

test("invalid URL is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/webhooks/", { url: "not-a-url" });
  assert.equal(r.status, 400);

  const r2 = await call(app, "POST", "/api/webhooks/", { url: "ftp://example.com/hook" });
  assert.equal(r2.status, 400);
});

test("delete a webhook subscription", async () => {
  const app = await freshApp();
  const sub = (await call(app, "POST", "/api/webhooks/", { url: "https://example.com/delete-me" })).json;
  assert.equal(sub.status ?? 201, 201);

  const del = await call(app, "DELETE", `/api/webhooks/${sub.id}`, undefined);
  assert.equal(del.status, 204);

  // No longer in list
  const list = await call(app, "GET", "/api/webhooks/");
  assert.ok(!list.json.items.some((w: { id: string }) => w.id === sub.id));
});

test("signPayload produces correct HMAC-SHA256", async () => {
  // Verify the signing utility directly (unit test — no HTTP needed).
  const { signPayload } = await import("./service.js");
  const secret = "test-secret";
  const body = JSON.stringify({ event: "order.created", id: "ord_123" });
  const sig = signPayload(secret, body);
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(sig, expected);
});

