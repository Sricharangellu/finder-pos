/**
 * End-to-end smoke test for the assembled Finder POS monolith.
 * Boots the real app (on Postgres) on an ephemeral port and drives the full POS
 * lifecycle over HTTP: catalog -> inventory -> order (tax engine) -> payment ->
 * sync, including the offline-first outbox story. Run: npm run smoke
 *
 * Uses DATABASE_URL if set, otherwise boots a throwaway embedded Postgres.
 */
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { ensurePg } from "./pg-harness.js";

// Commerce routes are tenant-scoped and require auth; the app needs a JWT secret
// to issue/verify tokens. Set one for the smoke run if not provided.
process.env.JWT_SECRET ??= "smoke-secret-finder-pos";

const { url, stop } = await ensurePg();
const schema = `smoke_${Date.now().toString(36)}`;
const { express: app, db } = await buildApp({ connectionString: url, schema });

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;
const base = `http://127.0.0.1:${port}`;

let authToken: string | null = null;

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authToken) headers["authorization"] = `Bearer ${authToken}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json();
  return { status: res.status, json };
}

let step = 0;
const ok = (msg: string) => console.log(`  ✓ [${++step}] ${msg}`);

async function main() {
  console.log("\nFinder POS — end-to-end smoke test (Postgres)\n");

  let r = await api("GET", "/health");
  assert.equal(r.status, 200);
  // The module registry grows over time; assert the core Year-1 lifecycle
  // modules are all mounted rather than pinning the exact (ever-changing) list.
  assert.ok(Array.isArray(r.json.modules), "modules is an array");
  const coreModules = ["catalog", "inventory", "orders", "payments", "sync"];
  for (const m of coreModules) {
    assert.ok(r.json.modules.includes(m), `core module "${m}" mounted`);
  }
  ok(`health ok, modules: ${r.json.modules.join(", ")}`);

  // Authenticate as the seeded demo owner (tenant tnt_demo) — commerce routes require it.
  r = await api("POST", "/api/identity/login", {
    email: "owner@finder-pos.dev",
    password: "FinderDemo!2026",
  });
  assert.equal(r.status, 200);
  authToken = r.json.accessToken;
  assert.ok(authToken, "got access token");
  ok(`logged in as ${r.json.user.email} (tenant ${r.json.user.tenantId}, role ${r.json.user.role})`);

  r = await api("POST", "/api/v1/catalog", {
    sku: "TSHIRT-001", name: "Finder Tee", price_cents: 2000, category: "apparel",
  });
  assert.equal(r.status, 201);
  const teeId = r.json.id;
  ok(`created taxable product ${r.json.name} @ $${(r.json.price_cents / 100).toFixed(2)}`);

  r = await api("POST", "/api/v1/catalog", {
    sku: "BEANS-001", name: "Organic Beans", price_cents: 1000, category: "groceries",
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.tax_class, "exempt");
  const beansId = r.json.id;
  ok(`created grocery product -> auto tax_class=exempt`);

  await api("POST", `/api/v1/inventory/${teeId}/receive`, { quantity: 50 });
  await api("POST", `/api/v1/inventory/${beansId}/receive`, { quantity: 30 });
  r = await api("GET", `/api/v1/inventory/${teeId}`);
  assert.equal(r.json.stockQty, 50);
  ok(`received stock: tee=50, beans=30`);

  await api("POST", "/api/v1/sync/online", { online: false });
  r = await api("GET", "/api/v1/sync/status");
  assert.equal(r.json.online, false);
  ok(`terminal toggled OFFLINE`);

  r = await api("POST", "/api/v1/orders", {
    stateCode: "CA",
    lines: [
      { productId: teeId, quantity: 2 },
      { productId: beansId, quantity: 1 },
    ],
  });
  assert.equal(r.status, 201);
  const order = r.json;
  assert.equal(order.subtotal_cents, 5000, "subtotal");
  assert.equal(order.tax_cents, 330, "CA tax on taxable portion only");
  assert.equal(order.total_cents, 5330, "total");
  ok(`order created: subtotal $50.00, CA tax $3.30 (beans exempt), total $53.30`);

  r = await api("GET", `/api/v1/inventory/${teeId}`);
  assert.equal(r.json.stockQty, 48, "tee 50-2");
  r = await api("GET", `/api/v1/inventory/${beansId}`);
  assert.equal(r.json.stockQty, 29, "beans 30-1");
  ok(`inventory auto-decremented: tee=48, beans=29`);

  r = await api("POST", "/api/v1/payments", {
    orderId: order.id, method: "split", cashCents: 4000, cardCents: 1330,
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, "captured");
  ok(`split payment captured (cash $40.00 + card $13.30), auth ${r.json.auth_code}`);

  r = await api("GET", "/api/v1/sync/status");
  assert.ok(r.json.pending > 0, "events queued while offline");
  assert.equal(r.json.synced, 0, "nothing synced while offline");
  const pendingBefore = r.json.pending;
  ok(`offline outbox holding ${pendingBefore} pending events, 0 synced`);

  r = await api("POST", "/api/v1/sync/online", { online: true });
  assert.ok(r.json.synced >= pendingBefore, "drained on reconnect");
  r = await api("GET", "/api/v1/sync/status");
  assert.equal(r.json.online, true);
  assert.equal(r.json.pending, 0, "queue drained");
  ok(`reconnected -> ${r.json.synced} events synced to cloud ledger, queue empty`);

  r = await api("POST", `/api/v1/orders/${order.id}/refund`);
  assert.equal(r.json.status, "refunded");
  r = await api("GET", `/api/v1/inventory/${teeId}`);
  assert.equal(r.json.stockQty, 50, "tee restocked");
  ok(`order refunded -> inventory restocked to tee=50`);

  // Observability: the lifecycle above should have produced RED metrics.
  const m = await fetch(base + "/metrics");
  const metricsText = await m.text();
  assert.equal(m.status, 200);
  assert.match(metricsText, /http_requests_total\{/);
  assert.match(metricsText, /http_request_duration_ms_count\{/);
  ok(`/metrics exposes RED metrics (Prometheus format)`);

  console.log(`\n✅ SMOKE PASSED — ${step} steps, full POS lifecycle verified end-to-end.\n`);
}

try {
  await main();
} finally {
  server.close();
  try {
    await db.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } catch {
    /* ignore */
  }
  await db.close();
  await stop();
}
