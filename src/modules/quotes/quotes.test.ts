import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import type { DomainEvent } from "../../shared/types.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

const twoLines = [
  { productId: "prd_1", name: "Widget", quantity: 2, unitCents: 1000 },
  { productId: "prd_2", name: "Gadget", quantity: 1, unitCents: 500, discountCents: 50, taxCents: 25 },
];

test("create computes totals and persists all lines atomically", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/quotes/", { lines: twoLines });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("qt_"));
  assert.equal(r.json.status, "draft");
  assert.equal(r.json.lines.length, 2);
  // subtotal = 2*1000 + 500 = 2500; discount = 50; tax = 25; total = 2475
  assert.equal(Number(r.json.subtotal_cents), 2500);
  assert.equal(Number(r.json.discount_cents), 50);
  assert.equal(Number(r.json.tax_cents), 25);
  assert.equal(Number(r.json.total_cents), 2475);

  const got = await call(app, "GET", `/api/quotes/${r.json.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.lines.length, 2);
});

test("create rejects an empty line list before touching the database", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/quotes/", { lines: [] });
  assert.equal(r.status, 400);
  const list = await call(app, "GET", "/api/quotes/");
  assert.equal(list.json.total, 0);
});

test("list returns created quotes with a total count", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/quotes/", { lines: twoLines });
  await call(app, "POST", "/api/quotes/", { lines: twoLines });
  const r = await call(app, "GET", "/api/quotes/");
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 2);
  assert.equal(r.json.items.length, 2);
});

test("updateStatus transitions status", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/quotes/", { lines: twoLines });
  const r = await call(app, "PATCH", `/api/quotes/${created.json.id}/status`, { status: "sent" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "sent");
});

test("convertToOrder marks the quote converted and raises quote.converted exactly once", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/quotes/", { lines: twoLines });

  const received: DomainEvent[] = [];
  app.events.on("quote.converted", (e) => { received.push(e); });

  const r = await call(app, "POST", `/api/quotes/${created.json.id}/convert`);
  assert.equal(r.status, 200);
  assert.equal(r.json.quoteId, created.json.id);

  assert.equal(received.length, 1);
  assert.equal(received[0]?.aggregateId, created.json.id);
  assert.deepEqual(received[0]?.payload, { quoteId: created.json.id, tenantId: "tnt_demo" });

  const again = await call(app, "POST", `/api/quotes/${created.json.id}/convert`);
  assert.equal(again.status, 409);
  assert.equal(received.length, 1, "converting an already-converted quote must not re-raise the event");
});

test("convertToOrder rejects an expired quote", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/quotes/", { lines: twoLines });
  await call(app, "PATCH", `/api/quotes/${created.json.id}/status`, { status: "expired" });
  const r = await call(app, "POST", `/api/quotes/${created.json.id}/convert`);
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "quote_expired");
});

test("delete removes a draft quote but refuses a converted one", async () => {
  const app = await freshApp();
  const draft = await call(app, "POST", "/api/quotes/", { lines: twoLines });
  assert.equal((await call(app, "DELETE", `/api/quotes/${draft.json.id}`)).status, 204);
  assert.equal((await call(app, "GET", `/api/quotes/${draft.json.id}`)).status, 404);

  const converted = await call(app, "POST", "/api/quotes/", { lines: twoLines });
  await call(app, "POST", `/api/quotes/${converted.json.id}/convert`);
  const r = await call(app, "DELETE", `/api/quotes/${converted.json.id}`);
  assert.equal(r.status, 400);
});
