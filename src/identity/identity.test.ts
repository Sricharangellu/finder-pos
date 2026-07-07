/**
 * identity.test.ts — Wave 0 identity tests
 *
 * Tests:
 *   1. JWT issue + verify round-trip
 *   2. requireRole() denies the wrong role
 *   3. Gateway rejects an unauthenticated request (401)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../app.js";
import { IdentityService } from "./service.js";
import { requireRole } from "./service.js";
import { HttpError } from "../shared/http.js";
import type { Role } from "./types.js";
import jwt from "jsonwebtoken";

// ── Helpers ──────────────────────────────────────────────────────────────────

let __seq = 0;
const __schema = () => `id_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const TEST_SECRET = "test-jwt-secret-wave0";

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] = TEST_SECRET;
  return buildApp({ schema: __schema() });
}

const request = (await import("./test-request.js")).default;

// ── 1. JWT issue + verify round-trip ─────────────────────────────────────────

test("IdentityService issues a verifiable access token", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);

  // Seed a test tenant + user directly.
  const tenantId = `ten_test_${Date.now()}`;
  const userId = `usr_test_${Date.now()}`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'Test Corp', 'test-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'owner@example.com', 'secret123', 'owner', ${Date.now()}, ${Date.now()})
  `);

  const loginResult = await svc.login({
    email: "owner@example.com",
    password: "secret123",
  });
  assert.ok(!("mfaRequired" in loginResult), "non-MFA login issues tokens");
  const { accessToken, refreshToken, expiresIn } = loginResult;

  assert.ok(typeof accessToken === "string" && accessToken.length > 0, "accessToken present");
  assert.ok(typeof refreshToken === "string" && refreshToken.length > 0, "refreshToken present");
  assert.equal(expiresIn, 15 * 60, "expiresIn = 900s");

  // Round-trip verify.
  const claims = svc.verifyAccessToken(accessToken);
  assert.equal(claims.sub, userId, "sub = userId");
  assert.equal(claims.tenantId, tenantId, "tenantId claim correct");
  assert.equal(claims.role, "owner", "role claim correct");

  await app.db.close();
});

test("login with enabled MFA returns a challenge without auth cookies", async () => {
  const app = await freshApp();
  const OTPAuth = await import("otpauth");

  const tenantId = `ten_mfa_challenge_${Date.now()}`;
  const userId = `usr_mfa_challenge_${Date.now()}`;
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'MFA Corp', 'mfa-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, mfa_enabled, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'mfa-owner@example.com', 'secret123', 'owner', true, ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO user_mfa (id, tenant_id, user_id, totp_secret, enabled, backup_codes, created_at, updated_at)
    VALUES ('mfa_${Date.now()}', '${tenantId}', '${userId}', '${secret}', true, '[]', ${Date.now()}, ${Date.now()})
  `);

  const { status, json, headers } = await request(app.express, "POST", "/api/identity/login", {
    email: "mfa-owner@example.com",
    password: "secret123",
  });

  assert.equal(status, 401);
  assert.equal(json.error.code, "mfa_required");
  assert.equal(typeof json.pendingToken, "string");
  assert.equal(headers["set-cookie"], undefined);

  await app.db.close();
});

test("login MFA endpoint exchanges a valid TOTP challenge for auth cookies", async () => {
  const app = await freshApp();
  const OTPAuth = await import("otpauth");

  const tenantId = `ten_mfa_totp_${Date.now()}`;
  const userId = `usr_mfa_totp_${Date.now()}`;
  const secret = new OTPAuth.Secret({ size: 20 });
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'TOTP Corp', 'totp-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, mfa_enabled, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'totp-owner@example.com', 'secret123', 'owner', true, ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO user_mfa (id, tenant_id, user_id, totp_secret, enabled, backup_codes, created_at, updated_at)
    VALUES ('mfa_${Date.now()}', '${tenantId}', '${userId}', '${secret.base32}', true, '[]', ${Date.now()}, ${Date.now()})
  `);

  const login = await request(app.express, "POST", "/api/identity/login", {
    email: "totp-owner@example.com",
    password: "secret123",
  });
  const totp = new OTPAuth.TOTP({ issuer: "FinderPOS", algorithm: "SHA1", digits: 6, period: 30, secret });
  const code = totp.generate();

  const { status, json, headers } = await request(app.express, "POST", "/api/identity/login/mfa", {
    pendingToken: login.json.pendingToken,
    code,
  });

  assert.equal(status, 200);
  assert.equal(json.user.email, "totp-owner@example.com");
  assert.ok(Array.isArray(headers["set-cookie"]), "MFA login should set auth cookies");

  await app.db.close();
});

test("MFA backup code can complete login once and is then consumed", async () => {
  const app = await freshApp();
  const OTPAuth = await import("otpauth");
  const svc = new IdentityService(app.db, app.events);

  const tenantId = `ten_mfa_backup_${Date.now()}`;
  const userId = `usr_mfa_backup_${Date.now()}`;
  const secret = new OTPAuth.Secret({ size: 20 });
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'Backup Corp', 'backup-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, mfa_enabled, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'backup-owner@example.com', 'secret123', 'owner', false, ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO user_mfa (id, tenant_id, user_id, totp_secret, enabled, backup_codes, created_at, updated_at)
    VALUES ('mfa_${Date.now()}', '${tenantId}', '${userId}', '${secret.base32}', false, '[]', ${Date.now()}, ${Date.now()})
  `);

  const totp = new OTPAuth.TOTP({ issuer: "FinderPOS", algorithm: "SHA1", digits: 6, period: 30, secret });
  const { backupCodes } = await svc.verifyAndEnableMfa(userId, tenantId, totp.generate());
  const login = await request(app.express, "POST", "/api/identity/login", {
    email: "backup-owner@example.com",
    password: "secret123",
  });

  const firstUse = await request(app.express, "POST", "/api/identity/login/mfa", {
    pendingToken: login.json.pendingToken,
    code: backupCodes[0],
  });
  assert.equal(firstUse.status, 200);

  const secondLogin = await request(app.express, "POST", "/api/identity/login", {
    email: "backup-owner@example.com",
    password: "secret123",
  });
  const secondUse = await request(app.express, "POST", "/api/identity/login/mfa", {
    pendingToken: secondLogin.json.pendingToken,
    code: backupCodes[0],
  });
  assert.equal(secondUse.status, 401);
  assert.equal(secondUse.json.error.code, "invalid_mfa");

  await app.db.close();
});

test("IdentityService issues unique refresh tokens for rapid repeated login", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);

  const unique = `${process.pid}_${Date.now()}`;
  const tenantId = `ten_repeat_${unique}`;
  const userId = `usr_repeat_${unique}`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'Repeat Corp', 'repeat-corp-${unique}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'repeat-owner@example.com', 'secret123', 'owner', ${Date.now()}, ${Date.now()})
  `);

  const first = await svc.login({ email: "repeat-owner@example.com", password: "secret123" });
  const second = await svc.login({ email: "repeat-owner@example.com", password: "secret123" });

  assert.ok(!("mfaRequired" in first), "first non-MFA login issues tokens");
  assert.ok(!("mfaRequired" in second), "second non-MFA login issues tokens");
  assert.notEqual(first.accessToken, second.accessToken, "access token changes on repeated login");
  assert.notEqual(first.refreshToken, second.refreshToken, "refresh token changes on repeated login");

  const storedTokens = await app.db.one<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE tenant_id = @tenantId AND user_id = @userId",
    { tenantId, userId },
  );
  assert.equal(storedTokens?.count, 2, "both refresh tokens are stored");

  await app.db.close();
});

test("verifyAccessToken rejects a tampered token", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);

  const fake = jwt.sign({ tenantId: "x", role: "owner" }, "wrong-secret", {
    subject: "hacker",
    expiresIn: "1h",
  });

  assert.throws(
    () => svc.verifyAccessToken(fake),
    (err: unknown) => err instanceof HttpError && err.status === 401,
    "tampered token → 401",
  );

  await app.db.close();
});

test("login with wrong password returns 401", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);

  const tenantId = `ten_pw_${Date.now()}`;
  const userId = `usr_pw_${Date.now()}`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'PW Corp', 'pw-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'cashier@example.com', 'correct-pass', 'cashier', ${Date.now()}, ${Date.now()})
  `);

  await assert.rejects(
    () => svc.login({ email: "cashier@example.com", password: "wrong-pass" }),
    (err: unknown) => err instanceof HttpError && err.status === 401,
    "wrong password → 401",
  );

  await app.db.close();
});

test("login sets refresh cookie with httpOnly and SameSite=Lax", async () => {
  const app = await freshApp();

  const tenantId = `ten_cookie_${Date.now()}`;
  const userId = `usr_cookie_${Date.now()}`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('${tenantId}', 'Cookie Corp', 'cookie-corp-${Date.now()}', ${Date.now()}, ${Date.now()})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    VALUES ('${userId}', '${tenantId}', 'cookie-owner@example.com', 'secret123', 'owner', ${Date.now()}, ${Date.now()})
  `);

  const { status, headers } = await request(app.express, "POST", "/api/identity/login", {
    email: "cookie-owner@example.com",
    password: "secret123",
  });

  assert.equal(status, 200);
  const setCookie = headers["set-cookie"];
  assert.ok(Array.isArray(setCookie), "login should set auth cookies");

  const refreshCookie = setCookie.find((cookie) => cookie.startsWith("finder_refresh=")) ?? "";
  const sessionHintCookie = setCookie.find((cookie) => cookie.startsWith("finder_session_hint=")) ?? "";

  assert.match(refreshCookie, /HttpOnly/i, "refresh cookie is httpOnly");
  assert.match(refreshCookie, /SameSite=Lax/i, "refresh cookie uses SameSite=Lax");
  assert.match(refreshCookie, /Path=\//i, "refresh cookie is scoped to the app");
  assert.doesNotMatch(sessionHintCookie, /HttpOnly/i, "session hint remains JavaScript-readable");
  assert.match(sessionHintCookie, /SameSite=Lax/i, "session hint uses SameSite=Lax");

  await app.db.close();
});

// ── 2. requireRole() denies the wrong role ────────────────────────────────────

test("requireRole allows a sufficiently privileged role", () => {
  const middleware = requireRole("cashier");
  let nextCalled = false;
  const res = { locals: { auth: { role: "owner" as Role } } } as any;
  middleware({} as any, res, () => { nextCalled = true; });
  assert.ok(nextCalled, "next() called for owner hitting cashier-level route");
});

test("requireRole denies an insufficiently privileged role", () => {
  const middleware = requireRole("owner");
  let nextError: unknown;
  const res = { locals: { auth: { role: "cashier" as Role } } } as any;
  middleware({} as any, res, (err: unknown) => { nextError = err; });
  assert.ok(nextError instanceof HttpError, "next called with HttpError");
  assert.equal((nextError as HttpError).status, 403, "status 403");
  assert.equal((nextError as HttpError).code, "forbidden", "code = forbidden");
});

test("requireRole denies manager from owner-only route", () => {
  const middleware = requireRole("owner");
  let nextError: unknown;
  const res = { locals: { auth: { role: "manager" as Role } } } as any;
  middleware({} as any, res, (err: unknown) => { nextError = err; });
  assert.ok(nextError instanceof HttpError, "next called with HttpError");
  assert.equal((nextError as HttpError).status, 403);
});

test("requireRole allows manager on manager-level route", () => {
  const middleware = requireRole("manager");
  let nextCalled = false;
  const res = { locals: { auth: { role: "manager" as Role } } } as any;
  middleware({} as any, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
});

// ── 3. Gateway rejects unauthenticated requests (401) ─────────────────────────

test("authn-protected route returns 401 with no token", async () => {
  const app = await freshApp();
  // /api/identity/me requires auth middleware — it is mounted with authMiddleware in app.ts
  const { status, json } = await request(app.express, "GET", "/api/identity/me");
  // The /me route in identityRoutes returns 401 when auth is absent because
  // authMiddleware runs first (wired in app.ts) and short-circuits with 401.
  // Without gateway middleware wired for the whole app, we test the route's
  // own guard as a proxy. The gateway-level test below covers the middleware directly.
  assert.ok(status === 401 || json?.error?.code === "unauthenticated", "no token → 401/unauthenticated");
  await app.db.close();
});

test("authMiddleware rejects missing Authorization header", async () => {
  const { authMiddleware } = await import("../gateway/auth.js");
  let nextError: unknown;
  const req = { headers: {} } as any;
  const res = { locals: {} } as any;
  authMiddleware(req, res, (err: unknown) => { nextError = err; });
  assert.ok(nextError instanceof HttpError, "passed error to next");
  assert.equal((nextError as HttpError).status, 401);
  assert.equal((nextError as HttpError).code, "unauthenticated");
});

test("authMiddleware rejects a bad Bearer token", async () => {
  process.env["JWT_SECRET"] = TEST_SECRET;
  const { authMiddleware } = await import("../gateway/auth.js");
  let nextError: unknown;
  const req = { headers: { authorization: "Bearer this-is-not-a-jwt" } } as any;
  const res = { locals: {} } as any;
  authMiddleware(req, res, (err: unknown) => { nextError = err; });
  assert.ok(nextError instanceof HttpError, "passed error to next");
  assert.equal((nextError as HttpError).status, 401);
});

test("authMiddleware populates res.locals.auth for a valid token", async () => {
  process.env["JWT_SECRET"] = TEST_SECRET;
  const { authMiddleware } = await import("../gateway/auth.js");

  const token = jwt.sign(
    { tenantId: "ten_abc", role: "manager" },
    TEST_SECRET,
    { subject: "usr_xyz", expiresIn: "15m" },
  );

  let nextCalled = false;
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const res = { locals: {} } as any;
  authMiddleware(req, res, (err?: unknown) => {
    if (err) throw err;
    nextCalled = true;
  });

  assert.ok(nextCalled, "next() called without error");
  assert.equal(res.locals.auth?.tenantId, "ten_abc");
  assert.equal(res.locals.auth?.userId, "usr_xyz");
  assert.equal(res.locals.auth?.role, "manager");
});
