import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";
import { BusinessService } from "./service.js";
import type { TestClaims } from "./test-request.js";

// Per-test schema isolation against the shared Postgres instance.
let __seq = 0;
const __schema = () => `bus_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return buildApp({ schema: __schema() });
}

async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  claims?: TestClaims,
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, claims);
}

const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

test("me/context returns the seeded retail and wholesale units for the demo owner", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/v1/me/context");
  assert.equal(status, 200);
  assert.equal(json.tenantId, "tnt_demo");
  assert.equal(json.role, "owner");

  const kinds = json.businessUnits.map((b: any) => b.kind).sort();
  assert.deepEqual(kinds, ["retail", "wholesale"]);

  const retail = json.businessUnits.find((b: any) => b.kind === "retail");
  assert.deepEqual(retail.channels, ["retail_pos"]);
  assert.equal(retail.defaultRoute, "/retail/pos");
  assert.ok(retail.modules.includes("pos"), "retail unit exposes the pos module");

  assert.ok(json.permissions.includes("retail.pos.checkout"));
  assert.ok(json.permissions.includes("wholesale.sales_orders.create"));
  assert.ok(json.activeBusinessUnitId, "an active unit is selected");

  await app.db.close();
});

test("a manager scoped to retail sees only the retail unit", async () => {
  const app = await freshApp();
  const svc = new BusinessService(app.db);
  const t = uniq("tnt_sep");
  const retail = await svc.createBusinessUnit(
    { name: "Shops", kind: "retail", channels: ["retail_pos"], modules: ["pos"], defaultRoute: "/retail/pos" },
    t,
  );
  await svc.createBusinessUnit(
    { name: "Distribution", kind: "wholesale", channels: ["wholesale_b2b"], modules: ["quotes"], defaultRoute: "/wholesale/dashboard" },
    t,
  );
  const uid = uniq("usr_retailmgr");
  await svc.grantAccess(t, uid, retail.id);

  const { status, json } = await call(app, "GET", "/api/v1/me/context", undefined, { sub: uid, tenantId: t, role: "manager" });
  assert.equal(status, 200);
  assert.equal(json.businessUnits.length, 1, "only the granted unit is visible");
  assert.equal(json.businessUnits[0].kind, "retail");
  assert.equal(json.activeBusinessUnitId, retail.id);
  assert.ok(json.permissions.includes("retail.pos.checkout"));
  assert.ok(!json.permissions.includes("wholesale.sales_orders.create"), "no wholesale permissions leak in");

  await app.db.close();
});

test("a manager scoped to wholesale sees only the wholesale unit", async () => {
  const app = await freshApp();
  const svc = new BusinessService(app.db);
  const t = uniq("tnt_sep");
  await svc.createBusinessUnit({ name: "Shops", kind: "retail", channels: ["retail_pos"] }, t);
  const wholesale = await svc.createBusinessUnit(
    { name: "Distribution", kind: "wholesale", channels: ["wholesale_b2b"], defaultRoute: "/wholesale/dashboard" },
    t,
  );
  const uid = uniq("usr_whmgr");
  await svc.grantAccess(t, uid, wholesale.id);

  const { json } = await call(app, "GET", "/api/v1/me/context", undefined, { sub: uid, tenantId: t, role: "manager" });
  assert.equal(json.businessUnits.length, 1);
  assert.equal(json.businessUnits[0].kind, "wholesale");
  assert.equal(json.businessUnits[0].defaultRoute, "/wholesale/dashboard");
  assert.ok(json.permissions.includes("wholesale.sales_orders.create"));
  assert.ok(!json.permissions.includes("retail.pos.checkout"));

  await app.db.close();
});

test("an owner sees every unit in the tenant without explicit access grants", async () => {
  const app = await freshApp();
  const svc = new BusinessService(app.db);
  const t = uniq("tnt_ownerall");
  await svc.createBusinessUnit({ name: "R", kind: "retail", channels: ["retail_pos"] }, t);
  await svc.createBusinessUnit({ name: "W", kind: "wholesale", channels: ["wholesale_b2b"] }, t);

  const { status, json } = await call(app, "GET", "/api/v1/me/context", undefined, { sub: uniq("usr_boss"), tenantId: t, role: "owner" });
  assert.equal(status, 200);
  assert.equal(json.businessUnits.length, 2, "owner is not limited by access grants");

  await app.db.close();
});

test("creating a business unit requires the owner role", async () => {
  const app = await freshApp();
  const t = uniq("tnt_create");

  const denied = await call(app, "POST", "/api/v1/business-units", { name: "X", kind: "retail" }, { sub: uniq("usr_mgr"), tenantId: t, role: "manager" });
  assert.equal(denied.status, 403, "manager cannot create a business unit");

  const created = await call(
    app,
    "POST",
    "/api/v1/business-units",
    { name: "Main Retail", kind: "retail", channels: ["retail_pos"], modules: ["pos"], defaultRoute: "/retail/pos" },
    { sub: uniq("usr_boss"), tenantId: t, role: "owner" },
  );
  assert.equal(created.status, 201);
  assert.equal(created.json.kind, "retail");
  assert.deepEqual(created.json.channels, ["retail_pos"]);
  assert.deepEqual(created.json.modules, ["pos"]);

  await app.db.close();
});

test("business units are tenant-isolated", async () => {
  const app = await freshApp();
  const svc = new BusinessService(app.db);
  const tenantA = uniq("tnt_A");
  const tenantB = uniq("tnt_B");
  await svc.createBusinessUnit({ name: "A-retail", kind: "retail", channels: ["retail_pos"] }, tenantA);

  const { json } = await call(app, "GET", "/api/v1/business-units", undefined, { sub: uniq("usr_b"), tenantId: tenantB, role: "owner" });
  assert.equal(json.items.length, 0, "tenant B sees none of tenant A's units");

  await app.db.close();
});

test("GET /business-units/:id enforces access for non-owners", async () => {
  const app = await freshApp();
  const svc = new BusinessService(app.db);
  const t = uniq("tnt_acc");
  const bu = await svc.createBusinessUnit({ name: "R", kind: "retail", channels: ["retail_pos"] }, t);
  const uid = uniq("usr_noacc");

  const denied = await call(app, "GET", `/api/v1/business-units/${bu.id}`, undefined, { sub: uid, tenantId: t, role: "manager" });
  assert.equal(denied.status, 403, "manager without a grant is refused");

  await svc.grantAccess(t, uid, bu.id);
  const granted = await call(app, "GET", `/api/v1/business-units/${bu.id}`, undefined, { sub: uid, tenantId: t, role: "manager" });
  assert.equal(granted.status, 200);
  assert.equal(granted.json.id, bu.id);

  const owner = await call(app, "GET", `/api/v1/business-units/${bu.id}`, undefined, { sub: uniq("usr_boss"), tenantId: t, role: "owner" });
  assert.equal(owner.status, 200, "owner does not need an explicit grant");

  await app.db.close();
});
