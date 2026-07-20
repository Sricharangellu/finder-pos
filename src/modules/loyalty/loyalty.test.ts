import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { v7 as uuidv7 } from "uuid";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

/** Auth as an arbitrary tenant/role — see gateway/tenant-isolation.test.ts. */
function tokenFor(tenantId: string, role: "owner" | "manager" | "cashier"): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign({ sub: `usr_${tenantId}_${role}`, tenantId, role }, secret, { expiresIn: "1h" });
}
function callAs(
  app: App,
  method: string,
  path: string,
  tenantId: string,
  role: "owner" | "manager" | "cashier",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const full = path.startsWith("/api/v1/") ? path : path.replace("/api/", "/api/v1/");
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") { server.close(); reject(new Error("bind failed")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1", port: address.port, path: full, method,
          headers: {
            authorization: `Bearer ${tokenFor(tenantId, role)}`,
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }); });
        },
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

/**
 * The loyalty module has no POST /members enrollment route (members are
 * presumably provisioned by a future admin flow) — seed one directly, the
 * same direct-db-write pattern customers.test.ts uses for event_outbox rows.
 */
async function seedMember(
  app: App,
  tenantId: string,
  customerId: string,
  opts: { tierId?: string | null; pointsBalance?: number; pointsLifetime?: number } = {},
): Promise<string> {
  const id = `lmem_${uuidv7()}`;
  const now = Date.now();
  await app.db.query(
    `INSERT INTO loyalty_members (id, tenant_id, customer_id, tier_id, points_balance, points_lifetime, joined_at, last_activity_at, updated_at)
     VALUES (@id, @t, @cust, @tier, @bal, @life, @now, @now, @now)`,
    { id, t: tenantId, cust: customerId, tier: opts.tierId ?? null, bal: opts.pointsBalance ?? 0, life: opts.pointsLifetime ?? 0, now },
  );
  return id;
}

async function makeCustomer(app: App, tenantId: string, name: string): Promise<string> {
  const r = await callAs(app, "POST", "/api/v1/customers/", tenantId, "owner", { name });
  assert.equal(r.status, 201, "customer creation must succeed for member seeding");
  return r.json.id as string;
}

// ─── Tiers ──────────────────────────────────────────────────────────────────

test("loyalty tiers: manager creates, lists, updates, deletes", async () => {
  const app = await freshApp();
  const create = await call(app, "POST", "/api/loyalty/tiers", {
    name: "Silver", level: "silver", points_required: 100, discount_pct: 5, description: "5% off",
  });
  assert.equal(create.status, 201);
  const tier = create.json;
  assert.ok(tier.id.startsWith("ltier_"));
  assert.equal(tier.member_count, 0);
  assert.equal(Number(tier.discount_pct), 5);

  const list = await call(app, "GET", "/api/loyalty/tiers");
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const patch = await call(app, "PATCH", `/api/loyalty/tiers/${tier.id}`, { discount_pct: 7.5 });
  assert.equal(patch.status, 200);
  assert.equal(Number(patch.json.discount_pct), 7.5);

  const del = await call(app, "DELETE", `/api/loyalty/tiers/${tier.id}`);
  assert.equal(del.status, 204);

  const after = await call(app, "GET", "/api/loyalty/tiers");
  assert.equal(after.json.items.length, 0);
});

test("loyalty tiers: 404 on update/delete of an unknown tier", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/loyalty/tiers/ltier_missing", { name: "X" })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/loyalty/tiers/ltier_missing")).status, 404);
});

test("loyalty tiers: validation rejects bad level/discount_pct", async () => {
  const app = await freshApp();
  let r = await call(app, "POST", "/api/loyalty/tiers", { name: "X", level: "diamond", points_required: 0, discount_pct: 1 });
  assert.equal(r.status, 400, "level must be one of the enum values");

  r = await call(app, "POST", "/api/loyalty/tiers", { name: "X", level: "gold", points_required: 0, discount_pct: 150 });
  assert.equal(r.status, 400, "discount_pct must be <= 100");
});

