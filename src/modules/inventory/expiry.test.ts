/**
 * expiry.test.ts — expiry sweep moves expired stock out of active inventory,
 * records it on the expiry sheet, and books the total loss (session D feature).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";
import { InventoryService } from "./service.js";
import { AccountingService } from "../accounting/service.js";

let __seq = 0;
const __schema = () => `expiry_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const DAY = 86_400_000;

test("sweepExpired pulls expired stock into the pool, reduces active stock, books the loss", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const inv = new InventoryService(app.db, app.events);
  const acct = new AccountingService(app.db);
  const tenant = "tnt_demo";
  const product = "prod_exp";

  await app.db.exec(
    `INSERT INTO products (id, tenant_id, sku, name, price_cents, category, tax_class, status, created_at, updated_at)
     VALUES ('${product}', '${tenant}', 'EXP-1', 'Expiring Widget', 500, 'general', 'standard', 'active', ${Date.now()}, ${Date.now()})`,
  );

  // Seed 10 units of active stock, in a lot that expired yesterday, cost $2.00.
  await inv.adjust(product, 10, "receiving", tenant);
  await inv.createLot({ productId: product, expiryDate: Date.now() - DAY, quantity: 10, unitCostCents: 200 }, tenant);
  assert.equal((await inv.getStock(product, tenant)).stock_qty, 10);

  const result = await inv.sweepExpired(tenant);
  assert.equal(result.swept, 1, "one expired lot swept");
  assert.equal(result.loss_cents, 2000, "loss = 10 × $2.00");

  // Active stock is gone; the lot is emptied.
  assert.equal((await inv.getStock(product, tenant)).stock_qty, 0, "expired stock left active inventory");
  assert.equal((await inv.lots(product, tenant)).length, 0, "no on-hand lots remain");

  // The expiry pool holds the write-off, pending disposition.
  const pool = await inv.listExpiryPool(tenant);
  assert.equal(pool.length, 1);
  assert.equal(pool[0]!.qty, 10);
  assert.equal(pool[0]!.loss_cents, 2000);
  assert.equal(pool[0]!.status, "pending");

  // Accounting booked the loss (Dr 5300 Spoilage / Cr 1200 Inventory) via event.
  await new Promise((r) => setTimeout(r, 80));
  const journal = await acct.listJournal(tenant, { docType: "expiry_writeoff" });
  const dr = journal.items.find((e) => e.account_code === "5300");
  const cr = journal.items.find((e) => e.account_code === "1200");
  assert.ok(dr && Number(dr.debit_cents) === 2000, "Dr Spoilage 2000");
  assert.ok(cr && Number(cr.credit_cents) === 2000, "Cr Inventory 2000");

  // Re-running sweeps nothing new (already emptied).
  const again = await inv.sweepExpired(tenant);
  assert.equal(again.swept, 0, "second sweep finds nothing");

  await app.db.close();
});

async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

async function seedExpired(app: App, product: string, qty = 5, cost = 300) {
  const inv = new InventoryService(app.db, app.events);
  await app.db.exec(
    `INSERT INTO products (id, tenant_id, sku, name, price_cents, category, tax_class, status, created_at, updated_at)
     VALUES ('${product}', 'tnt_demo', '${product}-sku', 'P ${product}', 500, 'general', 'standard', 'active', ${Date.now()}, ${Date.now()})`,
  );
  await inv.adjust(product, qty, "receiving", "tnt_demo");
  await inv.createLot({ productId: product, expiryDate: Date.now() - DAY, quantity: qty, unitCostCents: cost }, "tnt_demo");
  await inv.sweepExpired("tnt_demo");
  return inv;
}

test("discard resolves an expiry item and removes it from the pool", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const inv = await seedExpired(app, "prod_disc");
  const pool = await inv.listExpiryPool("tnt_demo");
  assert.equal(pool.length, 1);

  const r = await call(app, "POST", `/api/inventory/expiry/${pool[0]!.id}/discard`);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "discarded");
  assert.equal((await inv.listExpiryPool("tnt_demo")).length, 0, "no longer pending");

  // Double-dispose is rejected.
  const again = await call(app, "POST", `/api/inventory/expiry/${pool[0]!.id}/discard`);
  assert.equal(again.status, 409);

  await app.db.close();
});

test("return-to-vendor creates a vendor return and resolves the item", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const inv = await seedExpired(app, "prod_ret");
  const sup = await call(app, "POST", "/api/purchasing/suppliers", { name: "Return Vendor", email: "r@v.com" });
  assert.equal(sup.status, 201);
  const pool = await inv.listExpiryPool("tnt_demo");

  const r = await call(app, "POST", `/api/inventory/expiry/${pool[0]!.id}/return-to-vendor`, { supplierId: sup.json.id });
  assert.equal(r.status, 200, `return failed: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.writeoff.status, "returned");
  assert.equal(r.json.writeoff.disposition_ref, r.json.vendorReturn.id, "linked to the vendor return");
  assert.equal((await inv.listExpiryPool("tnt_demo")).length, 0, "no longer pending");

  await app.db.close();
});

function callAs(app: App, role: string, method: string, path: string, body?: unknown): Promise<{ status: number }> {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: "usr_role", tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
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
        res.on("data", () => {}); res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0 }); });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload); req.end();
    });
  });
}

test("cashier cannot run the sweep (403) but can read the pool", async () => {
  const app: App = await buildApp({ schema: __schema() });
  assert.equal((await callAs(app, "cashier", "POST", "/api/inventory/expiry/sweep", {})).status, 403);
  assert.equal((await callAs(app, "manager", "POST", "/api/inventory/expiry/sweep", {})).status, 200);
  assert.equal((await callAs(app, "cashier", "GET", "/api/inventory/expiry")).status, 200);
  await app.db.close();
});
