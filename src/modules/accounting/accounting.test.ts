import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

// ─── Chart of Accounts ────────────────────────────────────────────────────────

test("create an account and list it", async () => {
  const app = await freshApp();

  const r = await call(app, "POST", "/api/accounting/accounts", {
    code: "1010",
    name: "Cash on Hand",
    type: "asset",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("acct_"));
  assert.equal(r.json.code, "1010");
  assert.equal(r.json.name, "Cash on Hand");
  assert.equal(r.json.type, "asset");
  assert.equal(r.json.is_active, 1);

  const list = await call(app, "GET", "/api/accounting/accounts");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((a: { id: string }) => a.id === r.json.id));
});

test("filter accounts by type", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/accounting/accounts", { code: "2000", name: "Accounts Payable", type: "liability" });
  await call(app, "POST", "/api/accounting/accounts", { code: "4000", name: "Sales Revenue", type: "income" });

  const liabilities = await call(app, "GET", "/api/accounting/accounts?type=liability");
  assert.equal(liabilities.status, 200);
  assert.ok(liabilities.json.items.every((a: { type: string }) => a.type === "liability"));

  const income = await call(app, "GET", "/api/accounting/accounts?type=income");
  assert.equal(income.status, 200);
  assert.ok(income.json.items.every((a: { type: string }) => a.type === "income"));
});

test("create child account and retrieve tree", async () => {
  const app = await freshApp();
  const parent = (await call(app, "POST", "/api/accounting/accounts", { code: "1000", name: "Assets", type: "asset" })).json;
  const child = (await call(app, "POST", "/api/accounting/accounts", {
    code: "1001",
    name: "Petty Cash",
    type: "asset",
    parentId: parent.id,
  })).json;
  assert.equal(child.parent_id, parent.id);

  const tree = await call(app, "GET", "/api/accounting/accounts/tree");
  assert.equal(tree.status, 200);
  const parentNode = tree.json.items.find((n: { id: string }) => n.id === parent.id);
  assert.ok(parentNode, "parent in tree");
  assert.ok(Array.isArray(parentNode.children));
  assert.ok(parentNode.children.some((c: { id: string }) => c.id === child.id));
});

test("update an account name and deactivate it", async () => {
  const app = await freshApp();
  const acc = (await call(app, "POST", "/api/accounting/accounts", { code: "5000", name: "Old Name", type: "expense" })).json;

  const updated = await call(app, "PATCH", `/api/accounting/accounts/${acc.id}`, { name: "Operating Expenses", isActive: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.name, "Operating Expenses");
  assert.equal(updated.json.is_active, 0); // stored as integer in SQLite/pg
});

test("seed default chart of accounts", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/accounting/accounts/seed", {});
  assert.equal(r.status, 200);
  assert.ok(typeof r.json.seeded === "number" && r.json.seeded > 0);

  // Seeded accounts should appear in the list
  const list = await call(app, "GET", "/api/accounting/accounts");
  assert.ok(list.json.items.length >= r.json.seeded);
});

test("account code must be unique per tenant", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/accounting/accounts", { code: "9999", name: "First", type: "expense" });
  const dupe = await call(app, "POST", "/api/accounting/accounts", { code: "9999", name: "Second", type: "expense" });
  assert.equal(dupe.status, 409);
});

// ─── Manual Deposits ──────────────────────────────────────────────────────────

test("create a manual deposit and approve it", async () => {
  const app = await freshApp();
  // Manual deposit auto-selects first asset account — seed defaults so one exists
  await call(app, "POST", "/api/accounting/accounts/seed", {});

  const dep = await call(app, "POST", "/api/accounting/deposits", {
    totalCents: 75000,
    note: "Daily cash drop",
  });
  assert.equal(dep.status, 201, `deposit creation failed: ${JSON.stringify(dep.json)}`);
  assert.ok(dep.json.id.startsWith("dep_"));
  assert.equal(dep.json.status, "pending_approval");
  assert.equal(dep.json.total_cents, 75000);

  const approved = await call(app, "POST", `/api/accounting/deposits/${dep.json.id}/approve`, {});
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");
});

test("create a manual deposit and reject it", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/accounting/accounts/seed", {});
  const dep = (await call(app, "POST", "/api/accounting/deposits", { totalCents: 5000 })).json;

  const rejected = await call(app, "POST", `/api/accounting/deposits/${dep.id}/reject`, {});
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.status, "rejected");
});

