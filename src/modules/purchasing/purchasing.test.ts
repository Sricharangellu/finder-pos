import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown, role = "manager") {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

async function makeProduct(app: App, sku: string, priceCents = 1000) {
  const { status, json } = await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" }, "manager");
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

async function makeSupplier(app: App, name = "ACME Supplies") {
  const { status, json } = await call(app, "POST", "/api/purchasing/suppliers", { name, email: "orders@acme.com" });
  assert.equal(status, 201, `supplier create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("create supplier and list it", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Globex Corp");

  const { status, json } = await call(app, "GET", "/api/purchasing/suppliers");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(json.items.some((s: any) => s.id === supplierId));
  assert.ok(json.items[0].id.startsWith("sup_"));
});

test("create PO and list it as 'ordered'", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "WIDGET-A", 500);

  const { status, json } = await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 10, unitCostCents: 300, lotCode: "LOT-001" }],
  });
  assert.equal(status, 201, `PO create failed: ${JSON.stringify(json)}`);
  assert.ok(json.id.startsWith("po_"));
  assert.equal(json.status, "ordered");
  assert.equal(json.total_cost_cents, 3000); // 10 × 300
  assert.equal(json.lines.length, 1);
  assert.equal(json.lines[0].quantity, 10);
  assert.equal(json.lines[0].received_qty, 0);

  const list = await call(app, "GET", "/api/purchasing/orders");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((o: any) => o.id === json.id));
});

test("partial receive transitions PO to partially_received", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-B", 800);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 5, unitCostCents: 200 }],
  })).json;

  const lineId = po.lines[0].id;

  // Receive 3 of 5
  const { status: rStatus, json: rJson } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 3 }],
  });
  assert.equal(rStatus, 200, `partial receive failed: ${JSON.stringify(rJson)}`);
  assert.equal(rJson.status, "partially_received");
  assert.equal(rJson.lines[0].received_qty, 3);
});

test("receive captures desk-entered expiry and lot onto the line (FEFO source)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "PERISH-A", 400);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 6, unitCostCents: 250 }],
  })).json;
  const lineId = po.lines[0].id;
  // Expiry is unknown at PO time — only captured when the goods physically arrive.
  assert.equal(po.lines[0].expiry_date ?? null, null);

  const expiry = Date.UTC(2027, 5, 30);
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 6, expiryDate: expiry, lotCode: "LOT-RCV-9" }],
  });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.status, "received");
  assert.equal(r.json.lines[0].expiry_date, expiry, "receive-time expiry persisted onto the line");
  assert.equal(r.json.lines[0].lot_code, "LOT-RCV-9", "receive-time lot persisted onto the line");
});

test("full receive transitions PO to received", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productA = await makeProduct(app, "ITEM-C1", 600);
  const productB = await makeProduct(app, "ITEM-C2", 400);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [
      { productId: productA, quantity: 4, unitCostCents: 150 },
      { productId: productB, quantity: 2, unitCostCents: 250 },
    ],
  })).json;

  const lines = po.lines.map((l: any) => ({ lineId: l.id, qty: l.quantity }));

  const { status, json } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, { lines });
  assert.equal(status, 200, `full receive failed: ${JSON.stringify(json)}`);
  assert.equal(json.status, "received");
  assert.ok(json.received_at !== null);
  for (const l of json.lines) {
    assert.equal(l.received_qty, l.quantity, `line ${l.id} not fully received`);
  }
});

test("two-step partial receive completes the PO", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-D", 1000);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 6, unitCostCents: 500 }],
  })).json;
  const lineId = po.lines[0].id;

  // Step 1: receive 4
  const step1 = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 4 }],
  });
  assert.equal(step1.json.status, "partially_received");

  // Step 2: receive remaining 2
  const step2 = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 2 }],
  });
  assert.equal(step2.json.status, "received");
  assert.equal(step2.json.lines[0].received_qty, 6);
});

test("receive rejects qty exceeding remaining", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-E", 300);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 3, unitCostCents: 100 }],
  })).json;

  const { status } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 10 }], // exceeds remaining 3
  });
  assert.equal(status, 400);
});

test("receive already-received PO returns 409", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-F", 200);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 2, unitCostCents: 100 }],
  })).json;

  await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 2 }],
  });

  // Try to receive again
  const { status } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 1 }],
  });
  assert.equal(status, 409);
});

test("cashier cannot create PO (requires manager)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Test Supplier");

  const { status } = await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId: "any", quantity: 1, unitCostCents: 100 }],
  }, "cashier");
  assert.equal(status, 403);
});

test("GET /purchasing/orders/:id returns PO with lines", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-G", 750);

  const created = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 8, unitCostCents: 400 }],
  })).json;

  const { status, json } = await call(app, "GET", `/api/purchasing/orders/${created.id}`);
  assert.equal(status, 200);
  assert.equal(json.id, created.id);
  assert.equal(json.supplier_id, supplierId);
  assert.ok(Array.isArray(json.lines));
  assert.equal(json.lines[0].product_id, productId);
});

// ── PO approval workflow ──────────────────────────────────────────────────────

async function makePO(app: App, supplierId: string, productId: string, qty: number, unitCostCents: number, role = "manager") {
  return call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: qty, unitCostCents }],
  }, role);
}

test("approvals disabled by default: any PO auto-approves and is receivable", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "APR-A");

  // $5,000 PO with no approval config — must behave exactly as before the workflow.
  const created = await makePO(app, supplierId, productId, 10, 50000);
  assert.equal(created.status, 201);
  assert.equal(created.json.approval_status, "approved");

  const received = await call(app, "POST", `/api/purchasing/orders/${created.json.id}/receive`, {});
  assert.equal(received.status, 200);
  assert.equal(received.json.status, "received");

  // Audit trail records the auto-approval.
  const hist = await call(app, "GET", `/api/purchasing/orders/${created.json.id}/approvals`);
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.json.items.map((e: any) => e.action), ["auto_approved"]);
});

test("tiered approval: below auto limit approves, above waits and blocks receiving until approved", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "APR-B");

  // <$1,000 auto; $1,000–$10,000 manager; >$10,000 owner (PRD example tiers).
  const cfg = await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 100000, managerLimitCents: 1000000 }, "owner");
  assert.equal(cfg.status, 200);

  // $500 → auto-approved.
  const small = await makePO(app, supplierId, productId, 5, 10000);
  assert.equal(small.json.approval_status, "approved");

  // $5,000 → pending; receiving must 409 until a manager approves.
  const mid = await makePO(app, supplierId, productId, 10, 50000);
  assert.equal(mid.json.approval_status, "pending");
  const blocked = await call(app, "POST", `/api/purchasing/orders/${mid.json.id}/receive`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, "approval_pending");

  const approved = await call(app, "POST", `/api/purchasing/orders/${mid.json.id}/approve`, {}, "manager");
  assert.equal(approved.status, 200);
  assert.equal(approved.json.approval_status, "approved");
  const received = await call(app, "POST", `/api/purchasing/orders/${mid.json.id}/receive`, {});
  assert.equal(received.status, 200);

  // History: submitted → approved, in order, amounts recorded.
  const hist = await call(app, "GET", `/api/purchasing/orders/${mid.json.id}/approvals`);
  assert.deepEqual(hist.json.items.map((e: any) => e.action), ["submitted", "approved"]);
  assert.equal(hist.json.items[0].amount_cents, 500000);
  assert.equal(hist.json.items[1].actor_role, "manager");
});

test("GET /orders?approvalStatus=pending lists only pending POs, with supplier name joined", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Pending Supply Co");
  const productId = await makeProduct(app, "APR-PEND");
  await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 100000, managerLimitCents: 1000000 }, "owner");

  const auto = await makePO(app, supplierId, productId, 1, 10000); // $100 → auto-approved
  const pending = await makePO(app, supplierId, productId, 10, 50000); // $5,000 → pending
  assert.equal(auto.json.approval_status, "approved");
  assert.equal(pending.json.approval_status, "pending");

  const list = await call(app, "GET", "/api/purchasing/orders?approvalStatus=pending");
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.items.map((o: any) => o.id), [pending.json.id]);
  assert.equal(list.json.items[0].supplier_name, "Pending Supply Co");

  // Unfiltered list still returns both, unaffected by the join.
  const all = await call(app, "GET", "/api/purchasing/orders");
  assert.equal(all.json.items.length, 2);
});

test("owner tier: manager cannot approve a large PO, owner can", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "APR-C");
  await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 100000, managerLimitCents: 1000000 }, "owner");

  // $20,000 → owner tier.
  const big = await makePO(app, supplierId, productId, 20, 100000);
  assert.equal(big.json.approval_status, "pending");

  const denied = await call(app, "POST", `/api/purchasing/orders/${big.json.id}/approve`, {}, "manager");
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "approval_tier");

  const ok = await call(app, "POST", `/api/purchasing/orders/${big.json.id}/approve`, {}, "owner");
  assert.equal(ok.status, 200);
  assert.equal(ok.json.approval_status, "approved");
});

test("rejected PO cannot be received or re-approved; rejection note is kept", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "APR-D");
  await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 100000, managerLimitCents: 1000000 }, "owner");

  const po = await makePO(app, supplierId, productId, 10, 50000);
  const rejected = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/reject`, { note: "budget freeze" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.approval_status, "rejected");

  const recv = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/receive`, {});
  assert.equal(recv.status, 409);
  const reApprove = await call(app, "POST", `/api/purchasing/orders/${po.json.id}/approve`, {});
  assert.equal(reApprove.status, 409);

  const hist = await call(app, "GET", `/api/purchasing/orders/${po.json.id}/approvals`);
  assert.deepEqual(hist.json.items.map((e: any) => e.action), ["submitted", "rejected"]);
  assert.equal(hist.json.items[1].note, "budget freeze");
});

test("approval config is owner-gated and validated", async () => {
  const app = await freshApp();
  const asManager = await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 100000, managerLimitCents: 1000000 }, "manager");
  assert.equal(asManager.status, 403);

  const inverted = await call(app, "PUT", "/api/purchasing/approval-config",
    { autoLimitCents: 1000000, managerLimitCents: 100000 }, "owner");
  assert.equal(inverted.status, 400);

  const read = await call(app, "GET", "/api/purchasing/approval-config");
  assert.equal(read.status, 200);
  assert.equal(read.json.config, null); // nothing stored yet
});

test("concurrent PO creates mint distinct po_numbers (race-free counter)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "SEQ-PO");

  // The legacy MAX(po_number)+1 pattern let these all pick the same number.
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(() => makePO(app, supplierId, productId, 1, 100)),
  );
  assert.ok(results.every((r) => r.status === 201));
  const numbers = results.map((r) => r.json.po_number);
  assert.equal(new Set(numbers).size, 5, `expected 5 distinct po_numbers, got ${numbers.join(",")}`);
});

// ── Purchase requisitions (E2) ────────────────────────────────────────────────

test("requisition lifecycle: draft -> submit -> approve -> convert creates a linked PO", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "REQ-A");

  const created = await call(app, "POST", "/api/purchasing/requisitions", {
    department: "Grocery",
    priority: "high",
    lines: [{ productId, quantity: 12, estCostCents: 250, productName: "Widget" }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, "draft");
  assert.match(created.json.req_number, /^PR-\d{5}$/);
  assert.equal(created.json.lines.length, 1);

  // Draft edits allowed…
  const edited = await call(app, "PATCH", `/api/purchasing/requisitions/${created.json.id}`, {
    lines: [{ productId, quantity: 20, estCostCents: 300 }],
  });
  assert.equal(edited.json.lines[0].quantity, 20);

  const submitted = await call(app, "POST", `/api/purchasing/requisitions/${created.json.id}/submit`, {});
  assert.equal(submitted.json.status, "submitted");

  // …but not after submission.
  const editBlocked = await call(app, "PATCH", `/api/purchasing/requisitions/${created.json.id}`, { notes: "late" });
  assert.equal(editBlocked.status, 409);

  const approved = await call(app, "POST", `/api/purchasing/requisitions/${created.json.id}/approve`, {});
  assert.equal(approved.json.status, "approved");
  assert.ok(approved.json.decided_by);

  const converted = await call(app, "POST", `/api/purchasing/requisitions/${created.json.id}/convert`, { supplierId });
  assert.equal(converted.status, 201);
  assert.equal(converted.json.requisition.status, "converted");
  assert.equal(converted.json.requisition.po_id, converted.json.po.id);
  assert.equal(converted.json.po.lines[0].quantity, 20);
  assert.equal(converted.json.po.lines[0].unit_cost_cents, 300);

  // Converting twice is blocked.
  const again = await call(app, "POST", `/api/purchasing/requisitions/${created.json.id}/convert`, { supplierId });
  assert.equal(again.status, 409);
});

test("requisition guards: reject blocks convert; cashier cannot approve; convert requires approval", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "REQ-B");

  const mk = async () => (await call(app, "POST", "/api/purchasing/requisitions", {
    lines: [{ productId, quantity: 1 }],
  })).json;

  // Convert straight from draft → 409 (must be approved).
  const draft = await mk();
  const draftConvert = await call(app, "POST", `/api/purchasing/requisitions/${draft.id}/convert`, { supplierId });
  assert.equal(draftConvert.status, 409);

  // Rejected requisitions cannot be converted; note is kept.
  const rej = await mk();
  await call(app, "POST", `/api/purchasing/requisitions/${rej.id}/submit`, {});
  const rejected = await call(app, "POST", `/api/purchasing/requisitions/${rej.id}/reject`, { note: "over budget" });
  assert.equal(rejected.json.status, "rejected");
  assert.equal(rejected.json.decision_note, "over budget");
  const rejConvert = await call(app, "POST", `/api/purchasing/requisitions/${rej.id}/convert`, { supplierId });
  assert.equal(rejConvert.status, 409);

  // Approval is manager-gated.
  const pend = await mk();
  await call(app, "POST", `/api/purchasing/requisitions/${pend.id}/submit`, {});
  const denied = await call(app, "POST", `/api/purchasing/requisitions/${pend.id}/approve`, {}, "cashier");
  assert.equal(denied.status, 403);
});

test("requisition list filters by status and paginates with a cursor", async () => {
  const app = await freshApp();
  const productId = await makeProduct(app, "REQ-C");
  for (let i = 0; i < 3; i++) {
    const r = (await call(app, "POST", "/api/purchasing/requisitions", { lines: [{ productId, quantity: 1 }] })).json;
    if (i > 0) await call(app, "POST", `/api/purchasing/requisitions/${r.id}/submit`, {});
  }
  const drafts = await call(app, "GET", "/api/purchasing/requisitions?status=draft");
  assert.equal(drafts.json.items.length, 1);
  const page1 = await call(app, "GET", "/api/purchasing/requisitions?limit=2");
  assert.equal(page1.json.items.length, 2);
  assert.ok(page1.json.nextCursor);
  const page2 = await call(app, "GET", `/api/purchasing/requisitions?limit=2&cursor=${encodeURIComponent(page1.json.nextCursor)}`);
  assert.equal(page2.json.items.length, 1);
});

// ─── Purchase cost entry (session D feature) ──────────────────────────────────

async function receivePO(app: App, supplierId: string, productId: string, qty: number, unitCostCents: number) {
  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: qty, unitCostCents }],
  })).json;
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty }],
  });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  return po;
}

test("cost-entry queue surfaces received lines with reference prices; submit updates cost", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Reference Vendor");
  const productId = await makeProduct(app, "COST-A", 1000); // selling price 1000

  // Two receipts from the SAME vendor for the same product.
  await receivePO(app, supplierId, productId, 6, 250); // older
  await receivePO(app, supplierId, productId, 4, 300); // newer

  const queue = await call(app, "GET", "/api/purchasing/cost-entry");
  assert.equal(queue.status, 200);
  const rows = (queue.json.items as any[]).filter((r) => r.product_id === productId);
  assert.ok(rows.length >= 2, "both received lines appear in the queue");

  // The newest line (cost 300) should reference the older same-vendor cost (250).
  const newest = rows.find((r) => r.po_cost_cents === 300);
  assert.ok(newest, "newest receipt present");
  assert.equal(newest.selling_price_cents, 1000, "shows our selling price");
  assert.equal(newest.supplier_name, "Reference Vendor", "shows the vendor");
  assert.equal(newest.received_qty, 4, "shows the final received qty");
  assert.equal(newest.prev_vendor_cost_cents, 250, "shows the previous cost from the same vendor");

  // Confirm a cost — updates product_costs (the last-purchase-cost reference).
  const submit = await call(app, "POST", "/api/purchasing/cost-entry", { productId, costCents: 275 });
  assert.equal(submit.status, 200);
  assert.equal(submit.json.cost_cents, 275);

  const after = await call(app, "GET", "/api/purchasing/cost-entry");
  const afterRow = (after.json.items as any[]).find((r) => r.product_id === productId);
  assert.equal(afterRow.last_purchase_cost_cents, 275, "last purchase cost reflects the confirmed cost");
});

test("cashier cannot submit a product cost (403)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Vendor X");
  const productId = await makeProduct(app, "COST-B", 500);
  await receivePO(app, supplierId, productId, 2, 100);

  const denied = await call(app, "POST", "/api/purchasing/cost-entry", { productId, costCents: 120 }, "cashier");
  assert.equal(denied.status, 403);
  // Reading the queue stays open.
  assert.equal((await call(app, "GET", "/api/purchasing/cost-entry", undefined, "cashier")).status, 200);
});

test("receiving into a location credits that location's stock", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Loc Vendor");
  const productId = await makeProduct(app, "LOC-A", 500);

  // Create a receiving location.
  const loc = await call(app, "POST", "/api/inventory/locations", { code: "RCV-1", name: "Receiving Dock" }, "manager");
  assert.equal(loc.status, 201, `location create failed: ${JSON.stringify(loc.json)}`);
  const locationId = loc.json.id as string;

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: 8, unitCostCents: 200 }],
  })).json;

  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 8, locationId }],
  });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);

  // The chosen location's stock reflects the receipt.
  const locStock = await call(app, "GET", `/api/inventory/locations/${locationId}/stock`);
  assert.equal(locStock.status, 200);
  const row = (locStock.json.items as any[]).find((s) => s.product_id === productId);
  assert.ok(row, "product appears in the receiving location's stock");
  assert.equal(Number(row.quantity_on_hand), 8, "location credited the full received qty");
});

// ── Price intelligence (#41) ──────────────────────────────────────────────────

const TEST_TENANT = "tnt_demo";

/** Create a PO for one product, fully receive it, and optionally backdate the
 *  received_at so date-range filters can be exercised. Returns the PO id. */
async function makeReceivedPO(
  app: App, supplierId: string, productId: string,
  qty: number, unitCostCents: number, receivedAtMs?: number,
): Promise<string> {
  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: qty, unitCostCents }],
  })).json;
  const lines = po.lines.map((l: any) => ({ lineId: l.id, qty: l.quantity }));
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, { lines });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  if (receivedAtMs != null) {
    await app.db.withTenant(TEST_TENANT).query(
      "UPDATE purchase_orders SET received_at = @r WHERE id = @id AND tenant_id = @t",
      { r: receivedAtMs, id: po.id, t: TEST_TENANT },
    );
  }
  return po.id as string;
}

async function makeOrderedPO(app: App, supplierId: string, productId: string, qty: number, unitCostCents: number) {
  return (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: qty, unitCostCents }],
  })).json;
}

test("price intelligence surfaces invoiced, last-from-supplier and best-across-suppliers", async () => {
  const app = await freshApp();
  const supA = await makeSupplier(app, "Supplier A");
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-1", 1000);

  await makeReceivedPO(app, supB, p, 10, 75); // cheapest, different supplier
  await makeReceivedPO(app, supA, p, 10, 90); // last paid to supplier A

  const cur = await makeOrderedPO(app, supA, p, 5, 100); // current PO, from A

  const { status, json } = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  assert.equal(status, 200);
  const item = json.items.find((i: any) => i.product_id === p);
  assert.ok(item, "expected a price-intelligence item for the product");
  assert.equal(item.invoiced_cents, 100);
  assert.equal(item.ordered_qty, 5);
  assert.equal(item.last_from_supplier.unit_cost_cents, 90);
  assert.equal(item.best_across_suppliers.unit_cost_cents, 75);
  assert.equal(item.best_across_suppliers.supplier_name, "Supplier B");
});

test("qty-break filter excludes small-lot history from best price", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-2", 1000);

  await makeReceivedPO(app, supB, p, 10, 75); // full case
  await makeReceivedPO(app, supB, p, 2, 60);  // odd-lot, cheaper per-unit

  const cur = await makeOrderedPO(app, supB, p, 5, 100);

  const noFilter = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  assert.equal(noFilter.json.items.find((i: any) => i.product_id === p).best_across_suppliers.unit_cost_cents, 60);

  const filtered = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history?qtyBreak=5`);
  assert.equal(filtered.json.items.find((i: any) => i.product_id === p).best_across_suppliers.unit_cost_cents, 75);
});

test("date-range filter narrows price history by received date", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-3", 1000);
  const D = 86_400_000, now = Date.now();

  await makeReceivedPO(app, supB, p, 10, 50, now - 200 * D); // old & cheap
  await makeReceivedPO(app, supB, p, 10, 90, now - 5 * D);   // recent

  const cur = await makeOrderedPO(app, supB, p, 5, 100);

  const r = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history?from=${now - 30 * D}`);
  const item = r.json.items.find((i: any) => i.product_id === p);
  assert.equal(item.history.length, 1, "only the recent receipt should remain");
  assert.equal(item.best_across_suppliers.unit_cost_cents, 90);
});

test("suggested qty reflects reorder point when stock and velocity are zero", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-4", 1000);

  await app.db.withTenant(TEST_TENANT).query(
    "UPDATE products SET reorder_point = @rp WHERE id = @id AND tenant_id = @t",
    { rp: 40, id: p, t: TEST_TENANT },
  );

  const cur = await makeOrderedPO(app, supB, p, 5, 100);
  const r = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  const item = r.json.items.find((i: any) => i.product_id === p);
  assert.equal(item.suggested_qty, 40); // reorder_point 40, stock 0, no velocity
});

// ── Vendor bills · 3-way match (#42) ──────────────────────────────────────────

/** Create a PO, receive `receiveQty` of its single line, return { po, lineId }. */
async function makePoAndReceive(app: App, supplierId: string, productId: string, orderedQty: number, unitCostCents: number, receiveQty: number) {
  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: orderedQty, unitCostCents }],
  })).json;
  const lineId = po.lines[0].id as string;
  if (receiveQty > 0) {
    const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, { lines: [{ lineId, qty: receiveQty }] });
    assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  }
  return { po, lineId };
}

test("3-way match flags short-received, qty and price variances", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const p = await makeProduct(app, "BILL-A", 1000);
  const { po, lineId } = await makePoAndReceive(app, supplierId, p, 10, 300, 8); // ordered 10, received 8

  const bill = (await call(app, "POST", `/api/purchasing/orders/${po.id}/bills`, {
    invoiceNumber: "INV-1", lines: [{ lineId, productId: p, invoicedQty: 10, invoicedUnitCostCents: 320 }],
  })).json;

  assert.equal(bill.status, "draft");
  assert.equal(bill.match.match_status, "variance");
  const line = bill.match.lines[0];
  assert.deepEqual([...line.flags].sort(), ["price_variance", "qty_variance", "short_received"]);
  assert.equal(line.expected_cents, 8 * 300);   // received × PO price
  assert.equal(line.invoiced_cents, 10 * 320);
  assert.equal(line.variance_cents, 10 * 320 - 8 * 300);
});

test("3-way match reports matched when invoiced equals received at PO price", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const p = await makeProduct(app, "BILL-B", 1000);
  const { po, lineId } = await makePoAndReceive(app, supplierId, p, 10, 300, 10);

  const bill = (await call(app, "POST", `/api/purchasing/orders/${po.id}/bills`, {
    invoiceNumber: "INV-2", lines: [{ lineId, productId: p, invoicedQty: 10, invoicedUnitCostCents: 300 }],
  })).json;

  assert.equal(bill.match.match_status, "matched");
  assert.equal(bill.match.lines[0].matched, true);
  assert.equal(bill.match.lines[0].flags.length, 0);
  assert.equal(bill.match.total_variance_cents, 0);
});

test("bill cannot post until approved, and is immutable once posted", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const p = await makeProduct(app, "BILL-C", 1000);
  const { po, lineId } = await makePoAndReceive(app, supplierId, p, 5, 200, 5);

  const bill = (await call(app, "POST", `/api/purchasing/orders/${po.id}/bills`, {
    invoiceNumber: "INV-3", lines: [{ lineId, productId: p, invoicedQty: 5, invoicedUnitCostCents: 200 }],
  })).json;

  // draft → cannot post
  const early = await call(app, "POST", `/api/purchasing/bills/${bill.id}/post`, {});
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, "not_approved");

  // approve → post
  const approved = await call(app, "POST", `/api/purchasing/bills/${bill.id}/status`, { status: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");

  const posted = await call(app, "POST", `/api/purchasing/bills/${bill.id}/post`, {});
  assert.equal(posted.status, 200);
  assert.equal(posted.json.status, "posted");

  // posted is immutable
  const rechange = await call(app, "POST", `/api/purchasing/bills/${bill.id}/status`, { status: "held" });
  assert.equal(rechange.status, 409);
  assert.equal(rechange.json.error.code, "already_posted");
});

test("invoice line with no matching PO line is flagged unexpected", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const pA = await makeProduct(app, "BILL-D", 1000);
  const pB = await makeProduct(app, "BILL-E", 1000);
  const { po, lineId } = await makePoAndReceive(app, supplierId, pA, 4, 250, 4);

  const bill = (await call(app, "POST", `/api/purchasing/orders/${po.id}/bills`, {
    invoiceNumber: "INV-4",
    lines: [
      { lineId, productId: pA, invoicedQty: 4, invoicedUnitCostCents: 250 },
      { lineId: null, productId: pB, invoicedQty: 1, invoicedUnitCostCents: 999 }, // not on PO
    ],
  })).json;

  assert.equal(bill.match.match_status, "variance");
  const unexpected = bill.match.lines.find((l: any) => l.flags.includes("unexpected"));
  assert.ok(unexpected, "expected an unexpected line");
  assert.equal(unexpected.product_id, pB);
  assert.equal(unexpected.invoiced_cents, 999);
});