test("loyalty tiers: role gating — cashier is forbidden from create/update/delete, allowed to read", async () => {
  const app = await freshApp();
  const readOk = await callAs(app, "GET", "/api/v1/loyalty/tiers", "tnt_demo", "cashier");
  assert.equal(readOk.status, 200, "read is open to any authenticated role");

  const createForbidden = await callAs(app, "POST", "/api/v1/loyalty/tiers", "tnt_demo", "cashier", {
    name: "X", level: "bronze", points_required: 0, discount_pct: 1,
  });
  assert.equal(createForbidden.status, 403);

  const managerCreate = await callAs(app, "POST", "/api/v1/loyalty/tiers", "tnt_demo", "manager", {
    name: "X", level: "bronze", points_required: 0, discount_pct: 1,
  });
  assert.equal(managerCreate.status, 201, "manager role is sufficient");
  const tierId = managerCreate.json.id;

  const patchForbidden = await callAs(app, "PATCH", `/api/v1/loyalty/tiers/${tierId}`, "tnt_demo", "cashier", { name: "Y" });
  assert.equal(patchForbidden.status, 403);

  const deleteForbidden = await callAs(app, "DELETE", `/api/v1/loyalty/tiers/${tierId}`, "tnt_demo", "cashier");
  assert.equal(deleteForbidden.status, 403);
});

// ─── Members ────────────────────────────────────────────────────────────────

test("loyalty members: list/get join customer + tier names, 404 for unknown", async () => {
  const app = await freshApp();
  const tier = (await call(app, "POST", "/api/loyalty/tiers", {
    name: "Gold", level: "gold", points_required: 500, discount_pct: 10,
  })).json;
  const customerId = await makeCustomer(app, "tnt_demo", "Ada Lovelace");
  const memberId = await seedMember(app, "tnt_demo", customerId, { tierId: tier.id, pointsBalance: 50, pointsLifetime: 600 });

  const get = await call(app, "GET", `/api/loyalty/members/${memberId}`);
  assert.equal(get.status, 200);
  assert.equal(get.json.customer_name, "Ada Lovelace");
  assert.equal(get.json.tier_name, "Gold");
  assert.equal(get.json.points_balance, 50);

  const list = await call(app, "GET", "/api/loyalty/members");
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items[0].id, memberId);

  const filtered = await call(app, "GET", `/api/loyalty/members?tier_id=${tier.id}`);
  assert.equal(filtered.json.items.length, 1);

  const missing = await call(app, "GET", "/api/loyalty/members/lmem_missing");
  assert.equal(missing.status, 404);
});

// ─── adjustPoints: balances, tier auto-upgrade, clamping, role gating ──────

test("loyalty adjustPoints: positive delta increases balance + lifetime; negative delta floors at zero", async () => {
  const app = await freshApp();
  const customerId = await makeCustomer(app, "tnt_demo", "Grace Hopper");
  const memberId = await seedMember(app, "tnt_demo", customerId);

  const up = await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: 30 });
  assert.equal(up.status, 200);
  assert.equal(up.json.points_balance, 30);
  assert.equal(up.json.points_lifetime, 30);

  // Redeem more than the balance: clamps to 0, does not go negative, and a
  // negative delta must never increase lifetime (it's an earn-only counter).
  const down = await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: -1000 });
  assert.equal(down.status, 200);
  assert.equal(down.json.points_balance, 0, "balance clamps at zero, never negative");
  assert.equal(down.json.points_lifetime, 30, "lifetime points never decrease from a redemption");
});