test("list deposits and get by id", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/accounting/accounts/seed", {});
  const dep = (await call(app, "POST", "/api/accounting/deposits", { totalCents: 10000, note: "Test" })).json;

  const list = await call(app, "GET", "/api/accounting/deposits");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((d: { id: string }) => d.id === dep.id));

  const got = await call(app, "GET", `/api/accounting/deposits/${dep.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.id, dep.id);
  assert.equal(got.json.total_cents, 10000);
});

test("list deposits filtered by status", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/accounting/accounts/seed", {});
  const dep = (await call(app, "POST", "/api/accounting/deposits", { totalCents: 3000 })).json;
  await call(app, "POST", `/api/accounting/deposits/${dep.id}/approve`, {});

  const approved = await call(app, "GET", "/api/accounting/deposits?status=approved");
  assert.equal(approved.status, 200);
  assert.ok(approved.json.items.every((d: { status: string }) => d.status === "approved"));

  const pending = await call(app, "GET", "/api/accounting/deposits?status=pending_approval");
  assert.equal(pending.status, 200);
  assert.ok(pending.json.items.every((d: { status: string }) => d.status === "pending_approval"));
});

// ─── Posting ledger ───────────────────────────────────────────────────────────

async function setupReceivedPO(app: App) {
  const prod = await call(app, "POST", "/api/catalog/", { sku: `LED-${Date.now()}`, name: "Ledger Widget", price_cents: 1500, category: "general" });
  assert.equal(prod.status, 201);
  const sup = await call(app, "POST", "/api/purchasing/suppliers", { name: "Ledger Supply Co" });
  assert.equal(sup.status, 201);
  const po = await call(app, "POST", "/api/purchasing/orders", {
    supplierId: sup.json.id,
    lines: [{ productId: prod.json.id, quantity: 10, unitCostCents: 500 }], // $50 goods
  });
  assert.equal(po.status, 201);
  const recv = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/receive`, {});
  assert.equal(recv.status, 200);
  return { poId: po.json.id as string };
}

test("receiving a PO posts Dr Inventory / Cr GRNI, and the auto-bill posts GRNI -> AP", async () => {
  const app = await freshApp();
  const { poId } = await setupReceivedPO(app);

  // Receipt posting: 5000 into Inventory, 5000 into GRNI.
  const receipt = await call(app, "GET", "/api/accounting/journal?docType=purchase_receipt");
  assert.equal(receipt.status, 200);
  assert.equal(receipt.json.items.length, 2);
  const dr = receipt.json.items.find((e: any) => e.debit_cents > 0);
  const cr = receipt.json.items.find((e: any) => e.credit_cents > 0);
  assert.equal(dr.account_code, "1200"); // Inventory Asset
  assert.equal(dr.debit_cents, 5000);
  assert.equal(cr.account_code, "2050"); // GRNI
  assert.equal(cr.credit_cents, 5000);
  assert.equal(dr.entry_group, cr.entry_group); // one balanced transaction
  assert.ok(String(dr.memo).includes(poId));

  // Auto-drafted bill (billing listens to purchase_order.received) relieves GRNI into AP.
  const billPost = await call(app, "GET", "/api/accounting/journal?docType=bill");
  assert.equal(billPost.json.items.length, 2);
  const billDr = billPost.json.items.find((e: any) => e.debit_cents > 0);
  const billCr = billPost.json.items.find((e: any) => e.credit_cents > 0);
  assert.equal(billDr.account_code, "2050");
  assert.equal(billCr.account_code, "2000"); // Accounts Payable
  assert.equal(billCr.credit_cents, 5000);
});

