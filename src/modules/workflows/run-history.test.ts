/**
 * run-history.test.ts — Phase 0 gap-closure (Workflows > Run History)
 *
 * Tests:
 *   1. GET on a fresh tenant returns items: [] and total: 0 (honest — nothing
 *      writes to workflow_run_history yet; see run-history.ts doc comment)
 *   2. recordRun() writes a real row and GET reflects it (items + total)
 *   3. Keyset pagination: limit=1 returns nextCursor; following it returns
 *      the next row, newest-first
 *   4. Manager role can read; cashier cannot (403)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { RunHistoryService } from "./run-history.js";

let __seq = 0;
const __schema = () => `wf_rh_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] ??= "test-secret-finder-pos";
  return buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown, role = "manager") {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

// ── 1. Honest empty state ──────────────────────────────────────────────────────
test("run-history is honestly empty on a fresh tenant", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/workflows/run-history");
  assert.equal(status, 200);
  assert.deepEqual(json.items, []);
  assert.equal(json.total, 0);
});

// ── 2. recordRun reflected in GET ─────────────────────────────────────────────
test("recordRun writes a real row that GET returns", async () => {
  const app = await freshApp();
  const service = new RunHistoryService(app.db);
  await service.recordRun(
    { workflowName: "Age Verification", trigger: "age_verification", status: "passed", cashier: "Alex Johnson", outlet: "Main Store", durationMs: 420 },
    "tnt_demo",
  );

  const { status, json } = await call(app, "GET", "/api/workflows/run-history");
  assert.equal(status, 200);
  assert.equal(json.total, 1);
  assert.equal(json.items.length, 1);
  const run = json.items[0];
  assert.equal(run.workflow_name, "Age Verification");
  assert.equal(run.trigger, "age_verification");
  assert.equal(run.status, "passed");
  assert.equal(run.cashier, "Alex Johnson");
  assert.equal(run.outlet, "Main Store");
  assert.equal(run.duration_ms, 420);
  assert.ok(typeof run.ran_at === "number");
});

// ── 3. Keyset pagination ───────────────────────────────────────────────────────
test("run-history is keyset-paginated newest first", async () => {
  const app = await freshApp();
  const service = new RunHistoryService(app.db);
  for (let i = 0; i < 3; i++) {
    await service.recordRun(
      { workflowName: `Run ${i}`, trigger: "custom_prompt", status: "passed", ranAt: 1_000_000 + i },
      "tnt_demo",
    );
  }

  const page1 = await call(app, "GET", "/api/workflows/run-history?limit=1");
  assert.equal(page1.json.items.length, 1);
  assert.equal(page1.json.items[0].workflow_name, "Run 2"); // newest (highest ran_at) first
  assert.ok(page1.json.nextCursor);

  const page2 = await call(app, "GET", `/api/workflows/run-history?limit=1&cursor=${encodeURIComponent(page1.json.nextCursor)}`);
  assert.equal(page2.json.items.length, 1);
  assert.equal(page2.json.items[0].workflow_name, "Run 1");
  assert.equal(page2.json.total, 3);
});

// ── 4. Role guard ──────────────────────────────────────────────────────────────
test("cashier cannot read run history (403)", async () => {
  const app = await freshApp();
  const { status } = await call(app, "GET", "/api/workflows/run-history", undefined, "cashier");
  assert.equal(status, 403);
});
