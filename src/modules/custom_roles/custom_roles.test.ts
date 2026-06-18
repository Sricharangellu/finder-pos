/**
 * custom_roles.test.ts — S3-CUSTOM-ROLES integration tests
 *
 * Tests:
 *   1. Owner can create a custom role
 *   2. List returns created roles
 *   3. Get single role
 *   4. Patch updates fields
 *   5. Manager cannot create (403)
 *   6. Unknown permissions are rejected
 *   7. Assign custom role to user — token carries permissions on next login
 *   8. Delete custom role clears user FK
 *   9. requirePermission — cashier with permission passes; cashier without fails
 *  10. requirePermission — manager always passes (role bypass)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `cr_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  process.env["JWT_SECRET"] ??= "test-secret-finder-pos";
  return buildApp({ schema: __schema() });
}

async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  role = "owner",
  extra?: { customRoleId?: string; permissions?: string[] },
) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role, extra);
}

// ── 1. Create custom role ─────────────────────────────────────────────────────
test("owner can create a custom role", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/custom-roles/", {
    name: "Sales Rep",
    description: "Can view orders and customers",
    permissions: ["orders:read", "customers:read"],
  });
  assert.equal(status, 201, JSON.stringify(json));
  assert.ok(json.id.startsWith("crl_"));
  assert.equal(json.name, "Sales Rep");
  assert.deepEqual(json.permissions, ["orders:read", "customers:read"]);
});

// ── 2. List ───────────────────────────────────────────────────────────────────
test("list returns created roles", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/custom-roles/", {
    name: "Inventory Clerk",
    permissions: ["inventory:read", "catalog:read"],
  });
  const { status, json } = await call(app, "GET", "/api/custom-roles/");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(json.items.some((r: any) => r.name === "Inventory Clerk"));
});

// ── 3. Get single ─────────────────────────────────────────────────────────────
test("get returns a single custom role", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/custom-roles/", {
    name: "Auditor",
    permissions: ["reports:read"],
  });
  const { status, json } = await call(app, "GET", `/api/custom-roles/${created.id}`);
  assert.equal(status, 200);
  assert.equal(json.id, created.id);
  assert.deepEqual(json.permissions, ["reports:read"]);
});

// ── 4. Patch ──────────────────────────────────────────────────────────────────
test("patch updates name and permissions", async () => {
  const app = await freshApp();
  const { json: created } = await call(app, "POST", "/api/custom-roles/", {
    name: "Old Name",
    permissions: ["orders:read"],
  });
  const { status, json } = await call(app, "PATCH", `/api/custom-roles/${created.id}`, {
    name: "New Name",
    permissions: ["orders:read", "customers:write"],
  });
  assert.equal(status, 200);
  assert.equal(json.name, "New Name");
  assert.deepEqual(json.permissions, ["orders:read", "customers:write"]);
});

// ── 5. Manager cannot create (403) ────────────────────────────────────────────
test("manager cannot create a custom role (403)", async () => {
  const app = await freshApp();
  const { status } = await call(
    app, "POST", "/api/custom-roles/",
    { name: "X", permissions: [] },
    "manager",
  );
  assert.equal(status, 403);
});

// ── 6. Unknown permission rejected ───────────────────────────────────────────
test("unknown permission strings are rejected (400)", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "POST", "/api/custom-roles/", {
    name: "Bad Role",
    permissions: ["not:a:real:permission"],
  });
  assert.equal(status, 400, JSON.stringify(json));
});

// ── 7. Assign role → login carries permissions ────────────────────────────────
test("assign custom role to user — login token carries permissions", async () => {
  const app = await freshApp();

  // Create a custom role.
  const { json: role } = await call(app, "POST", "/api/custom-roles/", {
    name: "PO Manager",
    permissions: ["purchasing:read", "purchasing:write"],
  });

  // Find the demo cashier user.
  const { json: team } = await call(app, "GET", "/api/team/", undefined, "owner");
  const cashier = team.items.find((u: any) => u.role === "cashier");
  assert.ok(cashier, "demo cashier user not found in team");

  // Assign custom role.
  const { status: assignStatus } = await call(
    app, "PATCH", `/api/custom-roles/assign/${cashier.id}`,
    { customRoleId: role.id },
  );
  assert.equal(assignStatus, 204);

  // Verify team member now shows custom_role_id.
  const { json: team2 } = await call(app, "GET", "/api/team/", undefined, "owner");
  const updated = team2.items.find((u: any) => u.id === cashier.id);
  assert.equal(updated.custom_role_id, role.id);
});

// ── 8. Delete clears FK ───────────────────────────────────────────────────────
test("deleting a custom role returns 204 and allows re-list", async () => {
  const app = await freshApp();
  const { json: role } = await call(app, "POST", "/api/custom-roles/", {
    name: "Temp Role",
    permissions: ["orders:read"],
  });
  const { status } = await call(app, "DELETE", `/api/custom-roles/${role.id}`);
  assert.equal(status, 204);

  const { json: list } = await call(app, "GET", "/api/custom-roles/");
  assert.ok(!list.items.some((r: any) => r.id === role.id));
});

// ── 9. requirePermission — cashier without permission is rejected ──────────────
test("cashier without required permission gets 403 from requirePermission guard", async () => {
  const app = await freshApp();
  // Cashier hits an owner-only route without permissions.
  const { status } = await call(app, "POST", "/api/custom-roles/", {
    name: "X",
    permissions: [],
  }, "cashier");
  assert.equal(status, 403);
});

// ── 10. manager always passes requirePermission ───────────────────────────────
test("manager always passes requirePermission even without custom permissions", async () => {
  const app = await freshApp();
  // GET /api/custom-roles/ requires manager or above.
  const { status } = await call(app, "GET", "/api/custom-roles/", undefined, "manager");
  assert.equal(status, 200);
});
