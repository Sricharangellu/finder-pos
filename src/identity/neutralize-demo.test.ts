/**
 * neutralize-demo.test.ts — production defense-in-depth for seeded demo accounts.
 *
 * Seed guards stop NEW demo credentials reaching production, but a demo user
 * already planted there would still accept the well-known password committed in
 * this repo. `neutralizeDemoAccountsInProduction()` scrambles such accounts on
 * production boot. These tests prove it closes the hole and is safe elsewhere.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { buildApp, type App } from "../app.js";
import { IdentityService, DEMO_PASSWORD, DEMO_TENANT_ID } from "./service.js";

let __seq = 0;
const __schema = () => `neut_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] = "test-jwt-secret-neutralize";
  return buildApp({ schema: __schema() });
}

/** Plant a demo owner carrying the published password, as an old seed-e2e run would. */
async function plantDemoOwner(app: App): Promise<void> {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = Date.now();
  await app.db.query(
    "INSERT INTO tenants (id, name, slug, created_at, updated_at) VALUES (@id, @n, @s, @c, @u) ON CONFLICT (id) DO NOTHING",
    { id: DEMO_TENANT_ID, n: "Demo", s: "demo", c: now, u: now },
  );
  await app.db.query(
    `INSERT INTO users (id, tenant_id, email, password_hash, role, created_at, updated_at)
     VALUES (@id, @t, @e, @h, 'owner', @c, @u)
     ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = @h`,
    { id: "usr_demo_owner", t: DEMO_TENANT_ID, e: "owner@ascend.dev", h: hash, c: now, u: now },
  );
}

async function currentHash(app: App): Promise<string> {
  const row = await app.db.one<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE email = @e",
    { e: "owner@ascend.dev" },
  );
  return row!.password_hash;
}

test("in production, a demo account with the published password is neutralized", async () => {
  const app = await freshApp();
  await plantDemoOwner(app);
  assert.ok(await bcrypt.compare(DEMO_PASSWORD, await currentHash(app)), "published password works before");

  const saved = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "production";
  try {
    await new IdentityService(app.db, app.events).neutralizeDemoAccountsInProduction();
  } finally {
    process.env["NODE_ENV"] = saved;
  }

  assert.equal(
    await bcrypt.compare(DEMO_PASSWORD, await currentHash(app)),
    false,
    "published password no longer works after neutralization",
  );
});

test("neutralization is idempotent — a second run does not error or re-scramble", async () => {
  const app = await freshApp();
  await plantDemoOwner(app);
  const saved = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "production";
  try {
    const svc = new IdentityService(app.db, app.events);
    await svc.neutralizeDemoAccountsInProduction();
    const afterFirst = await currentHash(app);
    await svc.neutralizeDemoAccountsInProduction(); // already safe → no-op
    assert.equal(await currentHash(app), afterFirst, "second run leaves the (already-safe) hash unchanged");
  } finally {
    process.env["NODE_ENV"] = saved;
  }
});

test("outside production it is a no-op — demo login keeps working in test/dev/CI", async () => {
  const app = await freshApp();
  await plantDemoOwner(app);
  // NODE_ENV is "test" under the harness.
  await new IdentityService(app.db, app.events).neutralizeDemoAccountsInProduction();
  assert.ok(
    await bcrypt.compare(DEMO_PASSWORD, await currentHash(app)),
    "demo password still works outside production",
  );
});
