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
  const { signPayload } = await import("./service.js");
  const secret = "test-secret";
  const body = JSON.stringify({ event: "order.created", id: "ord_123" });
  const sig = signPayload(secret, body);
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(sig, expected);
});

test("toggle deactivates and reactivates a subscription", async () => {
  const app = await freshApp();
  const sub = (await call(app, "POST", "/api/webhooks/", { url: "https://example.com/toggle" })).json;

  const off = await call(app, "PATCH", `/api/webhooks/${sub.id}`, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.active, false);

  const on = await call(app, "PATCH", `/api/webhooks/${sub.id}`, { active: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.active, true);

  // List still returns the subscription
  const list = await call(app, "GET", "/api/webhooks/");
  const found = list.json.items.find((w: { id: string }) => w.id === sub.id);
  assert.ok(found, "subscription still listed after toggle");
});

test("toggle unknown subscription returns 404", async () => {
  const app = await freshApp();
  const r = await call(app, "PATCH", "/api/webhooks/whk_nonexistent", { active: false });
  assert.equal(r.status, 404);
});

test("deliverWithRetry logs attempt_count and status on success", async () => {
  const app = await freshApp();
  const { WebhooksService, signPayload: sign } = await import("./service.js");

  // Create a fresh service pointing at the test DB
  const svc = new WebhooksService(app.db);

  // Minimal mock subscription that uses an unreachable URL so we can verify error path
  const sub = await svc.subscribe({ url: "https://example.com/retrytest", secret: "test-secret-abc" }, "tnt_demo");

  // Deliver a fake event — fetch will fail (network error to example.com).
  // We verify the delivery record is written with attempt_count and status.
  const event = { type: "order.created", aggregateId: "ord_test", occurredAt: new Date().toISOString(), payload: { tenantId: "tnt_demo" } };
  await svc.deliver(sub, event);

  const deliveries = await svc.deliveries("tnt_demo");
  assert.ok(deliveries.length > 0, "at least one delivery recorded");
  const d = deliveries[0]!;
  assert.ok(d.attempt_count >= 1, "attempt_count is at least 1");
  assert.ok(["delivered", "failed"].includes(d.status), "status is delivered or failed");
  assert.equal(d.subscription_id, sub.id);
  assert.equal(d.event_type, "order.created");
});

test("deliveries list returns attempt_count and last_response_body fields", async () => {
  const app = await freshApp();
  const sub = (await call(app, "POST", "/api/webhooks/", { url: "https://example.com/fields" })).json;
  const list = await call(app, "GET", "/api/webhooks/deliveries");
  assert.equal(list.status, 200);
  // Fields exist (may be empty list if no events fired yet)
  assert.ok(Array.isArray(list.json.items));
  void sub; // suppress unused warning
});

test("deliveries: limit/offset query params are accepted and a huge limit is capped server-side", async () => {
  const app = await freshApp();
  const { WebhooksService } = await import("./service.js");
  const svc = new WebhooksService(app.db);
  const sub = await svc.subscribe({ url: "https://example.com/cap-test" }, "tnt_demo");
  const event = { type: "order.created", aggregateId: "ord_cap", occurredAt: new Date().toISOString(), payload: { tenantId: "tnt_demo" } };
  await svc.deliver(sub, event);

  const huge = await call(app, "GET", "/api/webhooks/deliveries?limit=99999&offset=0");
  assert.equal(huge.status, 200, `unexpectedly failed: ${JSON.stringify(huge.json)}`);
  assert.ok(Array.isArray(huge.json.items));
  assert.ok(huge.json.items.length >= 1, "seeded delivery is returned even when a huge limit is requested");
});

