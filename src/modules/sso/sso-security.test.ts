/**
 * sso-security.test.ts — OIDC hardening coverage (session D)
 *
 * Pins the three security behaviors added to SsoService:
 *   1. id_token signature verification against the provider JWKS
 *      (forged/wrong-audience tokens are rejected 401)
 *   2. DB-backed OAuth2 state — survives "instance recycling" (a second
 *      service instance completes the callback) and cannot be replayed
 *   3. discoveryUrl SSRF guard (private/link-local addresses rejected)
 *
 * Uses a real local IdP: an http server on 127.0.0.1 serving a discovery
 * document, a JWKS, and a token endpoint, with RS256 tokens signed by a
 * generated RSA key.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";
import { SsoService, assertSafeDiscoveryUrl, type IdentityProviderConfig } from "./service.js";
import { IdentityService } from "../../identity/service.js";
import { HttpError } from "../../shared/http.js";

let __seq = 0;
const __schema = () => `sso_sec_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

// ── Local IdP ─────────────────────────────────────────────────────────────────

const goodKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const evilKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const goodJwk = { ...(goodKeys.publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: "good-1" };

let idp: Server;
let idpBase = "";
let issuer = "";
/** Each test sets the id_token the token endpoint should return next. */
let nextIdToken = "";

before(async () => {
  idp = createServer((req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer,
        token_endpoint: `${idpBase}/token`,
        jwks_uri: `${idpBase}/jwks`,
      }));
    } else if (req.url === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [goodJwk] }));
    } else if (req.url === "/token") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id_token: nextIdToken, access_token: "opaque" }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const addr = idp.address();
  if (addr === null || typeof addr === "string") throw new Error("no idp port");
  idpBase = `http://127.0.0.1:${addr.port}`;
  issuer = idpBase;
});

after(() => idp.close());

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLIENT_ID = "ascend-client-1";

function mintIdToken(opts: { key?: "good" | "evil"; aud?: string; email?: string }): string {
  const key = opts.key === "evil" ? evilKeys.privateKey : goodKeys.privateKey;
  return jwt.sign(
    { email: opts.email ?? "sso-user@example.com" },
    key.export({ type: "pkcs1", format: "pem" }) as string,
    {
      algorithm: "RS256",
      keyid: "good-1",
      audience: opts.aud ?? CLIENT_ID,
      issuer,
      subject: "idp-sub-1",
      expiresIn: "5m",
    },
  );
}

async function seedTenantWithSso(app: App): Promise<{ tenantId: string; svc: SsoService }> {
  const now = Date.now();
  const tenantId = `ten_sso_${now}_${__seq++}`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'SSO Corp', 'sso-corp-${now}-${__seq}', ${now}, ${now})
  `);
  const svc = new SsoService(app.db);
  const cfg: IdentityProviderConfig = {
    enabled: true,
    providerName: "local-idp",
    clientId: CLIENT_ID,
    clientSecret: "s3cret",
    discoveryUrl: `${idpBase}/.well-known/openid-configuration`,
    scopes: "openid profile email",
    defaultRole: "cashier",
  };
  await svc.upsertConfig(tenantId, cfg);
  return { tenantId, svc };
}

async function expectHttpError(fn: () => Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await fn();
    assert.fail(`expected HttpError ${status}/${code}, but the call succeeded`);
  } catch (err) {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`);
    assert.equal(err.status, status);
    assert.equal(err.code, code);
  }
}

// ── 1. Verified happy path + DB-backed state across service instances ─────────