test("paying a bill posts Dr AP / Cr Bank, and the trial balance stays balanced", async () => {
  const app = await freshApp();
  await setupReceivedPO(app);

  const bills = await call(app, "GET", "/api/billing/bills");
  assert.equal(bills.status, 200);
  const bill = bills.json.items[0];
  const pay = await call(app, "POST", `/api/billing/bills/${bill.id}/pay`, { amountCents: 5000, method: "ach" });
  assert.equal(pay.status, 200);

  const payment = await call(app, "GET", "/api/accounting/journal?docType=bill_payment");
  assert.equal(payment.json.items.length, 2);
  const dr = payment.json.items.find((e: any) => e.debit_cents > 0);
  const cr = payment.json.items.find((e: any) => e.credit_cents > 0);
  assert.equal(dr.account_code, "2000"); // AP relieved
  assert.equal(cr.account_code, "1010"); // Bank Checking down
  assert.equal(cr.credit_cents, 5000);

  // Trial balance: total debits == total credits; GRNI nets to zero
  // (received 5000 credit, relieved 5000 debit); AP nets to zero after payment.
  const tb = await call(app, "GET", "/api/accounting/trial-balance");
  assert.equal(tb.status, 200);
  assert.equal(tb.json.total_debit_cents, tb.json.total_credit_cents);
  const grni = tb.json.accounts.find((a: any) => a.account_code === "2050");
  assert.equal(grni.balance_cents, 0);
  const ap = tb.json.accounts.find((a: any) => a.account_code === "2000");
  assert.equal(ap.balance_cents, 0);
  const inventory = tb.json.accounts.find((a: any) => a.account_code === "1200");
  assert.equal(inventory.balance_cents, 5000); // asset remains on the books
});

