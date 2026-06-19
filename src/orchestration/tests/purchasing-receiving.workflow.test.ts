import { test } from "node:test";
import assert from "node:assert/strict";
import type { DB } from "../../shared/db.js";
import { EventBus } from "../../shared/events.js";
import { PurchaseReceivingWorkflow } from "../workflows/purchasing-receiving.workflow.js";

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

test("purchasing: builds context from purchase_order.received payload", () => {
  const ctx = PurchaseReceivingWorkflow.buildContext({
    poId: "po_1", supplierId: "sup_1", tenantId: "t1", totalCostCents: 5000,
    lines: [{ productId: "p1", quantity: 10, unitCostCents: 500, landedCostCents: 50 }],
  }, "t1");
  assert.equal(ctx.poId, "po_1");
  assert.equal(ctx.totalCostCents, 5000);
  assert.equal(ctx.landedCostCents, 50);
});

test("purchasing: validate_po throws if PO not found", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: undefined });
  const ctx = PurchaseReceivingWorkflow.buildContext(
    { poId: "po_missing", supplierId: "s1", tenantId: "t1", totalCostCents: 0, lines: [] }, "t1",
  );
  const step = PurchaseReceivingWorkflow.steps.find((s) => s.name === "validate_po")!;
  await assert.rejects(() => step.execute(ctx, db, events), /not found/);
});

test("purchasing: validate_po throws if PO has unexpected status", async () => {
  const { events } = makeEvents();
  const db = makeDb({ one: { id: "po_1", status: "draft", supplier_id: "s1", total_cost_cents: 5000 } });
  const ctx = PurchaseReceivingWorkflow.buildContext(
    { poId: "po_1", supplierId: "s1", tenantId: "t1", totalCostCents: 5000, lines: [] }, "t1",
  );
  const step = PurchaseReceivingWorkflow.steps.find((s) => s.name === "validate_po")!;
  await assert.rejects(() => step.execute(ctx, db, events), /unexpected status/);
});

test("purchasing: post_ap_accounting emits entry with inventory + AP accounts", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "po_1",
    poId: "po_1", supplierId: "s1", totalCostCents: 5000, landedCostCents: 200,
    lines: [], apPosted: false, vendorBalanceUpdated: false,
  };
  const step = PurchaseReceivingWorkflow.steps.find((s) => s.name === "post_ap_accounting")!;
  await step.execute(ctx, db, events);
  const acctEvt = published.find((e) => e.type === "accounting.entry_requested");
  assert.ok(acctEvt, "accounting.entry_requested expected");
  const lines = (acctEvt!.payload as { lines: Array<{ accountCode: string }> }).lines;
  assert.ok(lines.some((l) => l.accountCode === "1300"), "inventory account (1300) expected");
  assert.ok(lines.some((l) => l.accountCode === "2000"), "AP account (2000) expected");
});

test("purchasing: update_vendor_balance issues UPDATE on suppliers", async () => {
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
    workflowId: "wf_1", tenantId: "t1", correlationId: "po_1",
    poId: "po_1", supplierId: "sup_1", totalCostCents: 5000, landedCostCents: 100,
    lines: [], apPosted: true, vendorBalanceUpdated: false,
  };
  const step = PurchaseReceivingWorkflow.steps.find((s) => s.name === "update_vendor_balance")!;
  await step.execute(ctx, db, events);
  assert.ok(sqls.some((q) => q.includes("due_amount_cents")));
});

test("purchasing: post_ap_accounting compensate emits reversal", async () => {
  const { events, published } = makeEvents();
  const db = makeDb();
  const ctx = {
    workflowId: "wf_1", tenantId: "t1", correlationId: "po_1",
    poId: "po_1", supplierId: "s1", totalCostCents: 5000, landedCostCents: 0,
    lines: [], apPosted: true, vendorBalanceUpdated: false,
  };
  const step = PurchaseReceivingWorkflow.steps.find((s) => s.name === "post_ap_accounting")!;
  await step.compensate!(ctx, db, events);
  const reversal = published.find((e) => e.type === "accounting.entry_requested");
  assert.ok(reversal, "reversal event expected");
  assert.ok((reversal!.payload as { referenceId: string }).referenceId.includes("reversal"));
});
