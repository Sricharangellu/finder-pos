import { test } from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../../shared/db.js";
import { EventBus } from "../../shared/events.js";
import { OrderFulfillmentWorkflow } from "../workflows/order-fulfillment.workflow.js";

function makeDb(opts: { one?: unknown; query?: unknown[] } = {}): DB {
  return {
    query: async () => opts.query ?? [],
    one: async () => opts.one,
    exec: async () => undefined,
    tx: async (fn: (db: DB) => Promise<unknown>) => fn(makeDb(opts)),
    close: async () => undefined,
  } as unknown as DB;
}

function makeEvents() {
  const events = new EventBus();
  const published: Array<{ type: string; payload: unknown }> = [];
  events.onAny((e) => { published.push({ type: e.type, payload: e.payload }); });
  return { events, published };
}

test("fulfillment: builds context from payment.captured payload", () => {
  const ctx = OrderFulfillmentWorkflow.buildContext(
    { orderId: "ord_1", amountCents: 9999, tenantId: "t1" }, "t1",
  );
  assert.equal(ctx.orderId, "ord_1");
  assert.equal(ctx.requiresFulfillment, false);
  assert.equal(ctx.correlationId, "fulfillment_ord_1");
});

test("fulfillment: check_fulfillable returns false when pick list already exists", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "pl_existing" } });
  const ctx = OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 100, tenantId: "t1" }, "t1");
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "check_fulfillable")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.requiresFulfillment, false);
  assert.equal(updated.pickListId, "pl_existing");
});

test("fulfillment: check_fulfillable returns true for orders with physical lines", async () => {
  const { events } = makeEvents();
  // one() returns undefined (no existing pick list), query() returns physical lines
  let callCount = 0;
  const db: DB = {
    query: async () => [{ product_id: "p1", quantity: 2 }],
    one: async () => { callCount++; return undefined; },
    exec: async () => undefined,
    tx: async (fn: (db: DB) => Promise<unknown>) => fn(db),
    close: async () => undefined,
  } as unknown as DB;
  const ctx = OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 100, tenantId: "t1" }, "t1");
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "check_fulfillable")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.requiresFulfillment, true);
});

test("fulfillment: create_pick_list skips when requiresFulfillment is false", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    ...OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 0, tenantId: "t1" }, "t1"),
    requiresFulfillment: false,
  };
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "create_pick_list")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.pickListId, null);
  assert.equal(published.length, 0);
});

test("fulfillment: create_shipment emits shipment.created", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    ...OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 0, tenantId: "t1" }, "t1"),
    requiresFulfillment: true, pickListId: "pl_1", shipmentId: null,
  };
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "create_shipment")!;
  await step.execute(ctx, db, events);
  assert.ok(published.some((e) => e.type === "shipment.created"));
});

test("fulfillment: create_shipment compensate emits shipment.cancelled", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    ...OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 0, tenantId: "t1" }, "t1"),
    requiresFulfillment: true, pickListId: "pl_1", shipmentId: "ship_ord_1",
  };
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "create_shipment")!;
  await step.compensate!(ctx, db, events);
  assert.ok(published.some((e) => e.type === "shipment.cancelled"));
});

test("fulfillment: create_pick_list compensate issues DELETE queries", async () => {
  const { events } = makeEvents();
  const sqls: string[] = [];
  const db: DB = {
    query: async (sql: string) => { sqls.push(sql); return []; },
    one: async () => undefined,
    exec: async () => undefined,
    tx: async (fn: (db: DB) => Promise<unknown>) => fn(db),
    close: async () => undefined,
  } as unknown as DB;
  const ctx = {
    ...OrderFulfillmentWorkflow.buildContext({ orderId: "ord_1", amountCents: 0, tenantId: "t1" }, "t1"),
    requiresFulfillment: true, pickListId: "pl_1", shipmentId: null,
  };
  const step = OrderFulfillmentWorkflow.steps.find((s) => s.name === "create_pick_list")!;
  await step.compensate!(ctx, db, events);
  assert.ok(sqls.some((q) => q.includes("DELETE FROM pick_list_lines")));
});
