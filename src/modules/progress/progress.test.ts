import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { request } from "./test-request.js";

let seq = 0;
const schema = () => `test_${process.pid}_${Date.now().toString(36)}_${seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: schema() }); }

test("progress: hypothesis/task/evidence keep self-reported work separate from proof", async () => {
  const app = await freshApp();

  let r = await request(app, "POST", "/api/progress/hypotheses", "manager", {
    statement: "Best-selling products are not being restocked fast enough.",
    category: "inventory_health",
    successCriteria: "Receive stock and record at least one sale.",
  });
  assert.equal(r.status, 201);
  const hypothesisId = r.json.id;
  assert.equal(r.json.status, "planned");

  r = await request(app, "POST", "/api/progress/tasks", "manager", {
    hypothesisId,
    title: "Track first real sale",
    verificationSource: "retail.first_sale",
  });
  assert.equal(r.status, 201);
  const taskId = r.json.id;

  r = await request(app, "PATCH", `/api/progress/tasks/${taskId}/status`, "manager", { status: "validated" });
  assert.equal(r.status, 400, "validated cannot be set casually");

  r = await request(app, "PATCH", `/api/progress/tasks/${taskId}/status`, "manager", { status: "self_reported_done" });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "self_reported_done");
  assert.ok(r.json.completed_at, "self-reported done records completion time");

  r = await request(app, "POST", `/api/progress/tasks/${taskId}/evidence`, "manager", {
    evidenceType: "note",
    title: "Interview notes uploaded",
    notes: "Owner reports two products are frequently out of stock.",
  });
  assert.equal(r.status, 201);

  r = await request(app, "GET", "/api/progress/tasks?status=evidence_attached", "owner");
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 1);
  assert.equal(r.json.items[0].id, taskId);

  r = await request(app, "POST", `/api/progress/hypotheses/${hypothesisId}/decisions`, "manager", {
    decision: "validated",
    reason: "Attached customer evidence supports the restock problem.",
    nextAction: "Raise reorder points for fast movers.",
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.decision, "validated");
});

test("progress: system verification only passes when Ascend can prove it from tenant data", async () => {
  const app = await freshApp();

  let r = await request(app, "POST", "/api/progress/tasks", "manager", {
    title: "Record first sale",
    verificationSource: "retail.first_sale",
  });
  assert.equal(r.status, 201);
  const taskId = r.json.id;

  r = await request(app, "POST", `/api/progress/tasks/${taskId}/system-verify`, "manager");
  assert.equal(r.status, 400, "no completed order yet");

  const p = await request(app, "POST", "/api/catalog/", "manager", {
    sku: "PROG-SALE",
    name: "Progress Sale Widget",
    price_cents: 1000,
    category: "general",
  });
  assert.equal(p.status, 201);
  await request(app, "POST", `/api/inventory/${p.json.id}/receive`, "manager", { quantity: 3 });
  const order = await request(app, "POST", "/api/orders/", "cashier", {
    stateCode: "CA",
    lines: [{ productId: p.json.id, quantity: 1 }],
  });
  assert.equal(order.status, 201);
  // Payment capture now requires manager+ (money-movement gate), so this
  // system-verification setup captures as "manager" rather than "cashier".
  const payment = await request(app, "POST", "/api/payments/", "manager", {
    orderId: order.json.id,
    method: "cash",
    tenderedCents: order.json.total_cents,
  });
  assert.equal(payment.status, 201);

  r = await request(app, "POST", `/api/progress/tasks/${taskId}/system-verify`, "manager");
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "system_verified");

  r = await request(app, "GET", "/api/progress/summary", "owner");
  assert.equal(r.status, 200);
  assert.equal(r.json.tasks.system_verified, 1);
  assert.equal(r.json.evidenceCount, 1, "system verification creates evidence");
});

test("progress: manager+ mutations and tenant scoping are enforced", async () => {
  const app = await freshApp();

  let r = await request(app, "POST", "/api/progress/tasks", "cashier", { title: "Cashier cannot create" });
  assert.equal(r.status, 403);

  r = await request(app, "POST", "/api/progress/tasks", "manager", { title: "Tenant one task" }, "tnt_one");
  assert.equal(r.status, 201);
  const id = r.json.id;

  r = await request(app, "GET", "/api/progress/tasks", "owner", undefined, "tnt_two");
  assert.equal(r.status, 200);
  assert.equal(r.json.items.length, 0, "other tenant cannot list task");

  r = await request(app, "POST", `/api/progress/tasks/${id}/evidence`, "manager", {
    title: "Wrong tenant evidence",
  }, "tnt_two");
  assert.equal(r.status, 404, "other tenant cannot attach evidence to task");
});
