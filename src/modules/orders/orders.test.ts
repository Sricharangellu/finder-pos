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
  role?: string,
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

/** Create a product through the catalog API; return its id. */
async function makeProduct(
  app: App,
  opts: { sku: string; name: string; price_cents: number; category?: string; tax_class?: string },
): Promise<string> {
  const { status, json } = await call(app, "POST", "/api/catalog/", opts);
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id;
}

test("standard taxable order computes correct tax per state", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "W-30",
    name: "Widget",
    price_cents: 1500,
    category: "general",
  });

  // 2 x $15.00 = $30.00 taxable.
  const cases: Array<[string, number, number]> = [
    ["CA", 248, 3248],
    ["NY", 266, 3266],
    ["TX", 188, 3188],
    ["FL", 180, 3180],
  ];
  for (const [stateCode, tax, total] of cases) {
    const { status, json } = await call(app, "POST", "/api/orders/", {
      stateCode,
      lines: [{ productId: widget, quantity: 2 }],
    });
    assert.equal(status, 201);
    assert.equal(json.subtotal_cents, 3000);
    assert.equal(json.tax_cents, tax, `tax for ${stateCode}`);
    assert.equal(json.total_cents, total, `total for ${stateCode}`);
    assert.ok(json.id.startsWith("ord_"));
    assert.ok(json.order_number.startsWith("FP-"));
    assert.equal(json.status, "open"); // completes once a payment is captured
  }
});

test("grocery (exempt) item is NOT taxed", async () => {
  const app = await freshApp();
  const bananas = await makeProduct(app, {
    sku: "GRO-BAN",
    name: "Bananas",
    price_cents: 1000,
    category: "groceries",
  });
  const { json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: bananas, quantity: 3 }],
  });
  assert.equal(json.subtotal_cents, 3000);
  assert.equal(json.tax_cents, 0);
  assert.equal(json.total_cents, 3000);
  assert.equal(json.lines[0].taxable, 0);
  assert.equal(json.lines[0].tax_cents, 0);
});

test("mixed taxable + exempt order taxes only the taxable line", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "MIX-W",
    name: "Widget",
    price_cents: 3000,
    category: "general",
  });
  const milk = await makeProduct(app, {
    sku: "MIX-MILK",
    name: "Milk",
    price_cents: 1000,
    category: "groceries",
  });
  const { json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [
      { productId: widget, quantity: 1 },
      { productId: milk, quantity: 1 },
    ],
  });
  assert.equal(json.subtotal_cents, 4000);
  assert.equal(json.tax_cents, 248); // only the $30 widget
  assert.equal(json.total_cents, 4248);
  const widgetLine = json.lines.find((l: any) => l.product_id === widget);
  const milkLine = json.lines.find((l: any) => l.product_id === milk);
  assert.equal(widgetLine.taxable, 1);
  assert.equal(widgetLine.tax_cents, 248);
  assert.equal(milkLine.taxable, 0);
  assert.equal(milkLine.tax_cents, 0);
});

test("discount reduces the taxable base", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "DISC-W",
    name: "Widget",
    price_cents: 3000,
    category: "general",
  });
  const { json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
    discountCents: 500,
  });
  assert.equal(json.subtotal_cents, 3000);
  assert.equal(json.discount_cents, 500);
  assert.equal(json.tax_cents, 206); // tax on $25.00
  assert.equal(json.total_cents, 2706);
  assert.equal(json.lines[0].line_cents, 2500);
});

test("missing product yields 400 bad_request", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: "prod_nope", quantity: 1 }],
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
});

test("archived (soft-deleted) product cannot be rung up -> 400 bad_request", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "ARCH-W",
    name: "Widget",
    price_cents: 1500,
    category: "general",
  });

  // Soft-delete the product via the catalog DELETE endpoint (archive).
  const archived = await call(app, "DELETE", `/api/catalog/${widget}`);
  assert.equal(archived.status, 200);
  assert.equal(archived.json.status, "archived");

  const { status, json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
  assert.match(json.error.message, /archived/);

  // No order should have been created from the rejected request.
  const list = await call(app, "GET", "/api/orders/");
  assert.equal(list.json.items.length, 0);
});

test("draft (unpublished) product cannot be rung up -> 400 bad_request", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "DRAFT-W",
    name: "Widget",
    price_cents: 1500,
    category: "general",
  });

  // Move the product to 'draft' (not yet released for sale) via catalog PATCH.
  const drafted = await call(app, "PATCH", `/api/catalog/${widget}`, { status: "draft" });
  assert.equal(drafted.status, 200);
  assert.equal(drafted.json.status, "draft");

  const { status, json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
  assert.match(json.error.message, /draft/);

  // No order should have been created from the rejected request.
  const list = await call(app, "GET", "/api/orders/");
  assert.equal(list.json.items.length, 0);
});

