/**
 * End-to-end smoke test for the assembled Ascend monolith.
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
  console.log("\nAscend — end-to-end smoke test (Postgres)\n");

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
    email: "owner@ascend.dev",
    password: "AscendDemo!2026",
  });
  assert.equal(r.status, 200);
  authToken = r.json.accessToken;
  assert.ok(authToken, "got access token");
  ok(`logged in as ${r.json.user.email} (tenant ${r.json.user.tenantId}, role ${r.json.user.role})`);

  r = await api("POST", "/api/v1/catalog", {
    sku: "TSHIRT-001", name: "Ascend Tee", price_cents: 2000, category: "apparel",
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

  const failedWorkflows = await db.query<{ id: string; type: string; current_step: string | null }>(
    "SELECT id, type, current_step FROM workflow_instances WHERE status = 'failed'",
  );
  assert.deepEqual(failedWorkflows, [], `workflow failures: ${JSON.stringify(failedWorkflows)}`);
  ok(`orchestration recorded no failed workflow instances`);

  // Critical mutations must leave audit trail entries (RULES.md: auditable
  // orders/payments/refunds). The lifecycle above created, paid, and refunded
  // an order — all three actions must appear in audit_log for this tenant.
  const auditActions = await db.query<{ action: string }>(
    `SELECT DISTINCT action FROM audit_log
     WHERE action IN ('order.created', 'payment.captured', 'order.refunded')`,
  );
  const found = auditActions.map((a) => a.action).sort();
  assert.deepEqual(
    found,
    ["order.created", "order.refunded", "payment.captured"],
    `audit trail incomplete — found only: ${JSON.stringify(found)}`,
  );
  ok(`audit log recorded order.created, payment.captured, order.refunded`);

  // ── Register lifecycle → end-of-day (Z-report) ────────────────────────────
  // RULES.md core retail flow: open register → sell → close register →
  // end-of-day report. Prove the drawer reconciliation is internally exact.
  r = await api("POST", "/api/v1/outlets", { name: "Smoke Outlet" });
  assert.equal(r.status, 201, `create outlet: ${JSON.stringify(r.json)}`);
  const outletId = r.json.id;
  r = await api("POST", `/api/v1/outlets/${outletId}/registers`, { name: "Till S" });
  assert.equal(r.status, 201, `create register: ${JSON.stringify(r.json)}`);
  const registerId = r.json.id;
  r = await api("POST", `/api/v1/outlets/registers/${registerId}/open`, { openingFloatCents: 10000 });
  assert.equal(r.status, 201, `open session: ${JSON.stringify(r.json)}`);
  ok(`register opened with $100.00 float`);

  // A cash sale during the session (its own product, kept independent of the
  // earlier lifecycle so this segment stands alone).
  r = await api("POST", "/api/v1/catalog", { sku: "SMOKE-Z", name: "Z Item", price_cents: 500, category: "general" });
  assert.equal(r.status, 201, `z product: ${JSON.stringify(r.json)}`);
  const zProductId = r.json.id;
  await api("POST", `/api/v1/inventory/${zProductId}/receive`, { quantity: 5 });
  r = await api("POST", "/api/v1/orders", { stateCode: "CA", lines: [{ productId: zProductId, quantity: 1 }] });
  assert.equal(r.status, 201, `z order: ${JSON.stringify(r.json)}`);
  const zOrder = r.json;
  r = await api("POST", "/api/v1/payments", { orderId: zOrder.id, method: "cash", tenderedCents: zOrder.total_cents });
  assert.equal(r.status, 201, `z payment: ${JSON.stringify(r.json)}`);
  ok(`cash sale rung through the open register`);

  // While OPEN, the report scoped to this register shows the shift open and no
  // counted drawer yet. Read the expected cash so the close can be exact.
  r = await api("GET", `/api/v1/reports/end-of-day?registerId=${registerId}`);
  assert.equal(r.status, 200, `eod(open): ${JSON.stringify(r.json)}`);
  assert.equal(r.json.status, "open", "shift open before close");
  assert.equal(r.json.cashDrawer.actualCash_cents, null, "no counted cash while open");
  assert.equal(r.json.cashDrawer.variance_cents, null, "no variance while open");
  const expectedCash = r.json.cashDrawer.expectedCash_cents;
  ok(`end-of-day report (open): expected drawer $${(expectedCash / 100).toFixed(2)}`);

  // Close counting a deliberate $2.50 overage — the Z-report must surface it.
  const counted = expectedCash + 250;
  r = await api("POST", `/api/v1/outlets/registers/${registerId}/close`, { countedCashCents: counted });
  assert.equal(r.status, 200, `close session: ${JSON.stringify(r.json)}`);

  r = await api("GET", `/api/v1/reports/end-of-day?registerId=${registerId}`);
  assert.equal(r.status, 200, `eod(closed): ${JSON.stringify(r.json)}`);
  assert.equal(r.json.status, "closed", "shift closed after close");
  assert.equal(r.json.cashDrawer.actualCash_cents, counted, "counted cash recorded");
  assert.equal(r.json.cashDrawer.variance_cents, 250, "Z-report surfaces the $2.50 overage");
  assert.ok(r.json.topItems.length > 0, "top items present");
  ok(`register closed -> Z-report reconciles: variance +$2.50`);

  // The register lifecycle must be auditable (RULES.md).
  const regAudit = await db.query<{ action: string }>(
    `SELECT DISTINCT action FROM audit_log
     WHERE action IN ('register.session_opened', 'register.session_closed')`,
  );
  assert.deepEqual(
    regAudit.map((a) => a.action).sort(),
    ["register.session_closed", "register.session_opened"],
    `register audit incomplete — found: ${JSON.stringify(regAudit)}`,
  );
  ok(`audit log recorded register.session_opened + register.session_closed`);

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
