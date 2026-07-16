/**
 * lockout.test.ts — account-lockout (brute-force protection) coverage
 *
 * The identity service locks an account for LOCKOUT_DURATION_MS after
 * MAX_FAILED_ATTEMPTS consecutive password failures (service.ts:18-19).
 * This is a security control with no prior test coverage — these tests
 * pin the behavior so it cannot silently regress.
 *
 * Tests:
 *   1. Repeated failures lock the account — even the correct password 429s
 *   2. A successful login resets the failure counter
 *   3. An expired lock clears and login succeeds again
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../app.js";
import { IdentityService } from "./service.js";
import { HttpError } from "../shared/http.js";

let __seq = 0;
const __schema = () => `lock_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const MAX_FAILED_ATTEMPTS = 10; // mirrors service.ts:18

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] = "test-jwt-secret-lockout";
  return buildApp({ schema: __schema() });
}

async function seedUser(app: App, prefix: string): Promise<{ email: string; password: string }> {
  const now = Date.now();
  const email = `${prefix}@example.com`;
  await app.db.exec(`
    INSERT INTO tenants (id, name, slug, created_at, updated_at)
    VALUES ('ten_${prefix}_${now}', 'Lock Corp', '${prefix}-corp-${now}', ${now}, ${now})
  `);
  await app.db.exec(`
    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
    VALUES ('usr_${prefix}_${now}', 'ten_${prefix}_${now}', '${email}', 'right-password', 'owner', ${now}, ${now})
  `);
  return { email, password: "right-password" };
}

async function expectHttpError(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await fn();
    assert.fail(`expected HttpError ${status}/${code}, but the call succeeded`);
  } catch (err) {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${String(err)}`);
    assert.equal(err.status, status, `status ${err.status} !== ${status}`);
    assert.equal(err.code, code, `code ${err.code} !== ${code}`);
  }
}

test("account locks after MAX_FAILED_ATTEMPTS failures; correct password then 429s", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);
  const { email, password } = await seedUser(app, "brute");

  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await expectHttpError(
      () => svc.login({ email, password: "wrong-password" }),
      401,
      "invalid_credentials",
    );
  }

  // Locked now: even the CORRECT password must be refused with 429.
  await expectHttpError(() => svc.login({ email, password }), 429, "account_locked");

  await app.db.close();
});

test("successful login resets the failure counter", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);
  const { email, password } = await seedUser(app, "reset");

  // One short of the threshold, then a success.
  for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
    await expectHttpError(
      () => svc.login({ email, password: "wrong-password" }),
      401,
      "invalid_credentials",
    );
  }
  const ok = await svc.login({ email, password });
  assert.ok(!("mfaRequired" in ok), "login succeeds one failure short of the threshold");

  // Counter was reset: a single new failure must NOT lock the account.
  await expectHttpError(
    () => svc.login({ email, password: "wrong-password" }),
    401,
    "invalid_credentials",
  );
  const okAgain = await svc.login({ email, password });
  assert.ok(!("mfaRequired" in okAgain), "account not locked after counter reset");

  await app.db.close();
});

test("expired lock clears and login succeeds", async () => {
  const app = await freshApp();
  const svc = new IdentityService(app.db, app.events);
  const { email, password } = await seedUser(app, "expire");

  // Simulate a lock that has already expired.
  await app.db.exec(`
    UPDATE users
    SET failed_login_attempts = ${MAX_FAILED_ATTEMPTS}, locked_until_ms = ${Date.now() - 1000}
    WHERE email = '${email}'
  `);

  const ok = await svc.login({ email, password });
  assert.ok(!("mfaRequired" in ok), "login succeeds once the lock has expired");

  await app.db.close();
});