test("a master/variant-parent product cannot be rung up -> 400 bad_request", async () => {
  const app = await freshApp();
  const master = await makeProduct(app, { sku: "MASTER-W", name: "Widget (master)", price_cents: 0, category: "general" });
  const child = await makeProduct(app, { sku: "CHILD-W-RED", name: "Widget - Red", price_cents: 1500, category: "general" });

  const assign = await call(app, "POST", `/api/catalog/${master}/variants/assign`, { productIds: [child] });
  assert.equal(assign.status, 200);

  const { status, json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: master, quantity: 1 }],
  });
  assert.equal(status, 400);
  assert.equal(json.error.code, "bad_request");
  assert.match(json.error.message, /variant master/);

  // The child variant remains sellable.
  const childSale = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: child, quantity: 1 }],
  });
  assert.equal(childSale.status, 201);
});

test("GET /:id returns the order with its lines; 404 when missing", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "GET-W",
    name: "Widget",
    price_cents: 1200,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "TX",
    lines: [{ productId: widget, quantity: 2 }],
  });
  const { status, json } = await call(app, "GET", `/api/orders/${created.json.id}`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.lines));
  assert.equal(json.lines.length, 1);
  assert.equal(json.lines[0].product_id, widget);
  assert.equal(json.lines[0].quantity, 2);
  assert.equal(json.lines[0].unit_cents, 1200);

  const missing = await call(app, "GET", "/api/orders/ord_missing");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "not_found");
});

test("GET / lists orders with CursorPage shape", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "LIST-W",
    name: "Widget",
    price_cents: 1000,
    category: "general",
  });
  await call(app, "POST", "/api/orders/", { stateCode: "CA", lines: [{ productId: widget, quantity: 1 }] });
  await call(app, "POST", "/api/orders/", { stateCode: "NY", lines: [{ productId: widget, quantity: 1 }] });

  const { status, json } = await call(app, "GET", "/api/orders/");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.equal(typeof json.limit, "number");
  assert.ok(json.items.length >= 2);
});

test("GET /?status= filters by status and rejects unknown values with 400", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "FILT-W",
    name: "Widget",
    price_cents: 1000,
    category: "general",
  });

  const open = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  const toRefund = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  await call(app, "POST", `/api/orders/${toRefund.json.id}/refund`);

  // Valid filter returns only the matching orders.
  const refunded = await call(app, "GET", "/api/orders/?status=refunded");
  assert.equal(refunded.status, 200);
  assert.equal(refunded.json.items.length, 1);
  assert.equal(refunded.json.items[0].id, toRefund.json.id);

  const openList = await call(app, "GET", "/api/orders/?status=open");
  assert.equal(openList.json.items.length, 1);
  assert.equal(openList.json.items[0].id, open.json.id);

  // Unknown status is a bad request, not a silently-empty page.
  const bad = await call(app, "GET", "/api/orders/?status=garbage");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "bad_request");
});

test("refund sets status and emits order.refunded", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "REF-W",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });

  const events: DomainEvent[] = [];
  app.events.on("order.refunded", (e) => { events.push(e); });

  const { status, json } = await call(app, "POST", `/api/orders/${created.json.id}/refund`);
  assert.equal(status, 200);
  assert.equal(json.status, "refunded");

  assert.equal(events.length, 1);
  const p = events[0].payload as any;
  assert.equal(p.id, created.json.id);
  assert.equal(p.orderNumber, created.json.order_number);
  assert.equal(p.totalCents, created.json.total_cents);
});

test("void sets status to voided", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "VOID-W",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  const { status, json } = await call(app, "POST", `/api/orders/${created.json.id}/void`);
  assert.equal(status, 200);
  assert.equal(json.status, "voided");
});

test("manager can refund an order", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "REF-MGR",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });

  const { status, json } = await call(app, "POST", `/api/orders/${created.json.id}/refund`, undefined, "manager");
  assert.equal(status, 200);
  assert.equal(json.status, "refunded");
});

test("cashier cannot refund an order (403)", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "REF-CASH",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });

  const { status } = await call(app, "POST", `/api/orders/${created.json.id}/refund`, undefined, "cashier");
  assert.equal(status, 403);
});

test("manager can void an order", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "VOID-MGR",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });

  const { status, json } = await call(app, "POST", `/api/orders/${created.json.id}/void`, undefined, "manager");
  assert.equal(status, 200);
  assert.equal(json.status, "voided");
});

test("cashier cannot void an order (403)", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "VOID-CASH",
    name: "Widget",
    price_cents: 2000,
    category: "general",
  });
  const created = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });

  const { status } = await call(app, "POST", `/api/orders/${created.json.id}/void`, undefined, "cashier");
  assert.equal(status, 403);
});

