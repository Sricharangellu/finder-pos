/**
 * approval-chains.test.ts — Phase 0 gap-closure (Workflows > Approval Chains)
 *
 * Tests:
 *   1. Owner can create an approval chain
 *   2. List returns created chains with runs: 0 (honest — nothing invokes yet)
 *   3. Manager cannot create (403)
 *   4. Manager can list/get (read-only role)
 *   5. Patch toggles enabled
 *   6. Patch updates name/trigger/threshold/steps
 *   7. Delete returns 204; get after delete is 404
 *   8. Get/patch/delete of unknown id is 404
 *   9. recordRun() writes a real row and list()'s runs count reflects it
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { ApprovalChainsService } from "./approval-chains.js";

let __seq = 0;
const __schema = () => `wf_ac_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] ??= "test-secret-finder-pos";
  return buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown, role = "owner") {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

// ── 1. Create ────────────────────────────────────────────────────────────────
test("owner can create an approval chain", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Price Override Approval",
    trigger: "price_override",
    threshold: 10,
    steps: [{ role: "manager", label: "Manager approval" }],
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.id.startsWith("apc_"));
  assert.equal(json.name, "Price Override Approval");
  assert.equal(json.trigger, "price_override");
  assert.equal(json.threshold, 10);
  assert.deepEqual(json.steps, [{ role: "manager", label: "Manager approval" }]);
  assert.equal(json.enabled, true);
  assert.equal(json.runs, 0, "runs must be a real 0, not fabricated");
});

// ── 2. List ───────────────────────────────────────────────────────────────────
test("list returns created chains with honest runs: 0", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Large Refund Gate", trigger: "refund", threshold: 10000,
    steps: [{ role: "supervisor", label: "Supervisor sign-off" }],
  });
  const { status, json } = await call(app, "GET", "/api/workflows/approval-chains", undefined, "manager");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  const chain = json.items.find((c: any) => c.name === "Large Refund Gate");
  assert.ok(chain);
  assert.equal(chain.runs, 0);
});

// ── 3. Manager cannot create (403) ────────────────────────────────────────────
test("manager cannot create an approval chain (403)", async () => {
  const app = await freshApp();
  const { status } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "X", trigger: "custom",
  }, "manager");
  assert.equal(status, 403);
});

// ── 4. Manager can read ───────────────────────────────────────────────────────
test("manager can list and get approval chains", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Vendor Onboard", trigger: "vendor_create",
  });
  const { status: listStatus } = await call(app, "GET", "/api/workflows/approval-chains", undefined, "manager");
  assert.equal(listStatus, 200);
  const { status: getStatus, json: getJson } = await call(
    app, "GET", `/api/workflows/approval-chains/${created.id}`, undefined, "manager",
  );
  assert.equal(getStatus, 200);
  assert.equal(getJson.id, created.id);
});

// ── 5. Patch enabled ──────────────────────────────────────────────────────────
test("patch toggles enabled", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Discount Gate", trigger: "discount_create", threshold: 25,
  });
  assert.equal(created.enabled, true);
  const { status, json } = await call(
    app, "PATCH", `/api/workflows/approval-chains/${created.id}`, { enabled: false },
  );
  assert.equal(status, 200);
  assert.equal(json.enabled, false);
  // name/trigger/threshold unchanged
  assert.equal(json.name, "Discount Gate");
  assert.equal(json.threshold, 25);
});

// ── 6. Patch full fields ──────────────────────────────────────────────────────
test("patch updates name, trigger, threshold, and steps", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Old Name", trigger: "custom", threshold: null,
  });
  const { status, json } = await call(
    app, "PATCH", `/api/workflows/approval-chains/${created.id}`,
    { name: "New Name", trigger: "refund", threshold: 5000, steps: [{ role: "owner", label: "Owner sign-off" }] },
  );
  assert.equal(status, 200);
  assert.equal(json.name, "New Name");
  assert.equal(json.trigger, "refund");
  assert.equal(json.threshold, 5000);
  assert.deepEqual(json.steps, [{ role: "owner", label: "Owner sign-off" }]);
});

// ── 7. Delete ─────────────────────────────────────────────────────────────────
test("delete returns 204 and chain is gone", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Doomed Chain", trigger: "custom",
  });
  const { status } = await call(app, "DELETE", `/api/workflows/approval-chains/${created.id}`);
  assert.equal(status, 204);
  const { status: getStatus } = await call(
    app, "GET", `/api/workflows/approval-chains/${created.id}`, undefined, "manager",
  );
  assert.equal(getStatus, 404);
});

// ── 8. Unknown id ─────────────────────────────────────────────────────────────
test("get/patch/delete of unknown id is 404", async () => {
  const app = await freshApp();
  const { status: getStatus } = await call(app, "GET", "/api/workflows/approval-chains/apc_missing", undefined, "manager");
  assert.equal(getStatus, 404);
  const { status: patchStatus } = await call(app, "PATCH", "/api/workflows/approval-chains/apc_missing", { enabled: false });
  assert.equal(patchStatus, 404);
  const { status: delStatus } = await call(app, "DELETE", "/api/workflows/approval-chains/apc_missing");
  assert.equal(delStatus, 404);
});

// ── 9. recordRun reflects in the real count ───────────────────────────────────
test("recordRun writes a real row and list()'s runs count reflects it", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/workflows/approval-chains", {
    name: "Countable Chain", trigger: "custom",
  });

  const service = new ApprovalChainsService(app.db);
  await service.recordRun(created.id, "tnt_demo", "usr_demo_manager", "manager", "approved");
  await service.recordRun(created.id, "tnt_demo", "usr_demo_owner", "owner", "approved");

  const { json } = await call(app, "GET", "/api/workflows/approval-chains", undefined, "manager");
  const chain = json.items.find((c: any) => c.id === created.id);
  assert.equal(chain.runs, 2);
});