test("manual journal transactions must balance and use known accounts", async () => {
  const app = await freshApp();

  const unbalanced = await call(app, "POST", "/api/accounting/journal", {
    legs: [
      { accountCode: "1000", debitCents: 100 },
      { accountCode: "4000", creditCents: 90 },
    ],
  });
  assert.equal(unbalanced.status, 400);

  const unknownAccount = await call(app, "POST", "/api/accounting/journal", {
    legs: [
      { accountCode: "9999", debitCents: 100 },
      { accountCode: "4000", creditCents: 100 },
    ],
  });
  assert.equal(unknownAccount.status, 400);

  const ok = await call(app, "POST", "/api/accounting/journal", {
    memo: "opening cash",
    legs: [
      { accountCode: "1000", debitCents: 100000 },
      { accountCode: "4000", creditCents: 100000 },
    ],
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.items.length, 2);
  assert.equal(ok.json.items[0].doc_type, "manual");
});

// ─── Refund ledger reversal ───────────────────────────────────────────────────
// A POS sale posts Dr Cash / Cr Revenue on payment.captured. A full refund must
// post the mirror image (Dr Revenue / Cr Cash) so cash and revenue net back out;
// without it the refunded sale stays on the books, overstating both. The only
// prior refund-posting path (the accounting.entry_requested workflow) writes to a
// journal schema that was never migrated, so refunds silently never posted.

test("refunding a POS order reverses the sale in the ledger and rebalances the trial balance", async () => {
  const app = await freshApp();
  const tenantId = "tnt_demo"; // the auth helper's tenant
  const orderId = "ord_refund_1";
  const total = 12000; // $120 sale, tax-inclusive

  // Sale: payment captured recognizes revenue and takes cash.
  await app.events.publish("payment.captured", {
    tenantId, id: "pay_refund_1", orderId, amountCents: total, changeCents: 0,
  });

  // Precondition: the sale posted Dr 1000 Cash / Cr 4000 Revenue.
  const sale = await call(app, "GET", `/api/accounting/journal?docType=pos_payment&docId=pay_refund_1`);
  assert.equal(sale.json.items.length, 2, "sale posted two legs");
  const tbBefore = await call(app, "GET", "/api/accounting/trial-balance");
  assert.equal(tbBefore.json.accounts.find((a: any) => a.account_code === "4000").balance_cents, -total, "revenue credited by the sale");
  assert.equal(tbBefore.json.accounts.find((a: any) => a.account_code === "1000").balance_cents, total, "cash debited by the sale");

  // Refund the whole order.
  await app.events.publish("order.refunded", {
    id: orderId, tenantId, orderNumber: "ON-1", totalCents: total,
  });

  // The refund must post the mirror reversal Dr 4000 Revenue / Cr 1000 Cash.
  const refund = await call(app, "GET", `/api/accounting/journal?docType=pos_refund&docId=${orderId}`);
  assert.equal(refund.status, 200);
  assert.equal(refund.json.items.length, 2, "refund posted two legs (regression: was 0 — refunds never hit the ledger)");
  const dr = refund.json.items.find((e: any) => e.debit_cents > 0);
  const cr = refund.json.items.find((e: any) => e.credit_cents > 0);
  assert.equal(dr.account_code, "4000", "revenue debited (reversed) on refund");
  assert.equal(dr.debit_cents, total);
  assert.equal(cr.account_code, "1000", "cash credited (paid out) on refund");
  assert.equal(cr.credit_cents, total);
  assert.equal(dr.entry_group, cr.entry_group, "one balanced transaction");

  // Trial balance: sale + refund cancel, so cash and revenue net to zero and the
  // ledger stays balanced.
  const tb = await call(app, "GET", "/api/accounting/trial-balance");
  assert.equal(tb.json.total_debit_cents, tb.json.total_credit_cents, "ledger balanced");
  assert.equal(tb.json.accounts.find((a: any) => a.account_code === "4000").balance_cents, 0, "revenue nets to zero after refund");
  assert.equal(tb.json.accounts.find((a: any) => a.account_code === "1000").balance_cents, 0, "cash nets to zero after refund");
});

test("refund ledger posting is idempotent (redelivery never double-reverses)", async () => {
  const app = await freshApp();
  const tenantId = "tnt_demo";
  const orderId = "ord_refund_idem";

  await app.events.publish("payment.captured", { tenantId, id: "pay_idem", orderId, amountCents: 5000, changeCents: 0 });
  // Publish the same refund twice — a redelivered event must not post twice.
  await app.events.publish("order.refunded", { id: orderId, tenantId, orderNumber: "ON-2", totalCents: 5000 });
  await app.events.publish("order.refunded", { id: orderId, tenantId, orderNumber: "ON-2", totalCents: 5000 });

  const refund = await call(app, "GET", `/api/accounting/journal?docType=pos_refund&docId=${orderId}`);
  assert.equal(refund.json.items.length, 2, "exactly one balanced refund transaction despite duplicate delivery");
});

// ─── Transactional outbox (ACPA M1) ───────────────────────────────────────────

test("normal flow: financial events are persisted and marked delivered", async () => {
  const app = await freshApp();
  await setupReceivedPO(app);

  // receive publishes purchase_order.received (durable) and auto-bill publishes
  // bill.created (durable) — both rows must exist and be delivered, none pending.
  const rows = await app.db.query<{ type: string; status: string }>(
    "SELECT type, status FROM event_outbox ORDER BY created_at", {},
  );
  const types = rows.map((r) => r.type);
  assert.ok(types.includes("purchase_order.received"), `outbox rows: ${types.join(",")}`);
  assert.ok(types.includes("bill.created"));
  assert.ok(rows.every((r) => r.status === "delivered"), "no row may stay pending on the happy path");
});

test("crash recovery: a pending outbox row is redelivered to idempotent consumers exactly once", async () => {
  const app = await freshApp();
  const sup = await call(app, "POST", "/api/purchasing/suppliers", { name: "Crash Supply" });

  // Simulate a crash after the business write but before dispatch: a bill.created
  // event sits in the outbox as 'pending' with no ledger posting made.
  const billId = "bil_crashsim_1";
  await app.db.query(
    `INSERT INTO event_outbox (id, tenant_id, type, payload, aggregate_id, occurred_at, dispatched, status, attempts, created_at)
     VALUES ('obx_crash_1', 'tnt_demo', 'bill.created', @payload, @agg, @occ, TRUE, 'pending', 0, @past)`,
    {
      payload: JSON.stringify({ tenantId: "tnt_demo", billId, supplierId: sup.json.id, poId: null, totalCents: 7700 }),
      agg: billId,
      occ: new Date().toISOString(),
      past: Date.now() - 60_000, // older than the reconciler's in-flight window
    },
  );

  // First reconcile: posts Dr GRNI / Cr AP for the lost event.
  const first = await app.outbox.reconcile();
  assert.equal(first.delivered, 1);
  const journal = await call(app, "GET", `/api/accounting/journal?docType=bill&docId=${billId}`);
  assert.equal(journal.json.items.length, 2); // one balanced transaction
  assert.equal(journal.json.items.reduce((s: number, e: any) => s + e.debit_cents, 0), 7700);

  // Row is now delivered; a second reconcile must not double-post (idempotency).
  const second = await app.outbox.reconcile();
  assert.equal(second.delivered, 0);
  const again = await call(app, "GET", `/api/accounting/journal?docType=bill&docId=${billId}`);
  assert.equal(again.json.items.length, 2);
});

test("a failing durable consumer increments attempts and stays pending for retry", async () => {
  const app = await freshApp();
  // Malformed payload → JSON.parse succeeds but posting is skipped (totalCents 0
  // → handler no-ops → delivered). Use a genuinely failing case: unparseable is
  // impossible here, so register a one-shot failing consumer type instead.
  let calls = 0;
  app.outbox.onDurable("test.always_fails", async () => { calls++; throw new Error("boom"); });
  await app.db.query(
    `INSERT INTO event_outbox (id, tenant_id, type, payload, aggregate_id, occurred_at, dispatched, status, attempts, created_at)
     VALUES ('obx_fail_1', 'tnt_demo', 'test.always_fails', '{}', 'obx_fail_1', @occ, TRUE, 'pending', 0, @past)`,
    { occ: new Date().toISOString(), past: Date.now() - 60_000 },
  );
  const r = await app.outbox.reconcile();
  assert.equal(r.failed, 1);
  assert.equal(calls, 1);
  const row = await app.db.one<{ status: string; attempts: number; last_error: string }>(
    "SELECT status, attempts, last_error FROM event_outbox WHERE id = 'obx_fail_1'", {},
  );
  assert.equal(row!.status, "pending"); // retried on the next sweep
  assert.equal(Number(row!.attempts), 1);
  assert.match(row!.last_error, /boom/);
});

test("stable event identity: crash between dispatch and delivery-marking never double-posts (ACPA M1.3)", async () => {
  const app = await freshApp();
  await setupReceivedPO(app);
  const before = await app.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM journal_entries", {});

  // Crash window: every delivered row goes back to pending, then the reconciler
  // redelivers. Because redelivered events carry the ORIGINAL occurredAt (not a
  // regenerated timestamp), every posting's idempotency key matches and no
  // consumer double-applies.
  await app.db.query(
    "UPDATE event_outbox SET status = 'pending', created_at = @past WHERE status = 'delivered'",
    { past: Date.now() - 60_000 },
  );
  const r = await app.outbox.reconcile();
  assert.ok(r.delivered >= 2, "rows were redelivered");
  const after = await app.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM journal_entries", {});
  assert.equal(after!.n, before!.n, "journal must not grow on redelivery");
});

// ─── Journal keyset pagination (session D, loop iter 5) ───────────────────────
// journal_entries is the most append-heavy financial table; listJournal used a
// bare LIMIT 500 with no cursor, so ledger/audit history beyond the most recent
// page was unreachable. These pin the additive cursor behavior.

test("GET /accounting/journal keyset-pages the ledger without dup or gap", async () => {
  const app = await freshApp();
  // Seed 5 journal rows for the auth helper's tenant (tnt_demo), distinct times.
  const base = Date.now();
  for (let i = 0; i < 5; i++) {
    await app.db.exec(`
      INSERT INTO journal_entries (id, tenant_id, entry_group, doc_type, doc_id, account_code, account_name, debit_cents, credit_cents, memo, created_at)
      VALUES ('jre_pg_${i}_${base}', 'tnt_demo', 'grp_${i}', 'manual', NULL, '1200', 'Inventory', ${100 * (i + 1)}, 0, 'seed ${i}', ${base + i})
    `);
  }

  const p1 = await call(app, "GET", "/api/accounting/journal?accountCode=1200&limit=2");
  assert.equal(p1.status, 200);
  assert.equal(p1.json.items.length, 2, "first page holds the limit");
  assert.ok(p1.json.nextCursor, "full page yields a cursor");

  const p2 = await call(app, "GET", `/api/accounting/journal?accountCode=1200&limit=2&cursor=${encodeURIComponent(p1.json.nextCursor)}`);
  const p3 = await call(app, "GET", `/api/accounting/journal?accountCode=1200&limit=2&cursor=${encodeURIComponent(p2.json.nextCursor)}`);
  assert.equal(p3.json.items.length, 1, "last page holds the remainder");
  assert.equal(p3.json.nextCursor, null, "short page ends the sequence");

  const ids = [...p1.json.items, ...p2.json.items, ...p3.json.items].map((e: { id: string }) => e.id);
  assert.equal(new Set(ids).size, 5, "no journal row duplicated or skipped across pages");
  const times = [...p1.json.items, ...p2.json.items, ...p3.json.items].map((e: { created_at: number }) => e.created_at);
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest-first across pages");
});

test("GET /accounting/journal without cursor stays backward-compatible ({ items })", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/accounting/journal");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.items), "items[] still present for existing clients");
});
