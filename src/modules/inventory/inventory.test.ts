import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

// Per-test schema isolation against the shared Postgres instance.
let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
import type { DomainEvent } from "../../shared/types.js";

async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
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

test("missing inventory row reports zeroed stock (no 404)", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/inventory/prod_nope");
  assert.equal(status, 200);
  assert.equal(json.productId, "prod_nope");
  assert.equal(json.stockQty, 0);
  assert.equal(json.reorderPt, 0);
});

test("receive increases stock (201)", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/inventory/prod_a/receive", {
    quantity: 10,
  });
  assert.equal(status, 201);
  assert.equal(json.productId, "prod_a");
  assert.equal(json.stockQty, 10);

  const got = await call(app, "GET", "/api/inventory/prod_a");
  assert.equal(got.json.stockQty, 10);
});

test("manual adjust changes stock", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_b/receive", { quantity: 5 });
  const { status, json } = await call(app, "POST", "/api/inventory/prod_b/adjust", {
    delta: 3,
    reason: "adjustment",
  });
  assert.equal(status, 200);
  assert.equal(json.stockQty, 8);
});

test("manual adjust rejects a zero delta (400) and records no movement", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_z/receive", { quantity: 5 });
  const { status, json } = await call(app, "POST", "/api/inventory/prod_z/adjust", {
    delta: 0,
    reason: "adjustment",
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "validation_error");

  // Stock unchanged and no spurious 'adjustment' movement was written.
  const stock = await call(app, "GET", "/api/inventory/prod_z");
  assert.equal(stock.json.stockQty, 5);
  const moves = await call(app, "GET", "/api/inventory/prod_z/movements");
  assert.equal(moves.json.filter((m: any) => m.reason === "adjustment").length, 0);
});

test("manual adjust rejects system-only reasons like 'sale' (400)", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_s/receive", { quantity: 5 });
  const { status, json } = await call(app, "POST", "/api/inventory/prod_s/adjust", {
    delta: -2,
    reason: "sale",
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "validation_error");

  // No phantom 'sale' movement that refund-restock would later reverse.
  const moves = await call(app, "GET", "/api/inventory/prod_s/movements");
  assert.equal(moves.json.filter((m: any) => m.reason === "sale").length, 0);
  const stock = await call(app, "GET", "/api/inventory/prod_s");
  assert.equal(stock.json.stockQty, 5);
});

test("stock never goes negative (clamp at 0)", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_c/receive", { quantity: 2 });
  const { json } = await call(app, "POST", "/api/inventory/prod_c/adjust", {
    delta: -10,
    reason: "adjustment",
  });
  assert.equal(json.stockQty, 0);
});

test("clamped adjustment records the applied delta, not the requested one", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_cl/receive", { quantity: 2 });
  // Request -10 against 2 on hand; stock floors at 0, so only -2 was applied.
  await call(app, "POST", "/api/inventory/prod_cl/adjust", {
    delta: -10,
    reason: "adjustment",
  });

  const { json } = await call(app, "GET", "/api/inventory/prod_cl/movements");
  const adj = json.find((m: any) => m.reason === "adjustment");
  assert.equal(adj.delta, -2); // applied (clamped), not the requested -10

  // The ledger must reconcile with current stock: sum(deltas) == stock_qty (0).
  const sum = json.reduce((s: number, m: any) => s + m.delta, 0);
  assert.equal(sum, 0);
});

