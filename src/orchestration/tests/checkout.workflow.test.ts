/**
 * Checkout Workflow — unit tests
 * Runner: node --test (project standard)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../../shared/db.js";
import { EventBus } from "../../shared/events.js";
import { CheckoutWorkflow } from "../workflows/checkout.workflow.js";

function makeDb(overrides: Partial<{ one: unknown; query: unknown[] }> = {}): DB {
  return {
    query: async () => overrides.query ?? [],
    one: async () => overrides.one,
    exec: async () => undefined,
    tx: async (fn: (db: DB) => Promise<unknown>) => fn(makeDb(overrides)),
    close: async () => undefined,
  } as unknown as DB;
}

function makeEvents(): { events: EventBus; published: Array<{ type: string; payload: unknown }> } {
  const events = new EventBus();
  const published: Array<{ type: string; payload: unknown }> = [];
  events.onAny((e) => { published.push({ type: e.type, payload: e.payload }); });
  return { events, published };
}

test("checkout: builds correct context from order.created payload", () => {
  const ctx = CheckoutWorkflow.buildContext(
    { id: "ord_123", orderNumber: "1001", tenantId: "t1", customerId: "cust_1", totalCents: 5000, stateCode: "TX", lines: [] },
    "t1",
  );
  assert.equal(ctx.orderId, "ord_123");
  assert.equal(ctx.totalCents, 5000);
  assert.equal(ctx.customerId, "cust_1");
  assert.equal(ctx.correlationId, "ord_123");
  assert.equal(ctx.workflowId, "");
});

test("checkout: validate_order throws when order not found", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: undefined });
  const ctx = CheckoutWorkflow.buildContext(
    { id: "ord_missing", orderNumber: "X", tenantId: "t1", totalCents: 0, stateCode: "TX", lines: [] },
    "t1",
  );
  const step = CheckoutWorkflow.steps.find((s) => s.name === "validate_order")!;
  await assert.rejects(() => step.execute(ctx, db, events), /not found/);
});

test("checkout: validate_order populates tax from DB", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "ord_1", status: "open", total_cents: 10000, tax_cents: 825 } });
  const ctx = CheckoutWorkflow.buildContext(
    { id: "ord_1", orderNumber: "1001", tenantId: "t1", totalCents: 10000, stateCode: "TX", lines: [] },
    "t1",
  );
  const step = CheckoutWorkflow.steps.find((s) => s.name === "validate_order")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.taxCents, 825);
  assert.equal(updated.totalCents, 10000);
});

test("checkout: post_accounting emits entry_requested with cash debit", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "ord_1", orderId: "ord_1",
    orderNumber: "1001", customerId: null, totalCents: 10825, taxCents: 825,
    stateCode: "TX", journalEntryId: null, pointsAwarded: 0,
  };
  const step = CheckoutWorkflow.steps.find((s) => s.name === "post_accounting")!;
  await step.execute(ctx, db, events);
  const acctEvent = published.find((e) => e.type === "accounting.entry_requested");
  assert.ok(acctEvent, "accounting.entry_requested event expected");
  const lines = (acctEvent!.payload as { lines: Array<{ accountCode: string; debitCents: number }> }).lines;
  const debitLine = lines.find((l) => l.accountCode === "1010");
  assert.equal(debitLine?.debitCents, 10825);
});

test("checkout: post_accounting compensate emits reversal referenceId", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "ord_1", orderId: "ord_1",
    orderNumber: "1001", customerId: null, totalCents: 10000, taxCents: 800,
    stateCode: "TX", journalEntryId: "je_1", pointsAwarded: 0,
  };
  const step = CheckoutWorkflow.steps.find((s) => s.name === "post_accounting")!;
  await step.compensate!(ctx, db, events);
  const reversal = published.find((e) => e.type === "accounting.entry_requested");
  assert.ok(reversal, "reversal event expected");
  assert.ok((reversal!.payload as { referenceId: string }).referenceId.includes("reversal"));
});

test("checkout: earn_loyalty awards points (1 per $1)", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "ord_1", orderId: "ord_1",
    orderNumber: "1001", customerId: "cust_1", totalCents: 2500, taxCents: 0,
    stateCode: "TX", journalEntryId: null, pointsAwarded: 0,
  };
  const step = CheckoutWorkflow.steps.find((s) => s.name === "earn_loyalty")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.pointsAwarded, 25);
  assert.ok(published.some((e) => e.type === "loyalty.points_earned"));
});

test("checkout: earn_loyalty skips if no customer", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "ord_1", orderId: "ord_1",
    orderNumber: "1001", customerId: null, totalCents: 5000, taxCents: 0,
    stateCode: "TX", journalEntryId: null, pointsAwarded: 0,
  };
  const step = CheckoutWorkflow.steps.find((s) => s.name === "earn_loyalty")!;
  const updated = await step.execute(ctx, db, events);
  assert.equal(updated.pointsAwarded, 0);
  assert.equal(published.length, 0);
});

test("checkout: emit_confirmation publishes checkout.completed", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "ord_1", orderId: "ord_1",
    orderNumber: "1001", customerId: null, totalCents: 5000, taxCents: 400,
    stateCode: "TX", journalEntryId: "je_1", pointsAwarded: 50,
  };
  const step = CheckoutWorkflow.steps.find((s) => s.name === "emit_confirmation")!;
  await step.execute(ctx, db, events);
  assert.equal(published[0].type, "checkout.completed");
});