test("loyalty adjustPoints: auto-upgrades to the highest eligible tier and publishes loyalty.tier_upgraded", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/loyalty/tiers", { name: "Bronze", level: "bronze", points_required: 0, discount_pct: 0 });
  const silver = (await call(app, "POST", "/api/loyalty/tiers", { name: "Silver", level: "silver", points_required: 100, discount_pct: 5 })).json;
  const gold = (await call(app, "POST", "/api/loyalty/tiers", { name: "Gold", level: "gold", points_required: 500, discount_pct: 10 })).json;

  const customerId = await makeCustomer(app, "tnt_demo", "Marie Curie");
  const memberId = await seedMember(app, "tnt_demo", customerId);

  const published: Array<{ type: string; payload: any }> = [];
  app.events.on("loyalty.tier_upgraded", (e) => { published.push(e as any); });

  // 150 lifetime points crosses the silver (100) but not gold (500) threshold.
  const afterSilver = await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: 150 });
  assert.equal(afterSilver.status, 200);
  assert.equal(afterSilver.json.tier_id, silver.id);
  assert.equal(published.length, 1);
  assert.equal(published[0].payload.tierName, "Silver");

  // Crossing 500 lifetime upgrades straight to gold (highest eligible), not silver again.
  const afterGold = await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: 400 });
  assert.equal(afterGold.status, 200);
  assert.equal(afterGold.json.tier_id, gold.id);
  assert.equal(afterGold.json.points_lifetime, 550);
  assert.equal(published.length, 2);
  assert.equal(published[1].payload.tierName, "Gold");

  // A further earn that doesn't cross a new threshold must not republish.
  await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: 5 });
  assert.equal(published.length, 2, "no spurious tier_upgraded when the eligible tier hasn't changed");
});

test("loyalty adjustPoints: 404 for an unknown member", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/loyalty/members/lmem_missing/adjust", { delta: 10 });
  assert.equal(r.status, 404);
});

test("loyalty adjustPoints: validation rejects a non-integer delta", async () => {
  const app = await freshApp();
  const customerId = await makeCustomer(app, "tnt_demo", "Non Integer");
  const memberId = await seedMember(app, "tnt_demo", customerId);
  const r = await call(app, "POST", `/api/loyalty/members/${memberId}/adjust`, { delta: 1.5 });
  assert.equal(r.status, 400);
});

test("loyalty adjustPoints: role gating — only manager+ may adjust", async () => {
  const app = await freshApp();
  const customerId = await makeCustomer(app, "tnt_demo", "Role Gated");
  const memberId = await seedMember(app, "tnt_demo", customerId);

  const asCashier = await callAs(app, "POST", `/api/v1/loyalty/members/${memberId}/adjust`, "tnt_demo", "cashier", { delta: 10 });
  assert.equal(asCashier.status, 403);

  const asManager = await callAs(app, "POST", `/api/v1/loyalty/members/${memberId}/adjust`, "tnt_demo", "manager", { delta: 10 });
  assert.equal(asManager.status, 200);
});

// ─── Rewards ────────────────────────────────────────────────────────────────

test("loyalty rewards: manager creates/updates/deletes, status filter works", async () => {
  const app = await freshApp();
  const create = await call(app, "POST", "/api/loyalty/rewards", {
    name: "$5 off", points_cost: 100, discount_cents: 500,
  });
  assert.equal(create.status, 201);
  assert.equal(create.json.status, "active");
  assert.equal(create.json.redemption_count, 0);
  const rewardId = create.json.id;

  const patch = await call(app, "PATCH", `/api/loyalty/rewards/${rewardId}`, { status: "inactive" });
  assert.equal(patch.status, 200);
  assert.equal(patch.json.status, "inactive");

  const activeList = await call(app, "GET", "/api/loyalty/rewards?status=active");
  assert.equal(activeList.json.items.length, 0);
  const inactiveList = await call(app, "GET", "/api/loyalty/rewards?status=inactive");
  assert.equal(inactiveList.json.items.length, 1);

  const del = await call(app, "DELETE", `/api/loyalty/rewards/${rewardId}`);
  assert.equal(del.status, 204);
  const missing = await call(app, "GET", `/api/loyalty/rewards`);
  assert.equal(missing.json.items.length, 0);
});