test("refund of an oversold order does not resurrect phantom stock", async () => {
  const app = await freshApp();
  // Only 2 units on hand...
  await call(app, "POST", "/api/inventory/prod_os/receive", { quantity: 2 });

  // ...but an order rings up 5 (an offline oversell). Stock floors at 0 and the
  // 'sale' movement records the applied -2, not the requested -5.
  await app.events.publish(
    "order.created",
    {
      id: "ord_os", tenantId: "tnt_demo",
      orderNumber: "FP-OS",
      stateCode: "CA",
      totalCents: 2500,
      lines: [{ productId: "prod_os", quantity: 5, unitCents: 500 }],
    },
    "ord_os",
  );
  assert.equal((await call(app, "GET", "/api/inventory/prod_os")).json.stockQty, 0);

  // Refunding must restock only what was actually removed (2) — never the
  // requested 5, which would create 3 phantom units out of nothing.
  await app.events.publish(
    "order.refunded",
    { id: "ord_os", tenantId: "tnt_demo", orderNumber: "FP-OS", totalCents: 2500 },
    "ord_os",
  );
  assert.equal((await call(app, "GET", "/api/inventory/prod_os")).json.stockQty, 2);
});

test("order.created event decrements stock for each line", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_x/receive", { quantity: 10 });
  await call(app, "POST", "/api/inventory/prod_y/receive", { quantity: 5 });

  await app.events.publish(
    "order.created",
    {
      id: "ord_1", tenantId: "tnt_demo",
      orderNumber: "FP-1",
      stateCode: "CA",
      totalCents: 1500,
      lines: [
        { productId: "prod_x", quantity: 2, unitCents: 500 },
        { productId: "prod_y", quantity: 1, unitCents: 500 },
      ],
    },
    "ord_1",
  );

  const x = await call(app, "GET", "/api/inventory/prod_x");
  const y = await call(app, "GET", "/api/inventory/prod_y");
  assert.equal(x.json.stockQty, 8);
  assert.equal(y.json.stockQty, 4);
});

test("order.refunded restocks reversed sale movements", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_r/receive", { quantity: 10 });

  await app.events.publish(
    "order.created",
    {
      id: "ord_2", tenantId: "tnt_demo",
      orderNumber: "FP-2",
      stateCode: "CA",
      totalCents: 1000,
      lines: [{ productId: "prod_r", quantity: 3, unitCents: 500 }],
    },
    "ord_2",
  );

  let stock = await call(app, "GET", "/api/inventory/prod_r");
  assert.equal(stock.json.stockQty, 7);

  await app.events.publish(
    "order.refunded",
    { id: "ord_2", tenantId: "tnt_demo", orderNumber: "FP-2", totalCents: 1000 },
    "ord_2",
  );

  stock = await call(app, "GET", "/api/inventory/prod_r");
  assert.equal(stock.json.stockQty, 10);

  // A 'return' movement should have been recorded.
  const movements = await call(app, "GET", "/api/inventory/prod_r/movements");
  assert.ok(movements.json.some((m: any) => m.reason === "return" && m.ref === "ord_2"));
});

test("redelivered order.refunded does not double-restock (idempotent)", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_ri/receive", { quantity: 10 });

  await app.events.publish(
    "order.created",
    {
      id: "ord_ri", tenantId: "tnt_demo",
      orderNumber: "FP-RI",
      stateCode: "CA",
      totalCents: 1000,
      lines: [{ productId: "prod_ri", quantity: 3, unitCents: 500 }],
    },
    "ord_ri",
  );
  assert.equal((await call(app, "GET", "/api/inventory/prod_ri")).json.stockQty, 7);

  // Same refund event delivered twice (e.g. outbox replay). Stock must settle
  // at 10, not 13 — the second delivery is a no-op.
  const refund = () =>
    app.events.publish(
      "order.refunded",
      { id: "ord_ri", tenantId: "tnt_demo", orderNumber: "FP-RI", totalCents: 1000 },
      "ord_ri",
    );
  await refund();
  await refund();

  assert.equal((await call(app, "GET", "/api/inventory/prod_ri")).json.stockQty, 10);

  // Exactly one 'return' movement was recorded for the ref.
  const movements = await call(app, "GET", "/api/inventory/prod_ri/movements");
  const returns = movements.json.filter(
    (m: any) => m.reason === "return" && m.ref === "ord_ri",
  );
  assert.equal(returns.length, 1);
});

