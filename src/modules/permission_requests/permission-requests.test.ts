import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `pr_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

const V1 = "/api/v1/permission-requests";

test("submit → list → approve creates an override; re-review is blocked", async () => {
  const app = await freshApp();

  const created = await call(app, "POST", `${V1}/`, {
    requestedForUserId: "usr_x",
    requestedForName: "Cashier X",
    permissionCode: "refunds:approve",
    reason: "cover the closing shift",
    accessType: "temporary",
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.ok(created.json.id.startsWith("pr_"));
  assert.equal(created.json.status, "submitted");
  assert.equal(created.json.risk_level, "high", "refunds:approve is high risk");
  const id = created.json.id;

  const list = await call(app, "GET", `${V1}/`);
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((r: { id: string }) => r.id === id), "request appears in the admin list");
  assert.ok(list.json.pending_count >= 1, "pending_count reflects the open request");

  const approved = await call(app, "POST", `${V1}/${id}/approve`, { review_notes: "ok for tonight", expires_at: Date.now() + 3600_000 });
  assert.equal(approved.status, 200, JSON.stringify(approved.json));
  assert.equal(approved.json.status, "approved");
  assert.ok(approved.json.override, "an override is created on approval");
  assert.equal(approved.json.override.permission_code, "refunds:approve");
  assert.equal(approved.json.override.status, "active");

  // A decided request cannot be reviewed again.
  const again = await call(app, "POST", `${V1}/${id}/approve`, {});
  assert.equal(again.status, 409, "already-reviewed request is a conflict");
});

test("reject sets status without an override; revoke only applies to approved grants", async () => {
  const app = await freshApp();

  const r1 = (await call(app, "POST", `${V1}/`, { requestedForUserId: "usr_y", permissionCode: "reports:view", reason: "monthly review" })).json;
  assert.equal(r1.risk_level, "low");
  const rej = await call(app, "POST", `${V1}/${r1.id}/reject`, { review_notes: "not needed" });
  assert.equal(rej.status, 200);
  assert.equal(rej.json.status, "rejected");
  // Cannot revoke a rejected request.
  const badRevoke = await call(app, "POST", `${V1}/${r1.id}/revoke`, {});
  assert.equal(badRevoke.status, 409);

  // Approve then revoke a fresh one.
  const r2 = (await call(app, "POST", `${V1}/`, { requestedForUserId: "usr_z", permissionCode: "price:edit", reason: "promo" })).json;
  await call(app, "POST", `${V1}/${r2.id}/approve`, {});
  const rev = await call(app, "POST", `${V1}/${r2.id}/revoke`, { review_notes: "promo ended" });
  assert.equal(rev.status, 200);
  assert.deepEqual(rev.json, { ok: true });
  const after = await call(app, "GET", `${V1}/${r2.id}`);
  assert.equal(after.json.status, "revoked");
});

test("validation: missing required fields is a 400", async () => {
  const app = await freshApp();
  const bad = await call(app, "POST", `${V1}/`, { reason: "no code or user" });
  assert.equal(bad.status, 400);
});
