import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

test("issue a gift card with a unique code and full balance", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/giftcards/", { amountCents: 5000 });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("gft_"));
  assert.match(r.json.code, /^GC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(r.json.balance_cents, 5000);
  assert.equal(r.json.initial_cents, 5000);
  assert.equal(r.json.status, "active");
  assert.equal(r.json.tenant_id, "tnt_demo");

  const got = await call(app, "GET", `/api/giftcards/${r.json.code}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.balance_cents, 5000);
});

test("issue rejects non-positive amounts", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "POST", "/api/giftcards/", { amountCents: 0 })).status, 400);
  assert.equal((await call(app, "POST", "/api/giftcards/", { amountCents: -100 })).status, 400);
});

test("partial then full redeem draws down balance and flips to redeemed", async () => {
  const app = await freshApp();
  const code = (await call(app, "POST", "/api/giftcards/", { amountCents: 3000 })).json.code;

  let r = await call(app, "POST", `/api/giftcards/${code}/redeem`, { amountCents: 1200 });
  assert.equal(r.status, 200);
  assert.equal(r.json.balanceCents, 1800);
  assert.equal(r.json.status, "active");

  // Over-redeem is rejected (never negative).
  r = await call(app, "POST", `/api/giftcards/${code}/redeem`, { amountCents: 5000 });
  assert.equal(r.status, 400);

  // Redeem the remainder -> status redeemed.
  r = await call(app, "POST", `/api/giftcards/${code}/redeem`, { amountCents: 1800 });
  assert.equal(r.status, 200);
  assert.equal(r.json.balanceCents, 0);
  assert.equal(r.json.status, "redeemed");
});

test("redeem on a missing code is 404", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/giftcards/GC-XXXX-XXXX-XXXX/redeem", { amountCents: 100 });
  assert.equal(r.status, 404);
});