test("lowStock filter returns only items at/below reorder point", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_low/receive", { quantity: 2 });
  await call(app, "PUT", "/api/inventory/prod_low/reorder-point", { reorderPt: 5 });
  await call(app, "POST", "/api/inventory/prod_high/receive", { quantity: 20 });
  await call(app, "PUT", "/api/inventory/prod_high/reorder-point", { reorderPt: 5 });

  const { status, json } = await call(app, "GET", "/api/inventory/?lowStock=true");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(json.items.some((i: any) => i.product_id === "prod_low"));
  assert.ok(!json.items.some((i: any) => i.product_id === "prod_high"));
});

test("lowStock filter excludes untracked products (reorder point 0)", async () => {
  // Regression: an untracked product (reorder_pt = 0) with 0 stock satisfies
  // "stock_qty <= reorder_pt" (0 <= 0) and used to be flagged as low-stock,
  // inconsistent with overview()/levels() which exclude reorder_pt = 0. A
  // product is only "low" once it has a SET (positive) reorder point.
  const app = await freshApp();
  // prod_untracked: an inventory row at 0 stock with NO reorder point set.
  // (Receive then sell back to 0 so the row exists with reorder_pt = 0.)
  await call(app, "POST", "/api/inventory/prod_untracked/receive", { quantity: 3 });
  await call(app, "POST", "/api/inventory/prod_untracked/adjust", { delta: -3, reason: "adjustment" });
  // prod_tracked: genuinely low against a positive reorder point.
  await call(app, "POST", "/api/inventory/prod_tracked/receive", { quantity: 1 });
  await call(app, "PUT", "/api/inventory/prod_tracked/reorder-point", { reorderPt: 5 });

  const { status, json } = await call(app, "GET", "/api/inventory/?lowStock=true");
  assert.equal(status, 200);
  assert.ok(json.items.some((i: any) => i.product_id === "prod_tracked"));
  assert.ok(!json.items.some((i: any) => i.product_id === "prod_untracked"));
});

test("list returns cursor-pagination shape", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_p/receive", { quantity: 1 });
  const { json } = await call(app, "GET", "/api/inventory/");
  assert.ok(Array.isArray(json.items));
  assert.equal(typeof json.limit, "number");
  assert.ok(json.nextCursor === null || typeof json.nextCursor === "string");
});

test("movements history records receive and adjust", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/inventory/prod_m/receive", { quantity: 4 });
  await call(app, "POST", "/api/inventory/prod_m/adjust", { delta: -1, reason: "adjustment" });
  const { json } = await call(app, "GET", "/api/inventory/prod_m/movements");
  assert.equal(json.length, 2);
  assert.ok(json.some((m: any) => m.reason === "receiving" && m.delta === 4));
  assert.ok(json.some((m: any) => m.reason === "adjustment" && m.delta === -1));
  assert.ok(json.every((m: any) => m.id.startsWith("mov_")));
});

test("reorder-point can be set before any stock exists", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "PUT", "/api/inventory/prod_rp/reorder-point", {
    reorderPt: 7,
  });
  assert.equal(status, 200);
  assert.equal(json.reorderPt, 7);
  assert.equal(json.stockQty, 0);
});

test("inventory.adjusted is emitted on the bus", async () => {
  const app = await freshApp();
  const events: DomainEvent[] = [];
  app.events.on("inventory.adjusted", (e) => { events.push(e); });

  await call(app, "POST", "/api/inventory/prod_evt/receive", { quantity: 6 });

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, "inventory.adjusted");
  assert.equal(e.aggregateId, "prod_evt");
  const p = e.payload as any;
  assert.equal(p.productId, "prod_evt");
  assert.equal(p.delta, 6);
  assert.equal(p.reason, "receiving");
  assert.equal(p.stockQty, 6);
});

// ── Availability breakdown (retail product benchmark #2) ─────────────────────

