import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { getSyncEngine, type SyncEngine } from "./index.js";

// Per-test schema isolation against the shared Postgres instance.
let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

/**
 * Test hooks live on the engine instance (returned by getSyncEngine()):
 *  - engine.setUploader(fn): replace the cloud uploader (throw to fail).
 *  - engine.failNext(n): force the next n upload attempts to throw.
 *  - engine.pushSync({ forceAll, now }): drive the worker deterministically.
 */
async function freshApp(): Promise<{ app: App; engine: SyncEngine }> {
  const app = await buildApp({ schema: __schema() });
  const engine = getSyncEngine();
  assert.ok(engine, "sync engine should be wired during register");
  return { app, engine };
}

async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

/** Emit a few representative domain events onto the bus. */
async function publishSome(app: App): Promise<void> {
  await app.events.publish("product.created", { id: "prod_1", sku: "A-1" }, "prod_1");
  await app.events.publish(
    "order.created",
    { id: "ord_1", orderNumber: "1001", totalCents: 500 },
    "ord_1",
  );
  await app.events.publish(
    "payment.captured",
    { id: "pay_1", orderId: "ord_1", method: "cash", amountCents: 500 },
    "pay_1",
  );
}

test("offline: events queue as pending and are NOT synced", async () => {
  const { app, engine } = await freshApp();
  await call(app, "POST", "/api/sync/online", { online: false });
  assert.equal(engine.isOnline(), false);

  const before = await engine.counts();
  await publishSome(app);
  const after = await engine.counts();

  assert.equal(after.pending, before.pending + 3);

  const push = await call(app, "POST", "/api/sync/push", {});
  assert.equal(push.json.attempted, 0);
  assert.equal((await engine.counts()).synced, 0);

  const status = await call(app, "GET", "/api/sync/status");
  assert.equal(status.json.online, false);
  assert.ok(status.json.pending >= 3);
  assert.equal(status.json.synced, 0);
});

test("toggle online drains queued events to synced", async () => {
  const { app, engine } = await freshApp();
  await call(app, "POST", "/api/sync/online", { online: false });
  await publishSome(app);
  const pendingBefore = (await engine.counts()).pending;
  assert.ok(pendingBefore >= 3);

  const res = await call(app, "POST", "/api/sync/online", { online: true });
  assert.equal(res.json.online, true);
  assert.equal(res.json.drained.synced, pendingBefore);

  const status = await call(app, "GET", "/api/sync/status");
  assert.equal(status.json.online, true);
  assert.equal(status.json.pending, 0);
  assert.equal(status.json.synced, pendingBefore);
  assert.equal(status.json.failed, 0);
});

test("simulated failure increments attempts then marks failed after max", async () => {
  const { app, engine } = await freshApp();
  await engine.pushSync({ forceAll: true });
  assert.equal((await engine.counts()).pending, 0);

  await app.events.publish("order.created", { id: "ord_fail", totalCents: 100 }, "ord_fail");
  assert.equal((await engine.counts()).pending, 1);

  engine.setUploader(() => {
    throw new Error("network down");
  });

  await engine.pushSync({ forceAll: true });
  let row = await app.db.one<any>(
    "SELECT * FROM sync_queue WHERE event_type = 'order.created'",
  );
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);

  for (let i = 0; i < 12; i++) await engine.pushSync({ forceAll: true });
  row = await app.db.one<any>("SELECT * FROM sync_queue WHERE event_type = 'order.created'");
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 10);
  assert.ok(typeof row.last_attempted_at === "number");

  assert.equal((await engine.counts()).failed, 1);
});

test("failNext hook: one failure then success", async () => {
  const { app, engine } = await freshApp();
  await engine.pushSync({ forceAll: true });

  await app.events.publish("payment.captured", { id: "pay_x", amountCents: 1 }, "pay_x");
  const target = "payment.captured";

  engine.failNext(1);
  await engine.pushSync({ forceAll: true });
  let row = await app.db.one<any>("SELECT * FROM sync_queue WHERE event_type = ?", [target]);
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);

  await engine.pushSync({ forceAll: true });
  row = await app.db.one<any>("SELECT * FROM sync_queue WHERE event_type = ?", [target]);
  assert.equal(row.status, "synced");
});

