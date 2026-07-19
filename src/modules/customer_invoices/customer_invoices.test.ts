/**
 * customer_invoices.test.ts — integration coverage for customer_invoices
 * (multi-line invoices with tax/discount calc and a status lifecycle).
 *
 * route-mount.test.ts (sibling file) already proves the hyphenated mount
 * path resolves; this file covers the actual business logic: create with
 * computed line/invoice totals, get/list, the UPC lookup helper, the status
 * lifecycle (including the void-is-terminal guard), validation (400s),
 * 404s, role gating, and tenant isolation, all against real embedded
 * Postgres. The `customer_invoices` / `customer_invoice_lines` table names
 * and the `customer_invoice_seq` sequence were checked against every other
 * module's migrations before writing this — no collision found (see the
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

function sampleLines() {
  return [
    { name: "Widget", quantity: 2, unit_price_cents: 1000, discount_cents: 100, tax_rate_pct: 10 },
    { name: "Gadget", quantity: 1, unit_price_cents: 2500 },
  ];
}

// ─── Create + totals calc ───────────────────────────────────────────────────

test("customer_invoices: create computes per-line and invoice totals correctly", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/customer-invoices", { customer_name: "Jane Doe", lines: sampleLines() });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const inv = created.json;
  assert.ok(inv.id);
  assert.match(inv.invoice_number, /^INV-\d{5}$/);
  assert.equal(inv.status, "draft");
  assert.equal(inv.customer_name, "Jane Doe");

  // line 1: base = 2*1000=2000, afterDiscount=1900, tax=round(1900*0.10)=190, total=2090
  // line 2: base = 1*2500=2500, afterDiscount=2500, tax=0, total=2500
  assert.equal(inv.subtotal_cents, 2000 + 2500);
  assert.equal(inv.discount_cents, 100);
  assert.equal(inv.tax_cents, 190);
  assert.equal(inv.total_cents, (2000 + 2500) - 100 + 190);
  assert.equal(inv.paid_cents, 0);
  assert.equal(inv.lines.length, 2);
  assert.equal(inv.lines[0].line_total_cents, 2090);
  assert.equal(inv.lines[1].line_total_cents, 2500);
});

test("customer_invoices: create defaults customer_name to 'Walk-in Customer' when omitted", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/customer-invoices", { lines: [{ name: "Item", quantity: 1, unit_price_cents: 500 }] });
  assert.equal(created.status, 201);
  assert.equal(created.json.customer_name, "Walk-in Customer");
});

test("customer_invoices: invoice numbers increment monotonically across creates", async () => {
  const app = await freshApp();
  const a = (await call(app, "POST", "/api/customer-invoices", { lines: [{ name: "A", quantity: 1, unit_price_cents: 100 }] })).json;
  const b = (await call(app, "POST", "/api/customer-invoices", { lines: [{ name: "B", quantity: 1, unit_price_cents: 100 }] })).json;
  const aNum = parseInt(a.invoice_number.split("-")[1], 10);
  const bNum = parseInt(b.invoice_number.split("-")[1], 10);
  assert.ok(bNum > aNum, "sequence must advance");
});

// ─── Get / list ─────────────────────────────────────────────────────────────

test("customer_invoices: get returns lines; list paginates and filters by status/customer_id", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/customer-invoices", { customer_id: "cus_1", lines: sampleLines() })).json;

  const got = await call(app, "GET", `/api/customer-invoices/${created.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.lines.length, 2);

  const list = await call(app, "GET", "/api/customer-invoices");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((i: any) => i.id === created.id));
  assert.equal(list.json.total >= 1, true);

  const byCustomer = await call(app, "GET", "/api/customer-invoices?customer_id=cus_1");
  assert.ok(byCustomer.json.items.every((i: any) => i.customer_id === "cus_1"));
  assert.ok(byCustomer.json.items.some((i: any) => i.id === created.id));

  const byStatus = await call(app, "GET", "/api/customer-invoices?status=draft");
  assert.ok(byStatus.json.items.some((i: any) => i.id === created.id));
  const byWrongStatus = await call(app, "GET", "/api/customer-invoices?status=paid");
  assert.ok(!byWrongStatus.json.items.some((i: any) => i.id === created.id));
});

// ─── UPC lookup ─────────────────────────────────────────────────────────────

test("customer_invoices: lookup-upc finds a product by sku and 404s for unknown", async () => {
  const app = await freshApp();
  const product = await call(app, "POST", "/api/catalog", { sku: "INV-UPC-1", name: "Lookup Widget", price_cents: 750, category: "general" });
  assert.equal(product.status, 201, JSON.stringify(product.json));

  const found = await call(app, "GET", "/api/customer-invoices/lookup-upc?upc=INV-UPC-1");
  assert.equal(found.status, 200, JSON.stringify(found.json));
  assert.equal(found.json.sku, "INV-UPC-1");
  assert.equal(found.json.price_cents, 750);

  const missing = await call(app, "GET", "/api/customer-invoices/lookup-upc?upc=NOPE-999");
  assert.equal(missing.status, 404);

  const noParam = await call(app, "GET", "/api/customer-invoices/lookup-upc");
  assert.equal(noParam.status, 400);
});

test("customer_invoices: /lookup-upc is not shadowed by the /:id route", async () => {
  const app = await freshApp();
  // If /:id were registered first, "lookup-upc" would be treated as an id and
  // 404 from svc.get() instead of hitting the lookup handler's own 400/200 path.
  const r = await call(app, "GET", "/api/customer-invoices/lookup-upc");
  assert.notEqual(r.status, 404, "lookup-upc must not be swallowed by the generic :id route");
  assert.equal(r.status, 400, "no upc param -> the lookup handler's own 400, not a generic not_found");
});

// ─── Status lifecycle ───────────────────────────────────────────────────────

test("customer_invoices: status transitions sent -> partial -> paid set paid_at", async () => {
  const app = await freshApp();
  const inv = (await call(app, "POST", "/api/customer-invoices", { lines: sampleLines() })).json;

  let r = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "sent" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "sent");
  assert.equal(r.json.paid_at, null);

  r = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "partial", paid_cents: 1000 });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "partial");
  assert.equal(r.json.paid_cents, 1000);

  r = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "paid", paid_cents: inv.total_cents });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "paid");
  assert.equal(r.json.paid_cents, inv.total_cents);
  assert.ok(r.json.paid_at !== null, "paid_at set when status becomes paid");
});

test("customer_invoices: a voided invoice cannot be updated further (409)", async () => {
  const app = await freshApp();
  const inv = (await call(app, "POST", "/api/customer-invoices", { lines: sampleLines() })).json;
  const voided = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "void" });
  assert.equal(voided.status, 200);
  assert.equal(voided.json.status, "void");

  const after = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "sent" });
  assert.equal(after.status, 409, "void is terminal — no further status changes allowed");
});

// ─── Validation (400s) ──────────────────────────────────────────────────────

test("customer_invoices: create rejects empty lines array and malformed line entries", async () => {
  const app = await freshApp();
  const r1 = await call(app, "POST", "/api/customer-invoices", { lines: [] });
  assert.equal(r1.status, 400);

  const r2 = await call(app, "POST", "/api/customer-invoices", { lines: [{ name: "X", quantity: 0, unit_price_cents: 100 }] });
  assert.equal(r2.status, 400, "quantity must be positive");

  const r3 = await call(app, "POST", "/api/customer-invoices", { lines: [{ name: "X", quantity: 1, unit_price_cents: -5 }] });
  assert.equal(r3.status, 400, "unit_price_cents must be nonnegative");

  const r4 = await call(app, "POST", "/api/customer-invoices", { customer_email: "not-an-email", lines: sampleLines() });
  assert.equal(r4.status, 400, "malformed email rejected");
});

test("customer_invoices: status patch rejects an unrecognized status value", async () => {
  const app = await freshApp();
  const inv = (await call(app, "POST", "/api/customer-invoices", { lines: sampleLines() })).json;
  const r = await call(app, "PATCH", `/api/customer-invoices/${inv.id}/status`, { status: "bogus" });
  assert.equal(r.status, 400);
});

// ─── 404s ───────────────────────────────────────────────────────────────────

test("customer_invoices: 404 for get/status-update on an unknown id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "GET", "/api/customer-invoices/inv_missing")).status, 404);
  assert.equal((await call(app, "PATCH", "/api/customer-invoices/inv_missing/status", { status: "sent" })).status, 404);
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("customer_invoices: cashier is rejected (403) from create/status-update, reads remain open", async () => {
  const app = await freshApp();
  const createByCashier = await callAs(app, "POST", "/api/v1/customer-invoices", "tnt_demo", "cashier", { lines: sampleLines() });
  assert.equal(createByCashier.status, 403);

  const inv = (await call(app, "POST", "/api/customer-invoices", { lines: sampleLines() })).json;
  const statusByCashier = await callAs(app, "PATCH", `/api/v1/customer-invoices/${inv.id}/status`, "tnt_demo", "cashier", { status: "sent" });
  assert.equal(statusByCashier.status, 403);

  const readByCashier = await callAs(app, "GET", "/api/v1/customer-invoices", "tnt_demo", "cashier");
  assert.equal(readByCashier.status, 200);
});

test("customer_invoices: manager can create and update status", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/customer-invoices", "tnt_demo", "manager", { lines: sampleLines() });
  assert.equal(created.status, 201);
  const updated = await callAs(app, "PATCH", `/api/v1/customer-invoices/${created.json.id}/status`, "tnt_demo", "manager", { status: "sent" });
  assert.equal(updated.status, 200);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("customer_invoices: tenant isolation — an invoice created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/customer-invoices", "tnt_demo", "owner", { lines: sampleLines() });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const crossGet = await callAs(app, "GET", `/api/v1/customer-invoices/${id}`, "tnt_other", "owner");
  assert.equal(crossGet.status, 404, "cross-tenant GET by id must 404");

  const crossList = await callAs(app, "GET", "/api/v1/customer-invoices", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.ok(!crossList.json.items.some((i: any) => i.id === id), "cross-tenant list must not leak rows");

  const crossStatus = await callAs(app, "PATCH", `/api/v1/customer-invoices/${id}/status`, "tnt_other", "owner", { status: "void" });
  assert.equal(crossStatus.status, 404, "cross-tenant status update must 404, not void another tenant's invoice");

  const ownGet = await callAs(app, "GET", `/api/v1/customer-invoices/${id}`, "tnt_demo", "owner");
  assert.equal(ownGet.status, 200);
  assert.equal(ownGet.json.status, "draft", "original tenant's invoice untouched by the cross-tenant attempt");
});
