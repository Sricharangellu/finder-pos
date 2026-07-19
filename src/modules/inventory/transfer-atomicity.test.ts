/**
 * transfer-atomicity.test.ts — location transfer is all-or-nothing (session D).
 *
 * createTransfer moved stock with two independent adjustStock calls (each its
 * own transaction) plus a separate INSERT. A failure between the source debit
 * and the destination credit committed the debit and lost the credit — stock
 * vanished. The fix runs both legs + the record in ONE transaction.
 *
 * This forces a deterministic failure on the SECOND leg: the destination is
 * seeded at INT_MAX so the credit overflows the INTEGER column and Postgres
 * throws. With the fix the source debit rolls back; without it the source is
 * left short (the assertion that catches the bug).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { openDb, type DB } from "../../shared/db.js";
import { InventoryService } from "./service.js";
import { HttpError } from "../../shared/http.js";

let __seq = 0;
const __schema = () => `xferatom_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const INT_MAX = 2147483647;

async function locQty(svc: InventoryService, tenant: string, loc: string, product: string): Promise<number> {
  const rows = await svc.getStockByLocation(tenant, loc);
  return Number(rows.find((r) => r.product_id === product)?.quantity_on_hand ?? 0);
}

test("a transfer whose destination leg fails leaves the source untouched (atomic)", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const svc = new InventoryService(app.db, app.events);
  const tenant = "tnt_demo";
  const product = "prod_xfer";
  const src = "loc_src";
  const dst = "loc_dst";

  await svc.adjustStock(tenant, src, product, 10, "receiving");
  await svc.adjustStock(tenant, dst, product, INT_MAX, "receiving"); // credit here will overflow

  assert.equal(await locQty(svc, tenant, src, product), 10);

  // Transfer 5 src → dst. The destination credit (INT_MAX + 5) overflows the
  // INTEGER column → the whole transfer must roll back.
  await assert.rejects(
    () => svc.createTransfer(tenant, { fromLocationId: src, toLocationId: dst, productId: product, quantity: 5 }),
    "transfer with an overflowing destination leg should throw",
  );

  // The source debit must have rolled back with it — otherwise 5 units vanished.
  assert.equal(await locQty(svc, tenant, src, product), 10, "source stock must be unchanged after a failed transfer");
  assert.equal(await locQty(svc, tenant, dst, product), INT_MAX, "destination stock must be unchanged");

  // No partial transfer record.
  const transfers = await svc.listTransfers(tenant);
  assert.equal(transfers.length, 0, "no transfer record should persist for a failed transfer");

  await app.db.close();
});

test("a successful transfer moves stock atomically and records it", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const svc = new InventoryService(app.db, app.events);
  const tenant = "tnt_demo";
  const product = "prod_ok";
  const src = "loc_src";
  const dst = "loc_dst";

  await svc.adjustStock(tenant, src, product, 10, "receiving");
  const xfer = await svc.createTransfer(tenant, { fromLocationId: src, toLocationId: dst, productId: product, quantity: 4 });

  assert.equal(xfer.quantity, 4);
  assert.equal(await locQty(svc, tenant, src, product), 6, "source debited");
  assert.equal(await locQty(svc, tenant, dst, product), 4, "destination credited");
  assert.equal((await svc.listTransfers(tenant)).length, 1, "transfer recorded");

  await app.db.close();
});

test("transferring more than the source holds is rejected — no phantom stock created", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const svc = new InventoryService(app.db, app.events);
  const tenant = "tnt_demo";
  const product = "prod_over";
  const src = "loc_src";
  const dst = "loc_dst";

  await svc.adjustStock(tenant, src, product, 10, "receiving"); // only 10 on hand

  // Attempt to transfer 100 — the source clamps at 0 but (without the guard) the
  // destination would be credited the full 100, conjuring 90 units of stock.
  await assert.rejects(
    () => svc.createTransfer(tenant, { fromLocationId: src, toLocationId: dst, productId: product, quantity: 100 }),
    (e: unknown) => e instanceof HttpError && e.status === 409 && e.code === "insufficient_stock",
    "over-transfer should 409 insufficient_stock",
  );

  // No stock moved or created: source still 10, destination still 0, no record.
  assert.equal(await locQty(svc, tenant, src, product), 10, "source unchanged");
  assert.equal(await locQty(svc, tenant, dst, product), 0, "destination unchanged (no phantom stock)");
  assert.equal((await svc.listTransfers(tenant)).length, 0, "no transfer recorded");

  await app.db.close();
});

test("concurrent transfers get distinct transfer numbers (race-free counter)", async () => {
  const schema = __schema();
  const app: App = await buildApp({ schema });
  const db2: DB = openDb({ schema }); // second transfer
  const db3: DB = openDb({ schema }); // barrier: holds the source row lock
  const svc1 = new InventoryService(app.db, app.events);
  const svc2 = new InventoryService(db2, app.events);
  const tenant = "tnt_demo";
  const product = "prod_num";
  const src = "loc_src";
  const dst = "loc_dst";

  await svc1.adjustStock(tenant, src, product, 100, "receiving"); // enough for both

  // db3 locks the source stock row so both transfers reach the number-generation
  // step before either commits — the exact window the COUNT(*)+1 race duplicated.
  let lockHeld!: () => void;
  const held = new Promise<void>((r) => { lockHeld = r; });
  let release!: () => void;
  const canRelease = new Promise<void>((r) => { release = r; });
  const barrier = db3.withTenant(tenant).tx(async (tdb) => {
    await tdb.one("SELECT quantity_on_hand FROM inventory_stock WHERE tenant_id = @t AND location_id = @loc AND product_id = @p FOR UPDATE", { t: tenant, loc: src, p: product });
    lockHeld();
    await canRelease;
  });
  await held;

  const t1 = svc1.createTransfer(tenant, { fromLocationId: src, toLocationId: dst, productId: product, quantity: 5 });
  const t2 = svc2.createTransfer(tenant, { fromLocationId: src, toLocationId: dst, productId: product, quantity: 5 });
  await new Promise((r) => setTimeout(r, 300));
  release();
  await barrier;
  const [a, b] = await Promise.all([t1, t2]);

  assert.notEqual(a.transfer_number, b.transfer_number, `transfer numbers must be distinct, got ${a.transfer_number} and ${b.transfer_number}`);

  await db3.close();
  await db2.close();
  await app.db.close();
});
