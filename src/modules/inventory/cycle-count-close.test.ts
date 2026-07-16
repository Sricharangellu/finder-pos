/**
 * cycle-count-close.test.ts — closeCycleCount applies variance exactly once
 * (session D, inventory focus).
 *
 * closeCycleCount read the session, checked status=='open', looped applying
 * variance adjustments, THEN flipped to 'closed' — none of it atomic. Two
 * concurrent closes both passed the open-check and applied EVERY variance
 * twice, double-counting the correction into stock. The fix locks the session
 * row FOR UPDATE inside one transaction, so the second close 409s and the
 * adjustments apply once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { openDb, type DB } from "../../shared/db.js";
import { InventoryService } from "./service.js";
import { HttpError } from "../../shared/http.js";

let __seq = 0;
const __schema = () => `ccclose_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

test("concurrent closeCycleCount applies each variance exactly once", async () => {
  const schema = __schema();
  const app: App = await buildApp({ schema });
  const db2: DB = openDb({ schema }); // second closer
  const db3: DB = openDb({ schema }); // barrier: holds the inventory row lock
  const svc1 = new InventoryService(app.db, app.events);
  const svc2 = new InventoryService(db2, app.events);
  const tenant = "tnt_demo";
  const product = "prod_cc";

  await svc1.adjust(product, 10, "receiving", tenant); // stock 10
  const session = await svc1.openCycleCount("usr_x", tenant); // snapshot expected=10
  await svc1.recordCycleCountLine(session.id, product, 7, tenant); // variance -3

  // db3 locks the inventory row, forcing both closes to park at their variance
  // adjustment AFTER each has already read the session — reproducing the race
  // deterministically (Promise.all alone lets the first close finish first).
  let lockHeld!: () => void;
  const held = new Promise<void>((r) => { lockHeld = r; });
  let release!: () => void;
  const canRelease = new Promise<void>((r) => { release = r; });
  const barrier = db3.withTenant(tenant).tx(async (tdb) => {
    await tdb.one("SELECT * FROM inventory WHERE tenant_id = @t AND product_id = @p FOR UPDATE", { t: tenant, p: product });
    lockHeld();
    await canRelease;
  });
  await held;

  const closeA = svc1.closeCycleCount(session.id, tenant);
  const closeB = svc2.closeCycleCount(session.id, tenant);
  await new Promise((r) => setTimeout(r, 300)); // both reach the (blocked) adjustment
  release();
  await barrier;
  const results = await Promise.allSettled([closeA, closeB]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const conflicts = results.filter(
    (r) => r.status === "rejected" && r.reason instanceof HttpError && r.reason.status === 409,
  ).length;

  assert.equal(fulfilled, 1, "exactly one close should succeed");
  assert.equal(conflicts, 1, "the losing close should 409 (already closed)");

  // Variance applied ONCE: 10 - 3 = 7. The bug double-applies → 4.
  const finalQty = (await svc1.getStock(product, tenant)).stock_qty;
  assert.equal(finalQty, 7, `variance must post exactly once (10-3=7), got ${finalQty}`);

  // The movement ledger has exactly one cycle_count row for this session.
  const movements = await svc1.movements(product, tenant, { limit: 50 });
  const ccRows = movements.items.filter((m) => m.reason === "cycle_count");
  assert.equal(ccRows.length, 1, `exactly one cycle_count movement, got ${ccRows.length}`);

  await db3.close();
  await db2.close();
  await app.db.close();
});

test("re-closing an already-closed session 409s and does not double-post", async () => {
  const app: App = await buildApp({ schema: __schema() });
  const svc = new InventoryService(app.db, app.events);
  const tenant = "tnt_demo";
  const product = "prod_cc2";

  await svc.adjust(product, 10, "receiving", tenant);
  const session = await svc.openCycleCount("usr_x", tenant);
  await svc.recordCycleCountLine(session.id, product, 8, tenant); // variance -2

  const first = await svc.closeCycleCount(session.id, tenant);
  assert.equal(first.adjustments, 1);
  assert.equal((await svc.getStock(product, tenant)).stock_qty, 8);

  await assert.rejects(
    () => svc.closeCycleCount(session.id, tenant),
    (e: unknown) => e instanceof HttpError && e.status === 409,
    "second close should 409",
  );
  assert.equal((await svc.getStock(product, tenant)).stock_qty, 8, "stock unchanged by the rejected re-close");

  await app.db.close();
});