test("callback verifies a properly signed id_token; state survives a new service instance", async () => {
  process.env["JWT_SECRET"] = "test-jwt-secret-sso-sec";
  const app = await buildApp({ schema: __schema() });
  const { tenantId, svc } = await seedTenantWithSso(app);

  const { state } = await svc.initiateLogin(tenantId, "https://app.example.com/cb");
  nextIdToken = mintIdToken({ key: "good" });

  // A DIFFERENT service instance handles the callback — proves the state is
  // in the database, not in the initiating instance's memory (serverless).
  const svc2 = new SsoService(app.db);
  const result = await svc2.handleCallback(state, "auth-code", "https://app.example.com/cb");
  assert.ok(result.accessToken.length > 0, "access token issued");

  const user = await app.db.one<{ role: string }>(
    "SELECT role FROM users WHERE tenant_id = @t AND email = @e",
    { t: tenantId, e: "sso-user@example.com" },
  );
  assert.ok(user, "user JIT-provisioned");
  assert.equal(user!.role, "cashier", "default role assigned");

  // Replay: the same state must be single-use.
  nextIdToken = mintIdToken({ key: "good" });
  await expectHttpError(
    () => svc2.handleCallback(state, "auth-code", "https://app.example.com/cb"),
    400,
    "invalid_state",
  );

  await app.db.close();
});

// ── 1b. SSO sessions can refresh (token persisted in refresh_tokens) ──────────

test("SSO-issued refresh token round-trips through identity.refresh()", async () => {
  process.env["JWT_SECRET"] = "test-jwt-secret-sso-sec";
  const app = await buildApp({ schema: __schema() });
  const { tenantId, svc } = await seedTenantWithSso(app);

  const { state } = await svc.initiateLogin(tenantId, "https://app.example.com/cb");
  nextIdToken = mintIdToken({ key: "good" });
  const { refreshToken } = await svc.handleCallback(state, "auth-code", "https://app.example.com/cb");

  // identity.refresh() verifies the JWT AND requires a matching non-revoked
  // row in refresh_tokens — this used to 401 because SSO never stored one.
  const identity = new IdentityService(app.db, app.events);
  const rotated = await identity.refresh(refreshToken);
  assert.ok(rotated.accessToken.length > 0, "refresh issues a new access token");
  assert.ok(rotated.refreshToken !== refreshToken, "refresh token is rotated");

  await app.db.close();
});

// ── 2. Forged / wrong-audience tokens rejected ────────────────────────────────

test("callback rejects an id_token signed by the wrong key (401)", async () => {
  process.env["JWT_SECRET"] = "test-jwt-secret-sso-sec";
  const app = await buildApp({ schema: __schema() });
  const { tenantId, svc } = await seedTenantWithSso(app);

  const { state } = await svc.initiateLogin(tenantId, "https://app.example.com/cb");
  nextIdToken = mintIdToken({ key: "evil" });

  await expectHttpError(
    () => svc.handleCallback(state, "auth-code", "https://app.example.com/cb"),
    401,
    "invalid_id_token",
  );
  await app.db.close();
});

test("callback rejects an id_token minted for a different audience (401)", async () => {
  process.env["JWT_SECRET"] = "test-jwt-secret-sso-sec";
  const app = await buildApp({ schema: __schema() });
  const { tenantId, svc } = await seedTenantWithSso(app);

  const { state } = await svc.initiateLogin(tenantId, "https://app.example.com/cb");
  nextIdToken = mintIdToken({ key: "good", aud: "someone-elses-client" });

  await expectHttpError(
    () => svc.handleCallback(state, "auth-code", "https://app.example.com/cb"),
    401,
    "invalid_id_token",
  );
  await app.db.close();
});

// ── 3. SSRF guard ─────────────────────────────────────────────────────────────

test("discoveryUrl SSRF guard rejects private and link-local addresses", () => {
  for (const bad of [
    "https://169.254.169.254/.well-known/openid-configuration", // cloud metadata
    "https://10.0.0.5/.well-known/openid-configuration",
    "https://192.168.1.1/.well-known/openid-configuration",
    "http://10.0.0.5/.well-known/openid-configuration", // http to non-loopback
    "ftp://idp.example.com/config",
    "not-a-url",
  ]) {
    assert.throws(() => assertSafeDiscoveryUrl(bad), HttpError, `should reject: ${bad}`);
  }
  // Public https and loopback http (non-production) are allowed.
  assertSafeDiscoveryUrl("https://example.okta.com/.well-known/openid-configuration");
  assertSafeDiscoveryUrl("http://127.0.0.1:5555/.well-known/openid-configuration");
});
