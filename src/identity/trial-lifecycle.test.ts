/**
 * trial-lifecycle.test.ts — DEMO-1: automated demo/trial tenant lifecycle.
 *
 * Covers:
 *   1. Self-serve signup starts a 14-day trial (subscriptions row created).
 *   2. The daily trial-expiry job soft-expires a tenant past trial_ends_at
 *      without touching any tenant business data.
 *   3. An expired tenant's login attempt is rejected with `trial_expired`.
 *   4. Nurture emails fire once at day-7 and day-13 marks, tracked by
 *      nurture_day{7,13}_sent_at, and are NOT re-sent on a second job run.
 *   5. A tenant that upgraded to a paid plan before its trial lapsed is left
 *      untouched by the sweep.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../app.js";
import { trialExpiryJob } from "../orchestration/jobs/trial-expiry.job.js";
import { TRIAL_DURATION_MS } from "./service.js";
import type { JobRow } from "../orchestration/types.js";

let __seq = 0;
const __schema = () => `trial_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] = "test-jwt-secret-trial";
  return buildApp({ schema: __schema() });
}

const request = (await import("./test-request.js")).default;

const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "sup3r-secret-pw";

/** Minimal JobRow stub — only `id` is read by trialExpiryJob (for logging). */
function jobStub(): JobRow {
  return {
    id: "job_test_trial_expiry",
    type: "trial_expiry",
    payload: "{}",
    tenant_id: "system",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    run_at: Date.now(),
    error: null,
    created_at: Date.now(),
    completed_at: null,
  };
}

async function registerTenant(app: App, storeName: string, email: string): Promise<{ token: string; tenantId: string }> {
  const r = await request(app.express, "POST", "/api/identity/register", { storeName, email, password: PASSWORD });
  assert.equal(r.status, 201, `register ${email}: ${JSON.stringify(r.json)}`);
  return { token: r.json.accessToken as string, tenantId: r.json.user.tenantId as string };
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan: string;
  status: string;
  trial_ends_at: number | null;
  nurture_day7_sent_at: number | null;
  nurture_day13_sent_at: number | null;
}

async function getSubscription(app: App, tenantId: string): Promise<SubscriptionRow | undefined> {
  return app.db.one<SubscriptionRow>("SELECT * FROM subscriptions WHERE tenant_id = @tenantId", { tenantId });
}

// ─── 1. Signup starts a trial ─────────────────────────────────────────────────

test("self-serve signup sets a 14-day trial expiry", async () => {
  const app = await freshApp();
  const before = Date.now();
  const { tenantId } = await registerTenant(app, "Aurora Retail", "owner@aurora-trial.test");
  const after = Date.now();

  const sub = await getSubscription(app, tenantId);
  assert.ok(sub, "a subscription row is created at signup");
  assert.equal(sub!.plan, "starter");
  assert.equal(sub!.status, "trialing");
  assert.ok(sub!.trial_ends_at !== null, "trial_ends_at is set");
  assert.ok(
    sub!.trial_ends_at! >= before + TRIAL_DURATION_MS && sub!.trial_ends_at! <= after + TRIAL_DURATION_MS,
    `trial_ends_at (${sub!.trial_ends_at}) is ~14 days from signup`,
  );
});

test("signup can opt out of the trial via skipTrial (escape hatch for non self-serve flows)", async () => {
  const app = await freshApp();
  const r = await request(app.express, "POST", "/api/identity/register", {
    storeName: "Paid Co",
    email: "owner@paid-co.test",
    password: PASSWORD,
    skipTrial: true,
  });
  assert.equal(r.status, 201);
  const sub = await getSubscription(app, r.json.user.tenantId as string);
  assert.equal(sub, undefined, "no subscription row when skipTrial is set");
});

// ─── 2. Daily sweep soft-expires lapsed trials ────────────────────────────────

test("the daily job soft-expires a tenant whose trial_ends_at has passed", async () => {
  const app = await freshApp();
  const { tenantId } = await registerTenant(app, "Borealis Goods", "owner@borealis-trial.test");

  // Simulate a lapsed trial.
  await app.db.query("UPDATE subscriptions SET trial_ends_at = @t WHERE tenant_id = @tenantId", {
    t: Date.now() - 1000,
    tenantId,
  });

  const result = await trialExpiryJob(jobStub(), app.db);
  assert.equal(result.expired, 1, "exactly one tenant expired");

  const sub = await getSubscription(app, tenantId);
  assert.equal(sub!.status, "expired");

  // Soft state only — tenant + user rows must still exist untouched.
  const tenantRow = await app.db.one<{ id: string }>("SELECT id FROM tenants WHERE id = @tenantId", { tenantId });
  assert.ok(tenantRow, "tenant row was not deleted");
  const userRow = await app.db.one<{ id: string }>("SELECT id FROM users WHERE tenant_id = @tenantId", { tenantId });
  assert.ok(userRow, "user row was not deleted");
});

