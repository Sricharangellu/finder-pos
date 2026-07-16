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
 *  11. initiate reachable with no Authorization header at all
 *  12. full initiate -> callback flow verifies the ID token signature and
 *      succeeds when it matches the provider's published JWKS
 *  13. callback rejects an ID token signed by the wrong key (forged/tampered)
 *  14. callback rejects an ID token whose nonce doesn't match the one issued
 *      at /initiate (replay/mix-up protection)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
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

const DISCOVERY_DOC = {
  issuer: "https://example.okta.com",
  authorization_endpoint: "https://example.okta.com/authorize",
  token_endpoint: "https://example.okta.com/token",
  jwks_uri: "https://example.okta.com/jwks",
};

/** Builds a fake IdP: a real RSA keypair, its JWKS response, and a signer for
 *  ID tokens. Used to prove verification actually checks the signature
 *  instead of trusting a decoded-but-unverified token. */
function makeFakeIdp() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "test-key-1", use: "sig", alg: "RS256" };
  function signIdToken(nonce: string, opts: { signWithWrongKey?: boolean; email?: string } = {}) {
    const signingKey = opts.signWithWrongKey
      ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
      : privateKey;
    return jwt.sign(
      { email: opts.email ?? "newuser@example.com", nonce },
      signingKey,
      { algorithm: "RS256", keyid: "test-key-1", issuer: DISCOVERY_DOC.issuer, audience: VALID_CONFIG.clientId, expiresIn: "5m" },
    );
  }
  return { jwk, signIdToken };
}

/** Mocks the 3 outbound fetch calls the OIDC flow makes: discovery, JWKS, and
 *  token exchange. `getIdToken` is read lazily so the test can set the token
 *  after seeing the nonce /initiate actually issued. */
function mockOidcFetch(t: { mock: { method: (obj: object, name: string, impl: (...a: unknown[]) => unknown) => void } }, jwk: object, getIdToken: () => string | undefined) {
  t.mock.method(globalThis, "fetch", async (...args: unknown[]) => {
    const u = String(args[0]);
    if (u === VALID_CONFIG.discoveryUrl) {
      return new Response(JSON.stringify(DISCOVERY_DOC), { status: 200 });
    }
    if (u === DISCOVERY_DOC.jwks_uri) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    if (u === DISCOVERY_DOC.token_endpoint) {
      const idToken = getIdToken();
      if (!idToken) throw new Error("test id_token not set before token exchange");
      return new Response(JSON.stringify({ id_token: idToken, access_token: "at_test" }), { status: 200 });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  });
}

function nonceFromAuthorizationUrl(authorizationUrl: string): string {
  const nonce = new URL(authorizationUrl).searchParams.get("nonce");
  assert.ok(nonce, "authorizationUrl must include a nonce param");
  return nonce!;
}

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
test("POST /sso/initiate returns authorizationUrl and state when SSO enabled", async (t) => {
  const { jwk } = makeFakeIdp();
  mockOidcFetch(t, jwk, () => undefined);
  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
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
  assert.ok(json.authorizationUrl.startsWith(DISCOVERY_DOC.authorization_endpoint));
  assert.ok(new URL(json.authorizationUrl).searchParams.get("nonce"), "must include a nonce");
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

// ── 11. regression: initiate reachable with NO bearer token ──────────────────
test("POST /sso/initiate is reachable with no Authorization header at all", async (t) => {
  const { jwk } = makeFakeIdp();
  mockOidcFetch(t, jwk, () => undefined);
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

// ── 12. full flow: signature verification succeeds against the real JWKS ────
test("callback verifies the id_token signature against the provider's JWKS and provisions the user", async (t) => {
  const { jwk, signIdToken } = makeFakeIdp();
  let idToken: string | undefined;
  mockOidcFetch(t, jwk, () => idToken);

  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  const { default: request } = await import("./test-request.js");

  const init = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(init.status, 200);
  const nonce = nonceFromAuthorizationUrl(init.json.authorizationUrl);
  idToken = signIdToken(nonce, { email: "newuser@example.com" });

  const cb = await request(app.express, "POST", "/api/v1/sso/callback", {
    state: init.json.state,
    code: "auth_code_123",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(cb.status, 200, JSON.stringify(cb.json));
  assert.ok(typeof cb.json.accessToken === "string" && cb.json.accessToken.length > 0);
  assert.ok(typeof cb.json.refreshToken === "string");
  assert.equal(cb.json.expiresIn, 900);

  // JIT-provisioned: the new user's role should be the configured defaultRole (cashier).
  const decoded = jwt.decode(cb.json.accessToken) as Record<string, unknown>;
  assert.equal(decoded["role"], "cashier");
  assert.equal(decoded["tenantId"], "tnt_demo");
});

// ── 13. rejects a forged/tampered id_token (wrong signing key) ──────────────
test("callback rejects an id_token signed by a key not in the provider's JWKS", async (t) => {
  const { jwk, signIdToken } = makeFakeIdp();
  let idToken: string | undefined;
  mockOidcFetch(t, jwk, () => idToken);

  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  const { default: request } = await import("./test-request.js");

  const init = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  const nonce = nonceFromAuthorizationUrl(init.json.authorizationUrl);
  idToken = signIdToken(nonce, { signWithWrongKey: true });

  const cb = await request(app.express, "POST", "/api/v1/sso/callback", {
    state: init.json.state,
    code: "auth_code_123",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(cb.status, 502);
  assert.equal(cb.json.error.code, "oidc_token_error");
});

// ── 14. rejects a nonce mismatch (mix-up / replay) ───────────────────────────
test("callback rejects an id_token whose nonce does not match the one issued at initiate", async (t) => {
  const { jwk, signIdToken } = makeFakeIdp();
  let idToken: string | undefined;
  mockOidcFetch(t, jwk, () => idToken);

  const app = await freshApp();
  await call(app, "PUT", "/api/sso/config", VALID_CONFIG);
  const { default: request } = await import("./test-request.js");

  const init = await request(app.express, "POST", "/api/v1/sso/initiate", {
    tenantId: "tnt_demo",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  idToken = signIdToken("a-completely-different-nonce");

  const cb = await request(app.express, "POST", "/api/v1/sso/callback", {
    state: init.json.state,
    code: "auth_code_123",
    redirectUri: "https://app.example.com/sso/callback",
  }, "owner");
  assert.equal(cb.status, 502);
  assert.equal(cb.json.error.code, "oidc_token_error");
});