test("availability = on-hand / reserved (approved unshipped SO) / incoming (open PO remainder)", async () => {
  const app = await freshApp();
  const prod = (await call(app, "POST", "/api/catalog/", { sku: "AVL-1", name: "Avail Widget", price_cents: 2000, category: "general" })).json;
  const sup = (await call(app, "POST", "/api/purchasing/suppliers", { name: "Avail Supply" })).json;

  // PO for 20 units; receive 12 → on-hand 12, incoming 8.
  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId: sup.id,
    lines: [{ productId: prod.id, quantity: 20, unitCostCents: 500 }],
  })).json;
  const recv = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 12 }],
  });
  assert.equal(recv.status, 200);

  // Approved sales order for 5, not yet shipped → reserved 5.
  const customer = (await call(app, "POST", "/api/customers/", { name: "Avail Buyer" })).json;
  const so = (await call(app, "POST", "/api/sales/sales-orders", {
    customerId: customer.id,
    lines: [{ productId: prod.id, quantity: 5 }],
  })).json;
  const approved = await call(app, "POST", `/api/sales/sales-orders/${so.id}/approve`, {});
  assert.equal(approved.status, 200);

  const avail = await call(app, "GET", `/api/inventory/${prod.id}/availability`);
  assert.equal(avail.status, 200);
  assert.deepEqual(avail.json, { on_hand: 12, reserved: 5, incoming: 8, available: 7 });
});

test("availability is zeros for a product with no activity", async () => {
  const app = await freshApp();
  const prod = (await call(app, "POST", "/api/catalog/", { sku: "AVL-2", name: "Untouched", price_cents: 100 })).json;
  const avail = await call(app, "GET", `/api/inventory/${prod.id}/availability`);
  assert.deepEqual(avail.json, { on_hand: 0, reserved: 0, incoming: 0, available: 0 });
});

// ─── Durable receiving (ACPA M1.3) ────────────────────────────────────────────

test("a redelivered purchase_order.received never double-counts stock", async () => {
  const app = await freshApp();
  const evt = await app.events.publish(
    "purchase_order.received",
    { tenantId: "tnt_demo", poId: "po_m13", lines: [{ productId: "prod_m13", quantity: 7 }] },
    "po_m13",
  );
  let got = await call(app, "GET", "/api/inventory/prod_m13");
  assert.equal(got.json.stockQty, 7);

  // Crash window: dispatch completed but the row was never marked delivered.
  await app.db.query(
    "UPDATE event_outbox SET status = 'pending', created_at = @past WHERE id = @id",
    { past: Date.now() - 60_000, id: evt.id },
  );
  const r = await app.outbox.reconcile();
  assert.equal(r.delivered, 1); // redelivered to durable consumers…
  got = await call(app, "GET", "/api/inventory/prod_m13");
  assert.equal(got.json.stockQty, 7); // …but the consumption claim blocks a second apply
});

test("crash before dispatch: a pending receive is applied exactly once by the reconciler", async () => {
  const app = await freshApp();
  await app.db.query(
    `INSERT INTO event_outbox (id, tenant_id, type, payload, aggregate_id, occurred_at, dispatched, status, attempts, created_at)
     VALUES ('evt_m13_lost', 'tnt_demo', 'purchase_order.received', @payload, 'po_lost', @occ, TRUE, 'pending', 0, @past)`,
    {
      payload: JSON.stringify({ tenantId: "tnt_demo", poId: "po_lost", lines: [{ productId: "prod_lost", quantity: 3 }] }),
      occ: new Date().toISOString(),
      past: Date.now() - 60_000,
    },
  );
  await app.outbox.reconcile();
  let got = await call(app, "GET", "/api/inventory/prod_lost");
  assert.equal(got.json.stockQty, 3);

  // A second redelivery of the same row must be a no-op.
  await app.db.query("UPDATE event_outbox SET status = 'pending', created_at = @past WHERE id = 'evt_m13_lost'", { past: Date.now() - 60_000 });
  await app.outbox.reconcile();
  got = await call(app, "GET", "/api/inventory/prod_lost");
  assert.equal(got.json.stockQty, 3);
});