test("order.created fires with the correct payload shape", async () => {
  const app = await freshApp();
  const widget = await makeProduct(app, {
    sku: "EVT-W",
    name: "Widget",
    price_cents: 1500,
    category: "general",
  });

  const events: DomainEvent[] = [];
  app.events.on("order.created", (e) => { events.push(e); });

  const { json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 2 }],
  });

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.type, "order.created");
  assert.equal(e.aggregateId, json.id);
  const p = e.payload as any;
  assert.equal(p.id, json.id);
  assert.equal(p.orderNumber, json.order_number);
  assert.equal(p.stateCode, "CA");
  assert.equal(p.totalCents, json.total_cents);
  assert.ok(Array.isArray(p.lines));
  assert.equal(p.lines.length, 1);
  assert.deepEqual(p.lines[0], { productId: widget, quantity: 2, unitCents: 1500 });
  // payload must NOT leak extra line fields per CONTRACTS.md.
  assert.deepEqual(Object.keys(p.lines[0]).sort(), ["productId", "quantity", "unitCents"]);
});

// ── Lifecycle guard paths (open -> completed -> refunded/voided) ────────────
// These cover the conflict/not-found branches in OrdersService.refund/void that
// the happy-path tests above don't reach.

/** Create an open single-line order; return its created JSON. */
async function makeOpenOrder(app: App, sku: string): Promise<any> {
  const widget = await makeProduct(app, { sku, name: "Widget", price_cents: 2000, category: "general" });
  const { status, json } = await call(app, "POST", "/api/orders/", {
    stateCode: "CA",
    lines: [{ productId: widget, quantity: 1 }],
  });
  assert.equal(status, 201, `order create failed: ${JSON.stringify(json)}`);
  assert.equal(json.status, "open");
  return json;
}

test("refunding a completed (paid) order succeeds — the canonical refund path", async () => {
  const app = await freshApp();
  const order = await makeOpenOrder(app, "GUARD-COMPLETE");

  // Pay it off so the order transitions open -> completed via payment.captured.
  const pay = await call(app, "POST", "/api/payments/", {
    orderId: order.id,
    method: "cash",
    tenderedCents: order.total_cents,
  });
  assert.equal(pay.status, 201, `payment failed: ${JSON.stringify(pay.json)}`);
  const completed = await call(app, "GET", `/api/orders/${order.id}`);
  assert.equal(completed.json.status, "completed");

  // order.refunded should fire (drives inventory restock).
  const events: DomainEvent[] = [];
  app.events.on("order.refunded", (e) => { events.push(e); });

  const refunded = await call(app, "POST", `/api/orders/${order.id}/refund`);
  assert.equal(refunded.status, 200);
  assert.equal(refunded.json.status, "refunded");
  assert.equal(events.length, 1);
  assert.equal((events[0].payload as any).id, order.id);
});

test("double refund is rejected with 409 conflict", async () => {
  const app = await freshApp();
  const order = await makeOpenOrder(app, "GUARD-DOUBLE-REF");

  const first = await call(app, "POST", `/api/orders/${order.id}/refund`);
  assert.equal(first.status, 200);

  const second = await call(app, "POST", `/api/orders/${order.id}/refund`);
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "conflict");
});

test("refunding a voided order is rejected with 409 conflict", async () => {
  const app = await freshApp();
  const order = await makeOpenOrder(app, "GUARD-VOID-THEN-REF");

  const voided = await call(app, "POST", `/api/orders/${order.id}/void`);
  assert.equal(voided.status, 200);
  assert.equal(voided.json.status, "voided");

  const refund = await call(app, "POST", `/api/orders/${order.id}/refund`);
  assert.equal(refund.status, 409);
  assert.equal(refund.json.error.code, "conflict");
});

test("voiding a refunded order is rejected with 409 conflict", async () => {
  const app = await freshApp();
  const order = await makeOpenOrder(app, "GUARD-REF-THEN-VOID");

  const refunded = await call(app, "POST", `/api/orders/${order.id}/refund`);
  assert.equal(refunded.status, 200);
  assert.equal(refunded.json.status, "refunded");

  const voided = await call(app, "POST", `/api/orders/${order.id}/void`);
  assert.equal(voided.status, 409);
  assert.equal(voided.json.error.code, "conflict");
});

test("voiding an already-voided order is rejected with 409 conflict", async () => {
  const app = await freshApp();
  const order = await makeOpenOrder(app, "GUARD-DOUBLE-VOID");

  const first = await call(app, "POST", `/api/orders/${order.id}/void`);
  assert.equal(first.status, 200);

  const second = await call(app, "POST", `/api/orders/${order.id}/void`);
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "conflict");
});

test("refund and void of a nonexistent order return 404", async () => {
  const app = await freshApp();

  const refund = await call(app, "POST", "/api/orders/ord_missing/refund");
  assert.equal(refund.status, 404);
  assert.equal(refund.json.error.code, "not_found");

  const voidRes = await call(app, "POST", "/api/orders/ord_missing/void");
  assert.equal(voidRes.status, 404);
  assert.equal(voidRes.json.error.code, "not_found");
});
