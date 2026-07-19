/**
 * concurrency.test.ts — stock-adjust oversell race (session D, inventory focus)
 *
 * inventory.adjust() was read-modify-write (SELECT qty, compute in JS, write the
 * absolute value). Two concurrent decrements on the same product both read the
 * same starting qty and the second write clobbered the first — a lost update
 * that oversells. The fix locks the row (SELECT ... FOR UPDATE) so a concurrent
 * adjust reads the FRESH value.
 *
 * Reproducing a lost update deterministically needs controlled interleaving, so
 * this opens a SECOND connection on the same schema, holds a FOR UPDATE lock on
 * the row while adjust() runs on the first connection, then commits a change
 * before releasing. With the fix, adjust() blocks and reads the post-commit
 * value; without it, adjust() read the stale value and overwrites — the assert
 * on the final quantity fails, which is what makes this a real regression test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { openDb, type DB } from "../../shared/db.js";
import { InventoryService } from "./service.js";

let __seq = 0;
const __schema = () => `invconc_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

test("adjust() reads the fresh qty after a concurrent committed change (no lost update)", async () => {
  const schema = __schema();
  const app: App = await buildApp({ schema });
  const db2: DB = openDb({ schema }); // independent connection on the same schema

  const tenant = "tnt_demo";
  const product = "prod_race";
  const svc1 = new InventoryService(app.db, app.events);

  await svc1.adjust(product, 10, "receiving", tenant); // seed 10
  assert.equal((await svc1.getStock(product, tenant)).stock_qty, 10);

  // db2 grabs the row lock, signals, waits, then commits a -6 before releasing.
  let lockHeld!: () => void;
  const held = new Promise<void>((r) => { lockHeld = r; });
  let release!: () => void;
  const canRelease = new Promise<void>((r) => { release = r; });

  const db2Work = db2.withTenant(tenant).tx(async (tdb) => {
    await tdb.one(
      "SELECT * FROM inventory WHERE tenant_id = @t AND product_id = @p FOR UPDATE",
      { t: tenant, p: product },
    );
    lockHeld();
    await canRelease;
    await tdb.query(
      "UPDATE inventory SET stock_qty = stock_qty - 6, updated_at = @n WHERE tenant_id = @t AND product_id = @p",
      { n: Date.now(), t: tenant, p: product },
    );
    // tx commits on return → stock is now 4, lock released.
  });

  await held; // db2 holds the row at qty=10
  const adjustP = svc1.adjust(product, -6, "sale", tenant); // must wait for the fresh value
  await new Promise((r) => setTimeout(r, 200)); // let adjust() reach its blocking point
  release();
  await db2Work;
  await adjustP;

  // With the fix: adjust() saw 4 (post-commit), 4-6 clamps to 0.
  // Without it: adjust() saw the stale 10, wrote 10-6=4 → db2's -6 is lost.
  const finalQty = (await svc1.getStock(product, tenant)).stock_qty;
  assert.equal(finalQty, 0, `expected 0 (both -6 applied to 10, clamped), got ${finalQty} — a lost update / oversell`);

  await db2.close();
  await app.db.close();
});