test("loyalty rewards: 404 for unknown reward; validation rejects points_cost < 1", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/loyalty/rewards/lrwd_missing", { name: "X" })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/loyalty/rewards/lrwd_missing")).status, 404);

  const r = await call(app, "POST", "/api/loyalty/rewards", { name: "Bad", points_cost: 0, discount_cents: 100 });
  assert.equal(r.status, 400);
});

test("loyalty rewards: role gating — cashier forbidden from write routes", async () => {
  const app = await freshApp();
  const forbidden = await callAs(app, "POST", "/api/v1/loyalty/rewards", "tnt_demo", "cashier", {
    name: "X", points_cost: 10, discount_cents: 100,
  });
  assert.equal(forbidden.status, 403);

  const readOk = await callAs(app, "GET", "/api/v1/loyalty/rewards", "tnt_demo", "cashier");
  assert.equal(readOk.status, 200);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("loyalty: tenant isolation across tiers, members, and rewards", async () => {
  const app = await freshApp();
  const tier = await callAs(app, "POST", "/api/v1/loyalty/tiers", "tnt_demo", "manager", {
    name: "Platinum", level: "platinum", points_required: 1000, discount_pct: 15,
  });
  assert.equal(tier.status, 201);
  const tierId = tier.json.id;

  const customerId = await makeCustomer(app, "tnt_demo", "Isolated Customer");
  const memberId = await seedMember(app, "tnt_demo", customerId, { tierId, pointsBalance: 10, pointsLifetime: 10 });

  const reward = await callAs(app, "POST", "/api/v1/loyalty/rewards", "tnt_demo", "manager", {
    name: "Iso Reward", points_cost: 10, discount_cents: 50,
  });
  const rewardId = reward.json.id;

  // Cross-tenant reads: nothing must be visible.
  const tiersOther = await callAs(app, "GET", "/api/v1/loyalty/tiers", "tnt_other", "owner");
  assert.deepEqual(tiersOther.json.items, []);

  const membersOther = await callAs(app, "GET", "/api/v1/loyalty/members", "tnt_other", "owner");
  assert.deepEqual(membersOther.json.items, []);
  const memberGetOther = await callAs(app, "GET", `/api/v1/loyalty/members/${memberId}`, "tnt_other", "owner");
  assert.equal(memberGetOther.status, 404);

  const rewardsOther = await callAs(app, "GET", "/api/v1/loyalty/rewards", "tnt_other", "owner");
  assert.deepEqual(rewardsOther.json.items, []);

  // Cross-tenant writes must not affect the owning tenant's rows.
  const crossPatchTier = await callAs(app, "PATCH", `/api/v1/loyalty/tiers/${tierId}`, "tnt_other", "manager", { name: "Hijacked" });
  assert.equal(crossPatchTier.status, 404);
  const crossAdjust = await callAs(app, "POST", `/api/v1/loyalty/members/${memberId}/adjust`, "tnt_other", "manager", { delta: 999 });
  assert.equal(crossAdjust.status, 404);
  const crossDeleteReward = await callAs(app, "DELETE", `/api/v1/loyalty/rewards/${rewardId}`, "tnt_other", "manager");
  assert.equal(crossDeleteReward.status, 404);

  // Owning tenant's data is untouched.
  const ownTier = await callAs(app, "GET", "/api/v1/loyalty/tiers", "tnt_demo", "owner");
  assert.equal(ownTier.json.items[0].name, "Platinum");
  const ownMember = await callAs(app, "GET", `/api/v1/loyalty/members/${memberId}`, "tnt_demo", "owner");
  assert.equal(ownMember.json.points_balance, 10);
  const ownReward = await callAs(app, "GET", "/api/v1/loyalty/rewards", "tnt_demo", "owner");
  assert.equal(ownReward.json.items.length, 1);
});
