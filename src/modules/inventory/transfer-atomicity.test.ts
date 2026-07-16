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
import { InventoryService } from "./service.js";

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
