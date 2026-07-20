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

/**
 * Auth as an arbitrary tenant/role — needed for role-gating and tenant
 * isolation proofs the default owner/tnt_demo helper above can't express.
 * Mirrors gateway/tenant-isolation.test.ts's local request builder.
 */
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

function sampleLines() {
  return [
    { productId: "prod_1", sku: "SKU-1", name: "Widget", quantity: 2, unitCents: 1000, discountCents: 100, taxCents: 50 },
    { productId: "prod_2", name: "Gadget", quantity: 1, unitCents: 2500 },
  ];
}

// ─── Happy path lifecycle ──────────────────────────────────────────────────

test("quotes: create computes totals, get returns lines, list paginates", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/quotes/", { customerId: "cus_1", lines: sampleLines() });
  assert.equal(created.status, 201);
  const q = created.json;
  assert.ok(q.id.startsWith("qt_"));
  assert.equal(q.status, "draft");
  assert.equal(q.tenant_id, "tnt_demo");
  // subtotal = 2*1000 + 1*2500 = 4500; discount = 100; tax = 50; total = 4450
  assert.equal(Number(q.subtotal_cents), 4500);
  assert.equal(Number(q.discount_cents), 100);
  assert.equal(Number(q.tax_cents), 50);
  assert.equal(Number(q.total_cents), 4450);
  assert.equal(q.lines.length, 2);
  assert.equal(q.lines[0].line_cents, 1000 * 2 - 100 + 50);

  const got = await call(app, "GET", `/api/quotes/${q.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.lines.length, 2);

  const list = await call(app, "GET", "/api/quotes/");
  assert.equal(list.status, 200);
  assert.equal(list.json.total, 1);
  assert.equal(list.json.items.length, 1);
});

test("quotes: status transitions draft -> sent -> accepted -> converted", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;

  let r = await call(app, "PATCH", `/api/quotes/${q.id}/status`, { status: "sent" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "sent");

  r = await call(app, "PATCH", `/api/quotes/${q.id}/status`, { status: "accepted" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "accepted");

  const converted = await call(app, "POST", `/api/quotes/${q.id}/convert`, {});
  assert.equal(converted.status, 200);
  assert.equal(converted.json.quoteId, q.id);
  assert.match(converted.json.message, /manually/);

  const after = await call(app, "GET", `/api/quotes/${q.id}`);
  assert.equal(after.json.status, "converted");
});

test("quotes: delete removes a draft quote", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;
  const del = await call(app, "DELETE", `/api/quotes/${q.id}`);
  assert.equal(del.status, 204);
  const got = await call(app, "GET", `/api/quotes/${q.id}`);
  assert.equal(got.status, 404);
});

// ─── Validation errors (400) ───────────────────────────────────────────────

test("quotes: create rejects empty lines and malformed line entries", async () => {
  const app = await freshApp();
  let r = await call(app, "POST", "/api/quotes/", { lines: [] });
  assert.equal(r.status, 400);

  r = await call(app, "POST", "/api/quotes/", { lines: [{ productId: "p1", name: "X", quantity: 0, unitCents: 100 }] });
  assert.equal(r.status, 400, "quantity must be positive");

  r = await call(app, "POST", "/api/quotes/", { lines: [{ productId: "p1", name: "X", quantity: 1, unitCents: -5 }] });
  assert.equal(r.status, 400, "unitCents must be nonnegative");
});

test("quotes: status update rejects an unrecognized status value", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;
  const r = await call(app, "PATCH", `/api/quotes/${q.id}/status`, { status: "bogus" });
  assert.equal(r.status, 400);
});

// ─── Not-found (404) ────────────────────────────────────────────────────────

test("quotes: 404 for get/status/convert/delete on an unknown id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "GET", "/api/quotes/qt_missing")).status, 404);
  assert.equal((await call(app, "PATCH", "/api/quotes/qt_missing/status", { status: "sent" })).status, 404);
  assert.equal((await call(app, "POST", "/api/quotes/qt_missing/convert", {})).status, 404);
  assert.equal((await call(app, "DELETE", "/api/quotes/qt_missing")).status, 404);
});

// ─── Invalid state transitions ─────────────────────────────────────────────

test("quotes: cannot convert an expired quote", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;
  await call(app, "PATCH", `/api/quotes/${q.id}/status`, { status: "expired" });
  const r = await call(app, "POST", `/api/quotes/${q.id}/convert`, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "quote_expired");
});

test("quotes: cannot convert an already-converted quote (regression: dead already_converted guard)", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;
  const first = await call(app, "POST", `/api/quotes/${q.id}/convert`, {});
  assert.equal(first.status, 200);

  // Before the fix, this guard read `converted_order_id`, a column nothing in
  // the service ever populates — so a second /convert call silently
  // "succeeded" again instead of being rejected. It must now 409.
  const second = await call(app, "POST", `/api/quotes/${q.id}/convert`, {});
  assert.equal(second.status, 409, "a second convert must be rejected, not silently re-accepted");
  assert.equal(second.json.error.code, "already_converted");
});

test("quotes: cannot delete a converted quote", async () => {
  const app = await freshApp();
  const q = (await call(app, "POST", "/api/quotes/", { lines: sampleLines() })).json;
  await call(app, "POST", `/api/quotes/${q.id}/convert`, {});
  const del = await call(app, "DELETE", `/api/quotes/${q.id}`);
  assert.equal(del.status, 400);
  assert.equal(del.json.error.code, "cannot_delete");
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("quotes: no requireRole guard on any route — cashier can create, convert, and delete", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/quotes/", "tnt_demo", "cashier", { lines: sampleLines() });
  assert.equal(created.status, 201, "cashier can create a quote (routes.ts has no requireRole calls)");
  const id = created.json.id;

  const converted = await callAs(app, "POST", `/api/v1/quotes/${id}/convert`, "tnt_demo", "cashier", {});
  assert.equal(converted.status, 200, "cashier can convert a quote");

  const del = await callAs(app, "DELETE", `/api/v1/quotes/${id}`, "tnt_demo", "cashier", undefined);
  // a converted quote can't be deleted (state rule), not a role rule
  assert.equal(del.status, 400);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("quotes: tenant isolation — a quote created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/quotes/", "tnt_demo", "owner", { lines: sampleLines() });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const crossGet = await callAs(app, "GET", `/api/v1/quotes/${id}`, "tnt_other", "owner");
  assert.equal(crossGet.status, 404, "cross-tenant GET by id must 404");

  const crossList = await callAs(app, "GET", "/api/v1/quotes/", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.deepEqual(crossList.json.items, [], "cross-tenant list must not leak rows");

  const crossConvert = await callAs(app, "POST", `/api/v1/quotes/${id}/convert`, "tnt_other", "owner", {});
  assert.equal(crossConvert.status, 404, "cross-tenant convert must 404, not act on another tenant's quote");

  const crossDelete = await callAs(app, "DELETE", `/api/v1/quotes/${id}`, "tnt_other", "owner");
  assert.equal(crossDelete.status, 404, "cross-tenant delete must 404");

  // Original tenant still sees it, untouched.
  const ownGet = await callAs(app, "GET", `/api/v1/quotes/${id}`, "tnt_demo", "owner");
  assert.equal(ownGet.status, 200);
  assert.equal(ownGet.json.status, "draft");
});

// ─── Schema-collision regression (see index.ts / service.ts fix) ──────────

test("quotes: create/read round-trips every quotes-owned column (regression: table-name collision with sales' `quotations`)", async () => {
  const app = await freshApp();
  const validUntil = Date.now() + 86_400_000;
  const created = await call(app, "POST", "/api/quotes/", {
    customerId: "cus_42",
    outletId: "out_1",
    currency: "USD",
    notes: "handle with care",
    validUntil,
    lines: [{ productId: "p1", name: "Only Item", quantity: 1, unitCents: 999 }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.outlet_id, "out_1");
  assert.equal(created.json.customer_id, "cus_42");
  assert.equal(created.json.currency, "USD");
  assert.equal(created.json.notes, "handle with care");
  assert.equal(Number(created.json.valid_until), validUntil);
  assert.equal(created.json.created_by, "usr_demo_owner");
});
