import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "./app.js";
import type { DomainEvent } from "./shared/types.js";

// ─── Staged outbox publish (ACPA M1.4) ────────────────────────────────────────
// stage(tdb, …) writes the outbox row inside the caller's transaction;
// dispatchStaged(event) runs the synchronous path after commit. A crash
// between commit and dispatch leaves a pending row for the reconciler —
// the event can no longer be lost.

let __seq = 0;
const __schema = () => `stg_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }

test("staged events commit atomically and dispatch only after dispatchStaged", async () => {
  const app = await freshApp();
  let applied = 0;
  app.events.on("m14.staged", () => { applied++; });
  app.outbox.onDurable("m14.staged", async () => { applied++; });

  let evt: DomainEvent | undefined;
  await app.db.tx(async (tdb) => {
    evt = await app.events.stage(tdb, "m14.staged", { tenantId: "tnt_demo" }, "agg_m14");
    // Inside the tx nothing has dispatched yet.
    assert.equal(applied, 0);
  });

  const row = await app.db.one<{ status: string }>(
    "SELECT status FROM event_outbox WHERE id = @id", { id: evt!.id },
  );
  assert.equal(row!.status, "pending"); // committed with the tx, not yet dispatched
  assert.equal(applied, 0);

  await app.events.dispatchStaged(evt!);
  assert.equal(applied, 1); // sync subscriber ran once (durable handler is for redelivery only)
  const after = await app.db.one<{ status: string }>(
    "SELECT status FROM event_outbox WHERE id = @id", { id: evt!.id },
  );
  assert.equal(after!.status, "delivered");
});

test("a staged event rolls back with its transaction — no orphan row", async () => {
  const app = await freshApp();
  app.outbox.onDurable("m14.rollback", async () => {});
  let evt: DomainEvent | undefined;
  await assert.rejects(
    app.db.tx(async (tdb) => {
      evt = await app.events.stage(tdb, "m14.rollback", { tenantId: "tnt_demo" });
      throw new Error("business write failed");
    }),
  );
  const row = await app.db.one<{ id: string }>(
    "SELECT id FROM event_outbox WHERE id = @id", { id: evt!.id },
  );
  assert.equal(row, undefined); // the row died with the transaction
});

test("crash after commit, before dispatch: the reconciler delivers the staged event exactly once", async () => {
  const app = await freshApp();
  let applied = 0;
  app.outbox.onDurable("m14.crash", async () => { applied++; });

  // Stage in a committed tx and simulate the crash by never calling dispatchStaged.
  await app.db.tx(async (tdb) => {
    await app.events.stage(tdb, "m14.crash", { tenantId: "tnt_demo" });
  });

  // The cutoff is strict (created_at < now - grace); let a millisecond pass so
  // a same-ms stage/reconcile pair can't tie on the timestamp.
  await new Promise((r) => setTimeout(r, 5));
  const first = await app.outbox.reconcile(0); // 0 = no in-flight grace, deliver now
  assert.equal(first.delivered, 1);
  assert.equal(applied, 1);

  const second = await app.outbox.reconcile(0);
  assert.equal(second.delivered, 0); // already delivered — nothing pending
  assert.equal(applied, 1);
});
