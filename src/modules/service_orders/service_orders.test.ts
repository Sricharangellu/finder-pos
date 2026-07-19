/**
 * service_orders.test.ts — integration coverage for service_orders
 * (repair/service job tracking with a linear status state machine).
 *
 * Covers: CRUD, the draft -> open -> in_progress -> ready -> closed state
 * machine (including rejecting skips and post-terminal transitions),
 * list filters (status, q, pagination), validation (400s), 404s, role
 * gating, and tenant isolation, all against real embedded Postgres. The
 * `service_orders` table name was checked against every other module's
 * migrations before writing this (no collision found — see the
 * store_locations regression this session found and fixed for what a
 * collision looks like).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

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

// ─── CRUD lifecycle ─────────────────────────────────────────────────────────

test("service_orders: create/get/list/update round-trip", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/service-orders", {
    title: "Fix espresso machine", description: "Grinder jammed", estimate_cents: 5000,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.status, "draft");
  assert.equal(created.json.title, "Fix espresso machine");
  assert.equal(created.json.estimate_cents, 5000);
  assert.equal(created.json.actual_cents, null);
  const id = created.json.id;
  assert.ok(id.startsWith("svo_"));

  const got = await call(app, "GET", `/api/service-orders/${id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.id, id);

  const list = await call(app, "GET", "/api/service-orders");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((o: any) => o.id === id));
  assert.equal(list.json.total >= 1, true);

  const updated = await call(app, "PATCH", `/api/service-orders/${id}`, { title: "Fix espresso machine (urgent)", actual_cents: 4500 });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.title, "Fix espresso machine (urgent)");
  assert.equal(updated.json.actual_cents, 4500);
  assert.equal(updated.json.status, "draft", "plain field update does not change status");
});

test("service_orders: list supports status filter, text search (q), and pagination", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/service-orders", { title: "Alpha repair" });
  const beta = (await call(app, "POST", "/api/service-orders", { title: "Beta repair" })).json;
  await call(app, "PATCH", `/api/service-orders/${beta.id}`, { status: "open" });

  const byStatus = await call(app, "GET", "/api/service-orders?status=open");
  assert.equal(byStatus.status, 200);
  assert.ok(byStatus.json.items.every((o: any) => o.status === "open"));
  assert.ok(byStatus.json.items.some((o: any) => o.id === beta.id));

  const byQ = await call(app, "GET", "/api/service-orders?q=Alpha");
  assert.ok(byQ.json.items.some((o: any) => o.title === "Alpha repair"));
  assert.ok(!byQ.json.items.some((o: any) => o.title === "Beta repair"));

  const paged = await call(app, "GET", "/api/service-orders?limit=1&offset=0");
  assert.equal(paged.json.items.length, 1);
  assert.equal(paged.json.limit, 1);
});

// ─── State machine ──────────────────────────────────────────────────────────

test("service_orders: status transitions draft -> open -> in_progress -> ready -> closed", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/service-orders", { title: "Full cycle" })).json;
  const id = created.id;

  let r = await call(app, "PATCH", `/api/service-orders/${id}`, { status: "open" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "open");

  r = await call(app, "PATCH", `/api/service-orders/${id}`, { status: "in_progress" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "in_progress");

  r = await call(app, "PATCH", `/api/service-orders/${id}`, { status: "ready" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "ready");

  r = await call(app, "PATCH", `/api/service-orders/${id}`, { status: "closed" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "closed");

  const after = await call(app, "GET", `/api/service-orders/${id}`);
  assert.equal(after.json.status, "closed");
});

test("service_orders: cannot skip states (draft -> in_progress directly)", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/service-orders", { title: "Skip attempt" })).json;
  const r = await call(app, "PATCH", `/api/service-orders/${created.id}`, { status: "in_progress" });
  assert.equal(r.status, 400);
});

test("service_orders: cannot transition out of closed (terminal state)", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/service-orders", { title: "Terminal" })).json;
  const id = created.id;
  await call(app, "PATCH", `/api/service-orders/${id}`, { status: "open" });
  await call(app, "PATCH", `/api/service-orders/${id}`, { status: "in_progress" });
  await call(app, "PATCH", `/api/service-orders/${id}`, { status: "ready" });
  await call(app, "PATCH", `/api/service-orders/${id}`, { status: "closed" });

  const r = await call(app, "PATCH", `/api/service-orders/${id}`, { status: "open" });
  assert.equal(r.status, 400, "closed is terminal — no further transitions allowed");
});

test("service_orders: cannot go backwards (open -> draft)", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/service-orders", { title: "Backwards attempt" })).json;
  await call(app, "PATCH", `/api/service-orders/${created.id}`, { status: "open" });
  const r = await call(app, "PATCH", `/api/service-orders/${created.id}`, { status: "draft" });
  assert.equal(r.status, 400);
});

// ─── Validation (400s) ──────────────────────────────────────────────────────

test("service_orders: create rejects missing/empty title", async () => {
  const app = await freshApp();
  const r1 = await call(app, "POST", "/api/service-orders", {});
  assert.equal(r1.status, 400);
  const r2 = await call(app, "POST", "/api/service-orders", { title: "" });
  assert.equal(r2.status, 400);
});

test("service_orders: patch rejects an unrecognized status enum value", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/service-orders", { title: "X" })).json;
  const r = await call(app, "PATCH", `/api/service-orders/${created.id}`, { status: "bogus" });
  assert.equal(r.status, 400);
});

// ─── 404s ───────────────────────────────────────────────────────────────────

test("service_orders: 404 for get/patch on an unknown id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "GET", "/api/service-orders/svo_missing")).status, 404);
  assert.equal((await call(app, "PATCH", "/api/service-orders/svo_missing", { title: "x" })).status, 404);
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("service_orders: cashier is rejected (403) from create/update, reads remain open", async () => {
  const app = await freshApp();
  const createByCashier = await callAs(app, "POST", "/api/v1/service-orders", "tnt_demo", "cashier", { title: "Nope" });
  assert.equal(createByCashier.status, 403);

  const order = (await call(app, "POST", "/api/service-orders", { title: "Owned by manager+" })).json;
  const patchByCashier = await callAs(app, "PATCH", `/api/v1/service-orders/${order.id}`, "tnt_demo", "cashier", { status: "open" });
  assert.equal(patchByCashier.status, 403);

  const readByCashier = await callAs(app, "GET", "/api/v1/service-orders", "tnt_demo", "cashier");
  assert.equal(readByCashier.status, 200);
  const readOneByCashier = await callAs(app, "GET", `/api/v1/service-orders/${order.id}`, "tnt_demo", "cashier");
  assert.equal(readOneByCashier.status, 200);
});

test("service_orders: manager can create and transition", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/service-orders", "tnt_demo", "manager", { title: "Manager created" });
  assert.equal(created.status, 201);
  const transitioned = await callAs(app, "PATCH", `/api/v1/service-orders/${created.json.id}`, "tnt_demo", "manager", { status: "open" });
  assert.equal(transitioned.status, 200);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("service_orders: tenant isolation — an order created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/service-orders", "tnt_demo", "owner", { title: "Isolated order" });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const crossGet = await callAs(app, "GET", `/api/v1/service-orders/${id}`, "tnt_other", "owner");
  assert.equal(crossGet.status, 404, "cross-tenant GET by id must 404");

  const crossList = await callAs(app, "GET", "/api/v1/service-orders", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.ok(!crossList.json.items.some((o: any) => o.id === id), "cross-tenant list must not leak rows");

  const crossPatch = await callAs(app, "PATCH", `/api/v1/service-orders/${id}`, "tnt_other", "owner", { status: "open" });
  assert.equal(crossPatch.status, 404, "cross-tenant patch must 404, not act on another tenant's order");

  const ownGet = await callAs(app, "GET", `/api/v1/service-orders/${id}`, "tnt_demo", "owner");
  assert.equal(ownGet.status, 200);
  assert.equal(ownGet.json.status, "draft", "original tenant's order untouched by the cross-tenant attempt");
});
