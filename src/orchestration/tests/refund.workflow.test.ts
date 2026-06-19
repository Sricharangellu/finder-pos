import { test } from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../../shared/db.js";
import { EventBus } from "../../shared/events.js";
import { RefundWorkflow } from "../workflows/refund.workflow.js";

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

test("refund: builds context from order.refunded payload", () => {
  const ctx = RefundWorkflow.buildContext({
    id: "ord_1", tenantId: "t1", refundCents: 3000, originalTotalCents: 5000,
    customerId: "cust_1", lines: [{ productId: "p1", quantity: 1 }],
  }, "t1");
  assert.equal(ctx.orderId, "ord_1");
  assert.equal(ctx.refundCents, 3000);
  assert.equal(ctx.customerId, "cust_1");
});

test("refund: validate_eligibility throws when order not found", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: undefined });
  const ctx = RefundWorkflow.buildContext(
    { id: "ord_x", tenantId: "t1", refundCents: 100, originalTotalCents: 100, lines: [] }, "t1",
  );
  const step = RefundWorkflow.steps.find((s) => s.name === "validate_refund_eligibility")!;
  await assert.rejects(() => step.execute(ctx, db, events), /not found/);
});

test("refund: validate_eligibility throws when amount exceeds refundable balance", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "ord_1", status: "open", total_cents: 5000, tax_cents: 400, refunded_cents: 3000 } });
  const ctx = RefundWorkflow.buildContext(
    { id: "ord_1", tenantId: "t1", refundCents: 3000, originalTotalCents: 5000, lines: [] }, "t1",
  );
  const step = RefundWorkflow.steps.find((s) => s.name === "validate_refund_eligibility")!;
  await assert.rejects(() => step.execute(ctx, db, events), /exceeds refundable balance/);
});

test("refund: validate_eligibility throws for voided orders", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "ord_1", status: "void", total_cents: 5000, tax_cents: 0, refunded_cents: 0 } });
  const ctx = RefundWorkflow.buildContext(
    { id: "ord_1", tenantId: "t1", refundCents: 1000, originalTotalCents: 5000, lines: [] }, "t1",
  );
  const step = RefundWorkflow.steps.find((s) => s.name === "validate_refund_eligibility")!;
  await assert.rejects(() => step.execute(ctx, db, events), /cannot be refunded/);
});

test("refund: double_refund_guard throws on duplicate", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "ref_existing", status: "processed" } });
  const ctx = {
    ...RefundWorkflow.buildContext(
      { id: "ord_1", tenantId: "t1", refundCents: 1000, originalTotalCents: 5000, lines: [] }, "t1",
    ),
    taxCents: 0, subtotalCents: 1000,
  };
  const step = RefundWorkflow.steps.find((s) => s.name === "check_double_refund_guard")!;
  await assert.rejects(() => step.execute(ctx, db, events), /duplicate refund/);
});

test("refund: restore_inventory skips when payment refund did not succeed", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    ...RefundWorkflow.buildContext(
      { id: "ord_1", tenantId: "t1", refundCents: 1000, originalTotalCents: 5000,
        lines: [{ productId: "p1", quantity: 1 }] }, "t1",
    ),
    paymentRefundSucceeded: false, taxCents: 0, subtotalCents: 1000, refundId: "ref_1",
  };
  const step = RefundWorkflow.steps.find((s) => s.name === "restore_inventory")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.inventoryRestored, false);
  assert.equal(published.length, 0);
});

test("refund: process_payment_refund emits payment.refunded", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    ...RefundWorkflow.buildContext(
      { id: "ord_1", tenantId: "t1", refundCents: 1000, originalTotalCents: 5000, lines: [] }, "t1",
    ),
    refundId: "ref_1", taxCents: 0, subtotalCents: 1000,
    paymentRefundSucceeded: false, inventoryRestored: false,
    accountingReversed: false, loyaltyReversed: false, pointsToReverse: 0,
  };
  const step = RefundWorkflow.steps.find((s) => s.name === "process_payment_refund")!;
  await step.execute(ctx, db, events);
  assert.ok(published.some((e) => e.type === "payment.refunded"));
});

test("refund: process_payment_refund compensate marks refund as exception", async () => {
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
    ...RefundWorkflow.buildContext(
      { id: "ord_1", tenantId: "t1", refundCents: 1000, originalTotalCents: 5000, lines: [] }, "t1",
    ),
    refundId: "ref_1", taxCents: 0, subtotalCents: 1000,
    paymentRefundSucceeded: true, inventoryRestored: false,
    accountingReversed: false, loyaltyReversed: false, pointsToReverse: 0,
  };
  const step = RefundWorkflow.steps.find((s) => s.name === "process_payment_refund")!;
  await step.compensate!(ctx, db, events);
  assert.ok(sqls.some((q) => q.includes("exception")));
});