// ─── 3. Expired tenant login is rejected ──────────────────────────────────────

test("an expired tenant's login attempt is rejected with trial_expired", async () => {
  const app = await freshApp();
  const email = "owner@cascade-trial.test";
  const { tenantId } = await registerTenant(app, "Cascade Store", email);

  await app.db.query("UPDATE subscriptions SET status = 'expired' WHERE tenant_id = @tenantId", { tenantId });

  const login = await request(app.express, "POST", "/api/identity/login", { email, password: PASSWORD });
  assert.equal(login.status, 403, `login: ${JSON.stringify(login.json)}`);
  assert.equal(login.json.error.code, "trial_expired");
});

// ─── 4. Nurture emails fire once, are not duplicated ──────────────────────────

test("nurture emails fire once at day-7 and day-13 marks and are not duplicated on a second run", async () => {
  const app = await freshApp();

  // Tenant A: exactly 7 days into its trial (7 days remaining) — day-7 due,
  // day-13 not yet due.
  const a = await registerTenant(app, "Delta Store", "owner@delta-trial.test");
  await app.db.query("UPDATE subscriptions SET trial_ends_at = @t WHERE tenant_id = @tenantId", {
    t: Date.now() + 7 * DAY_MS,
    tenantId: a.tenantId,
  });

  const firstRun = await trialExpiryJob(jobStub(), app.db);
  assert.equal(firstRun.nurtureDay7, 1, "day-7 nurture fires for tenant A");
  assert.equal(firstRun.nurtureDay13, 0, "day-13 not yet due for tenant A");

  let subA = await getSubscription(app, a.tenantId);
  assert.ok(subA!.nurture_day7_sent_at !== null, "nurture_day7_sent_at recorded");
  assert.equal(subA!.nurture_day13_sent_at, null);
  const firstSentAt = subA!.nurture_day7_sent_at;

  // Re-running the job immediately must not re-send day-7 for tenant A.
  const secondRun = await trialExpiryJob(jobStub(), app.db);
  assert.equal(secondRun.nurtureDay7, 0, "day-7 nurture is not duplicated on a second run");

  subA = await getSubscription(app, a.tenantId);
  assert.equal(subA!.nurture_day7_sent_at, firstSentAt, "nurture_day7_sent_at is unchanged on re-run");

  // Tenant B: exactly 13 days in (1 day remaining) — day-13 due. Its day-7
  // mark is also unset (never ran while at day 7), so a catch-up run fires
  // both — this is a separate tenant so it doesn't interfere with A's assertions.
  const b = await registerTenant(app, "Echo Store", "owner@echo-trial.test");
  await app.db.query("UPDATE subscriptions SET trial_ends_at = @t WHERE tenant_id = @tenantId", {
    t: Date.now() + 1 * DAY_MS,
    tenantId: b.tenantId,
  });

  const thirdRun = await trialExpiryJob(jobStub(), app.db);
  assert.equal(thirdRun.nurtureDay13, 1, "day-13 nurture fires for tenant B");

  let subB = await getSubscription(app, b.tenantId);
  assert.ok(subB!.nurture_day13_sent_at !== null, "nurture_day13_sent_at recorded for tenant B");
  const bSentAt = subB!.nurture_day13_sent_at;

  const fourthRun = await trialExpiryJob(jobStub(), app.db);
  assert.equal(fourthRun.nurtureDay13, 0, "day-13 nurture is not duplicated for tenant B on a second run");
  subB = await getSubscription(app, b.tenantId);
  assert.equal(subB!.nurture_day13_sent_at, bSentAt);
});

// ─── 5. Upgraded tenants are untouched by the sweep ───────────────────────────

test("a tenant that upgraded to paid before expiry is untouched by the sweep", async () => {
  const app = await freshApp();
  const { tenantId } = await registerTenant(app, "Foxtrot Traders", "owner@foxtrot-trial.test");

  // Simulate an upgrade to a paid plan before the trial lapsed.
  await app.db.query(
    "UPDATE subscriptions SET status = 'active', plan = 'growth', trial_ends_at = @t WHERE tenant_id = @tenantId",
    { t: Date.now() - 1000, tenantId }, // even though "trial_ends_at" is in the past
  );

  const result = await trialExpiryJob(jobStub(), app.db);

  const sub = await getSubscription(app, tenantId);
  assert.equal(sub!.status, "active", "upgraded tenant's status is untouched by the sweep");
  assert.equal(sub!.plan, "growth");
  assert.equal(result.expired, 0, "the sweep does not count the upgraded tenant as expired");

  // And login still works normally.
  const login = await request(app.express, "POST", "/api/identity/login", {
    email: "owner@foxtrot-trial.test",
    password: PASSWORD,
  });
  assert.equal(login.status, 200, `login should still succeed: ${JSON.stringify(login.json)}`);
});