test("GET /queue filters by status and returns Page shape", async () => {
  const { app, engine } = await freshApp();
  await engine.pushSync({ forceAll: true }); // synced seeded events

  await call(app, "POST", "/api/sync/online", { online: false });
  await app.events.publish("order.created", { id: "ord_q", totalCents: 1 }, "ord_q");

  const pending = await call(app, "GET", "/api/sync/queue?status=pending");
  assert.ok(Array.isArray(pending.json.items));
  assert.equal(typeof pending.json.total, "number");
  assert.equal(typeof pending.json.limit, "number");
  assert.equal(typeof pending.json.offset, "number");
  assert.ok(pending.json.items.every((r: any) => r.status === "pending"));
  assert.ok(pending.json.items.some((r: any) => r.event_type === "order.created"));

  const synced = await call(app, "GET", "/api/sync/queue?status=synced");
  assert.ok(synced.json.items.every((r: any) => r.status === "synced"));
});

test("GET /queue rejects an invalid status filter with 400", async () => {
  const { app } = await freshApp();

  const res = await call(app, "GET", "/api/sync/queue?status=bogus");
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "bad_request");
});

test("outbox stores payload + meta as JSON", async () => {
  const { app } = await freshApp();
  await app.events.publish("product.created", { id: "prod_meta", sku: "M-1" }, "prod_meta");
  const row = await app.db.one<any>(
    "SELECT * FROM sync_queue WHERE event_type = 'product.created' ORDER BY id DESC LIMIT 1",
  );
  const parsed = JSON.parse(row.payload);
  assert.equal(parsed.payload.id, "prod_meta");
  assert.equal(parsed.meta.aggregateId, "prod_meta");
  assert.ok(typeof parsed.meta.occurredAt === "string");
});

test("POST /pull returns the Year 2 stub", async () => {
  const { app } = await freshApp();
  const res = await call(app, "POST", "/api/sync/pull", {});
  assert.equal(res.status, 200);
  assert.equal(res.json.pulled, 0);
  assert.match(res.json.note, /stub/);
});

// ─── Authorization: sync mutations are role-gated (session D, loop iter 6) ─────
// These mutate company-wide state / connect external integrations and were
// previously reachable by any authenticated user (incl. cashier).
import http from "node:http";
import jwt from "jsonwebtoken";

function callAs(app: App, role: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: "usr_role_test", tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
  const p = path.replace("/api/", "/api/v1/");
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(payload)); }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method, path: p, headers }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); let json: any; try { json = data ? JSON.parse(data) : undefined; } catch { json = data; } resolve({ status: res.statusCode ?? 0, json }); });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test("cashier cannot control sync or connect integrations (403); manager can toggle sync", async () => {
  const { app } = await freshApp();

  // Operational sync controls: manager+ only.
  assert.equal((await callAs(app, "cashier", "POST", "/api/sync/online", { online: false })).status, 403, "cashier /online → 403");
  assert.equal((await callAs(app, "cashier", "POST", "/api/sync/push", {})).status, 403, "cashier /push → 403");
  assert.equal((await callAs(app, "cashier", "POST", "/api/sync/pull", {})).status, 403, "cashier /pull → 403");

  // Integration config: owner only (manager also denied).
  assert.equal((await callAs(app, "cashier", "POST", "/api/sync/integrations", { providerId: "p1" })).status, 403, "cashier /integrations → 403");
  assert.equal((await callAs(app, "manager", "POST", "/api/sync/integrations", { providerId: "p1" })).status, 403, "manager /integrations → 403 (owner-only)");

  // A manager can still run operational sync controls.
  assert.equal((await callAs(app, "manager", "POST", "/api/sync/online", { online: false })).status, 200, "manager /online → 200");

  // Reads stay open to any authenticated role.
  assert.equal((await callAs(app, "cashier", "GET", "/api/sync/status")).status, 200, "cashier can read status");
});
