/**
 * sso.test.ts — S3-SSO integration tests
 *
 * Tests:
 *   1. GET /sso/config returns {configured:false} when not set
 *   2. PUT /sso/config saves config (clientSecret redacted in response)
 *   3. GET /sso/config returns sanitized config after upsert
 *   4. Manager cannot PUT /sso/config (403)
 *   5. PUT with invalid discoveryUrl is rejected (400)
 *   6. DELETE /sso/config removes the config
 *   7. POST /sso/initiate returns authorizationUrl + state when SSO enabled
 *   8. POST /sso/initiate returns 400 when SSO not configured
 *   9. POST /sso/callback with invalid state returns 400
 *  10. PUT /sso/config enabled=false then initiate returns 400
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `sso_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] ??= "test-secret-finder-pos";
  return buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown, role = "owner") {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

const VALID_CONFIG = {
  enabled: true,
  providerName: "Okta",
  clientId: "client_123",
  clientSecret: "super_secret_456",
  discoveryUrl: "https://example.okta.com/.well-known/openid-configuration",
  scopes: "openid profile email",
  defaultRole: "cashier",
};

// ── 1. No config ──────────────────────────────────────────────────────────────
test("GET /sso/config returns configured:false when not set", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/sso/config");
  assert.equal(status, 200);
  assert.equal(json.configured, false);
});

// ── 2. PUT saves config ───────────────────────────────────────────────────────
test("PUT /sso/config saves config and redacts clientSecret", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.providerName, "Okta");
  assert.equal(json.clientId, "client_123");
  assert.equal(json.hasClientSecret, true);
  assert.ok(!("clientSecret" in json), "clientSecret must be redacted");
});

// ── 3. GET returns sanitized config ──────────────────────────────────────────
test("GET /sso/config returns sanitized config after upsert", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  const { status, json } = await call(app, "GET", "/api/sso/config");
  assert.equal(status, 200);
  assert.equal(json.configured, true);
  assert.equal(json.providerName, "Okta");
  assert.equal(json.hasClientSecret, true);
  assert.ok(!("clientSecret" in json));
});

// ── 4. Manager cannot PUT ────────────────────────────────────────────────────
test("manager cannot PUT /sso/config (403)", async () => {
  const app = await freshApp();
  const { status } = await call(app, "PUT", "/api/sso/config", VALID_CONFIG, "manager");
  assert.equal(status, 403);
});

// ── 5. Invalid discoveryUrl rejected ─────────────────────────────────────────
test("PUT /sso/config with invalid discoveryUrl returns 400", async () => {
  const app = await freshApp();
  const { status } = await call(app, "PUT", "/api/sso/config", {
    ...VALID_CONFIG,
    discoveryUrl: "not-a-url",
  });
  assert.equal(status, 400);
});

// ── 6. DELETE removes config ──────────────────────────────────────────────────
test("DELETE /sso/config removes the config", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  const { status } = await call(app, "DELETE", "/api/sso/config");
  assert.equal(status, 204);
  const { json } = await call(app, "GET", "/api/sso/config");
  assert.equal(json.configured, false);
});

// ── 7. Initiate returns authorizationUrl ─────────────────────────────────────
test("POST /sso/initiate returns authorizationUrl and state when SSO enabled", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  // /sso/initiate is public (no auth required) — pass tenantId in body.
  const { default: request } = await import("./test-request.js");
  const { status, json } = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(status, 200, JSON.stringify(json));
  assert.ok(typeof json.authorizationUrl === "string");
  assert.ok(typeof json.state === "string" && json.state.length > 0);
  assert.ok(json.authorizationUrl.includes("client_123"));
  assert.ok(json.authorizationUrl.includes(json.state));
});

// ── 8. Initiate returns 400 when not configured ───────────────────────────────
test("POST /sso/initiate returns 400 when SSO not configured", async () => {
  const app = await freshApp();
  const { default: request } = await import("./test-request.js");
  const { status } = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(status, 400);
});

// ── 9. Callback with invalid state returns 400 ────────────────────────────────
test("POST /sso/callback with invalid state returns 400", async () => {
  const app = await freshApp();
  const { default: request } = await import("./test-request.js");
  const { status } = await request(app.express, "POST", "/api/v1/sso/callback", {
    state: "bogus-state-that-was-never-issued",
    code: "some_auth_code",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(status, 400);
});

// ── 10. enabled=false then initiate 400 ──────────────────────────────────────
test("initiate returns 400 when SSO config exists but enabled=false", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", { ...VALID_CONFIG, enabled: false });
  const { default: request } = await import("./test-request.js");
  const { status } = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(status, 400);
});

// ── 11. regression: initiate/callback reachable with NO bearer token ────────
// Every test above goes through test-request.ts, which always attaches a
// Bearer token — so it never actually exercised the real pre-login scenario
// (a user who is trying to log in has no token yet). Before the app.ts fix,
// these routes sat behind makeAuthMiddleware and returned 401 for a tokenless
// caller, making SSO login impossible in practice.
test("POST /sso/initiate is reachable with no Authorization header at all", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);

  const http = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") { server.close(); reject(new Error("bind failed")); return; }
      const body = JSON.stringify({ tenantId: "tnt_demo", redirectUri: "https://app.example.com/sso/callback" });
      const req = http.request(
        { host: "127.0.0.1", port: address.port, method: "POST", path: "/api/v1/sso/initiate", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } },
        (res) => { res.on("data", () => {}); res.on("end", () => { server.close(); resolve(res.statusCode ?? 0); }); },
      );
      req.on("error", (err) => { server.close(); reject(err); });
      req.write(body);
      req.end();
    });
  });
  assert.equal(status, 200);
});
