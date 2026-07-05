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

// ─── Seed Defaults ────────────────────────────────────────────────────────────

test("seed defaults populates shipping, terms, and modes", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/seed", {});
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  const sm = await call(app, "GET", "/api/settings/shipping-methods");
  assert.ok(sm.json.items.length >= 2, "at least 2 shipping methods seeded");

  const pt = await call(app, "GET", "/api/settings/payment-terms");
  assert.ok(pt.json.items.length >= 3, "at least 3 payment terms seeded");

  const pm = await call(app, "GET", "/api/settings/payment-modes");
  assert.ok(pm.json.items.length >= 5, "at least 5 payment modes seeded");
});

test("seed defaults is idempotent", async () => {
  const app = await freshApp();
  await call(app, "POST", "/api/settings/seed", {});
  await call(app, "POST", "/api/settings/seed", {});

  const sm = await call(app, "GET", "/api/settings/shipping-methods");
  // Second seed should not double-insert
  assert.ok(sm.json.items.length === 2, "still exactly 2 after double seed");
});

// ─── Shipping Methods ─────────────────────────────────────────────────────────

test("create a shipping method and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/shipping-methods", {
    name: "Express Delivery",
    amountCents: 2500,
    freeLimitCents: 10000,
    ecommerce: true,
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("shm_"));
  assert.equal(r.json.name, "Express Delivery");
  assert.equal(r.json.amount_cents, 2500);
  assert.equal(r.json.free_limit_cents, 10000);
  assert.equal(r.json.ecommerce, 1);

  const list = await call(app, "GET", "/api/settings/shipping-methods");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((s: { id: string }) => s.id === r.json.id));
});

test("delete a shipping method", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/settings/shipping-methods", { name: "Trash Me", amountCents: 0 })).json;

  const del = await call(app, "DELETE", `/api/settings/shipping-methods/${created.id}`, undefined);
  assert.equal(del.status, 200);
  assert.equal(del.json.ok, true);

  const list = await call(app, "GET", "/api/settings/shipping-methods");
  assert.ok(!list.json.items.some((s: { id: string }) => s.id === created.id));
});

test("delete nonexistent shipping method returns 404", async () => {
  const app = await freshApp();
  const r = await call(app, "DELETE", "/api/settings/shipping-methods/shm_nonexistent", undefined);
  assert.equal(r.status, 404);
});

// ─── Payment Terms ────────────────────────────────────────────────────────────

test("create a payment term and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/payment-terms", {
    name: "Net 60",
    daysDue: 60,
    description: "Due in 60 days",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("pt_"));
  assert.equal(r.json.name, "Net 60");
  assert.equal(r.json.days_due, 60);
  assert.equal(r.json.description, "Due in 60 days");

  const list = await call(app, "GET", "/api/settings/payment-terms");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((t: { id: string }) => t.id === r.json.id));
});

// ─── Payment Modes ────────────────────────────────────────────────────────────

test("create a payment mode and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/payment-modes", { name: "Crypto" });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("pm_"));
  assert.equal(r.json.name, "Crypto");
  assert.equal(r.json.active, 1);

  const list = await call(app, "GET", "/api/settings/payment-modes");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((m: { id: string }) => m.id === r.json.id));
});

// ─── Tax Rates ────────────────────────────────────────────────────────────────

test("create a tax rate and list it", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/tax-rates", {
    name: "CA Sales Tax",
    rateBps: 725,      // 7.25%
    state: "CA",
    applyToCategory: "general",
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id.startsWith("tax_"));
  assert.equal(r.json.name, "CA Sales Tax");
  assert.equal(r.json.rate_bps, 725);
  assert.equal(r.json.state, "CA");
  assert.equal(r.json.apply_to_category, "general");

  const list = await call(app, "GET", "/api/settings/tax-rates");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((t: { id: string }) => t.id === r.json.id));
});

test("tax rate without category or state is valid", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/tax-rates", { name: "Global VAT", rateBps: 2000 });
  assert.equal(r.status, 201);
  assert.equal(r.json.state, null);
  assert.equal(r.json.apply_to_category, null);
});

// ─── Business Profile ─────────────────────────────────────────────────────────

test("get and update business profile", async () => {
  const app = await freshApp();

  // Fresh profile is empty
  const empty = await call(app, "GET", "/api/settings/business");
  assert.equal(empty.status, 200);

  // PUT merges fields
  const updated = await call(app, "PUT", "/api/settings/business", {
    name: "Acme Corp",
    address: "123 Main St",
    phone: "555-1234",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.name, "Acme Corp");

  // GET returns the merged profile
  const fetched = await call(app, "GET", "/api/settings/business");
  assert.equal(fetched.json.name, "Acme Corp");
  assert.equal(fetched.json.phone, "555-1234");
});

test("PATCH business profile merges rather than replaces", async () => {
  const app = await freshApp();
  await call(app, "PUT", "/api/settings/business", { name: "Acme", city: "LA" });
  const patched = await call(app, "PATCH", "/api/settings/business", { city: "SF" });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.name, "Acme");
  assert.equal(patched.json.city, "SF");
});

// ─── Feature Flags ────────────────────────────────────────────────────────────

test("get and update feature flags", async () => {
  const app = await freshApp();

  const flags = await call(app, "GET", "/api/settings/feature-flags");
  assert.equal(flags.status, 200);

  // Enable a flag
  const updated = await call(app, "PUT", "/api/settings/feature-flags", { ecommerce: true, batchDeposits: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.ecommerce, true);
  assert.equal(updated.json.batchDeposits, false);

  // Verify persistence
  const re = await call(app, "GET", "/api/settings/feature-flags");
  assert.equal(re.json.ecommerce, true);
  assert.equal(re.json.batchDeposits, false);
});

// ─── Platform Capabilities ───────────────────────────────────────────────────

test("capabilities defaults a fresh tenant to the retail business pack", async () => {
  const app = await freshApp();
  const r = await call(app, "GET", "/api/capabilities");

  assert.equal(r.status, 200);
  assert.equal(r.json.capabilitiesVersion, 1);
  assert.equal(r.json.business.type, "retail");
  assert.equal(r.json.business.source, "default");
  assert.equal(r.json.features.accountMode, "RETAIL");
  assert.equal(r.json.features.groupWholesale, false);
  assert.equal(r.json.features.groupEnterprise, false);
  assert.equal(r.json.plan.name, "starter");
  assert.equal(r.json.entitlements.enforced, false);
  assert.equal(r.json.user.role, "owner");
  assert.equal(r.json.user.allAccess, true);

  const pos = r.json.modules.find((m: { key: string }) => m.key === "pos_terminal");
  const salesOrders = r.json.modules.find((m: { key: string }) => m.key === "sales_orders");
  const catalog = r.json.modules.find((m: { key: string }) => m.key === "catalog");

  assert.equal(catalog.enabled, true);
  assert.equal(catalog.source, "core");
  assert.equal(pos.enabled, true);
  assert.equal(pos.source, "business_pack");
  assert.equal(salesOrders.enabled, false);
  assert.equal(salesOrders.source, "not_in_business_pack");
  assert.ok(r.json.requiredFields.customer.includes("name"));
  assert.ok(r.json.workflows.includes("pos_sale"));
});

test("capabilities reflects selected business bundle and manual module overrides", async () => {
  const app = await freshApp();

  const profile = await call(app, "POST", "/api/settings/business-profile", {
    businessType: "wholesale",
  });
  assert.equal(profile.status, 200);

  const wholesale = await call(app, "GET", "/api/settings/capabilities");
  assert.equal(wholesale.status, 200);
  assert.equal(wholesale.json.business.type, "wholesale");
  assert.equal(wholesale.json.business.source, "stored");
  assert.equal(wholesale.json.features.accountMode, "WHOLESALE");

  const salesOrders = wholesale.json.modules.find((m: { key: string }) => m.key === "sales_orders");
  const loyalty = wholesale.json.modules.find((m: { key: string }) => m.key === "loyalty");

  assert.equal(salesOrders.enabled, true);
  assert.equal(salesOrders.source, "manual_override");
  assert.equal(loyalty.enabled, false);
  assert.equal(loyalty.disabledReason, "manual_override_disabled");
  assert.ok(wholesale.json.requiredFields.customer.includes("legalBusinessName"));
  assert.ok(wholesale.json.workflows.includes("create_quote"));

  await call(app, "PUT", "/api/settings/feature-flags", { "module:loyalty": true });
  const override = await call(app, "GET", "/api/capabilities");
  const overriddenLoyalty = override.json.modules.find((m: { key: string }) => m.key === "loyalty");

  assert.equal(overriddenLoyalty.enabled, true);
  assert.equal(overriddenLoyalty.source, "manual_override");
});

test("capabilities impact previews retail to wholesale switch without writing settings", async () => {
  const app = await freshApp();

  const impact = await call(app, "GET", "/api/capabilities/impact?businessType=wholesale");
  assert.equal(impact.status, 200);
  assert.equal(impact.json.impactVersion, 1);
  assert.equal(impact.json.readOnly, true);
  assert.equal(impact.json.from.businessType, "retail");
  assert.equal(impact.json.to.businessType, "wholesale");
  assert.equal(impact.json.summary.businessTypeChanged, true);

  const addedKeys = impact.json.modules.added.map((m: { key: string }) => m.key);
  const removedKeys = impact.json.modules.removed.map((m: { key: string }) => m.key);
  assert.ok(addedKeys.includes("sales_orders"));
  assert.ok(addedKeys.includes("purchasing"));
  assert.ok(addedKeys.includes("quotes"));
  assert.ok(removedKeys.includes("pos_terminal"));
  assert.ok(removedKeys.includes("loyalty"));
  assert.ok(impact.json.requiredFields.added.customer.includes("legalBusinessName"));
  assert.ok(impact.json.workflows.added.includes("create_quote"));
  assert.ok(impact.json.permissions.added.includes("purchasing:write"));
  assert.ok(impact.json.reports.added.includes("quote_conversion"));
  assert.ok(impact.json.setupTasks.some((task: { key: string }) => task.key === "configure_payment_terms"));
  assert.deepEqual(impact.json.apply.body, { businessType: "wholesale" });

  const after = await call(app, "GET", "/api/capabilities");
  assert.equal(after.json.business.type, "retail", "preview must not mutate business type");
  const salesOrders = after.json.modules.find((m: { key: string }) => m.key === "sales_orders");
  assert.equal(salesOrders.enabled, false, "preview must not enable target modules");
});

test("capabilities impact previews module overrides against current business type", async () => {
  const app = await freshApp();

  const impact = await call(app, "GET", "/api/settings/capabilities/impact?enabledModules=sales_orders&disabledModules=loyalty");
  assert.equal(impact.status, 200);
  assert.equal(impact.json.from.businessType, "retail");
  assert.equal(impact.json.to.businessType, "retail");
  assert.equal(impact.json.summary.businessTypeChanged, false);

  const addedKeys = impact.json.modules.added.map((m: { key: string }) => m.key);
  const removedKeys = impact.json.modules.removed.map((m: { key: string }) => m.key);
  assert.deepEqual(addedKeys, ["sales_orders"]);
  assert.deepEqual(removedKeys, ["loyalty"]);
  assert.ok(impact.json.target.enabledModules.includes("sales_orders"));
  assert.ok(!impact.json.target.enabledModules.includes("loyalty"));
  assert.equal(impact.json.target.features.accountMode, "WHOLESALE");
  assert.equal(impact.json.apply.body.businessType, "retail");
  assert.ok(impact.json.apply.body.enabledModules.includes("sales_orders"));
  assert.ok(!impact.json.apply.body.enabledModules.includes("loyalty"));
});

test("capabilities impact rejects unknown modules", async () => {
  const app = await freshApp();

  const r = await call(app, "GET", "/api/capabilities/impact?enabledModules=not_a_module");
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "bad_request");
});

// ─── Edition Presets ──────────────────────────────────────────────────────────

test("set edition to retail enables groupRetailPOS only", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "retail" });
  assert.equal(r.status, 200);
  assert.equal(r.json.groupRetailPOS, true);
  assert.equal(r.json.groupWholesale, false);
  assert.equal(r.json.groupEnterprise, false);
});

test("set edition to enterprise enables all groups", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "enterprise" });
  assert.equal(r.status, 200);
  assert.equal(r.json.groupRetailPOS, true);
  assert.equal(r.json.groupWholesale, true);
  assert.equal(r.json.groupEnterprise, true);
});

test("invalid edition is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/edition", { edition: "invalid" });
  assert.equal(r.status, 400);
});

// ─── Business profile: moduleFlags delta + audit trail ───────────────────────

test("moduleFlags-only POST toggles one module without resetting the profile", async () => {
  const app = await freshApp();

  // Baseline: retail default — loyalty enabled by the pack, tables disabled.
  let caps = await call(app, "GET", "/api/settings/capabilities");
  assert.equal(caps.json.business.type, "retail");
  const before = new Map(caps.json.modules.map((m: { key: string; enabled: boolean }) => [m.key, m.enabled]));
  assert.equal(before.get("loyalty"), true, "retail pack enables loyalty");

  // Delta update: disable loyalty only — no businessType in the body.
  const r = await call(app, "POST", "/api/settings/business-profile", {
    moduleFlags: { loyalty: false },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.businessType, "retail", "type unchanged by a module toggle");

  caps = await call(app, "GET", "/api/settings/capabilities");
  const after = new Map(caps.json.modules.map((m: { key: string; enabled: boolean }) => [m.key, m.enabled]));
  assert.equal(after.get("loyalty"), false, "loyalty disabled");
  assert.equal(caps.json.business.type, "retail", "business type untouched");
  // Every OTHER module keeps its previous state — delta, not reset.
  for (const [key, was] of before) {
    if (key === "loyalty") continue;
    assert.equal(after.get(key), was, `module '${key}' unchanged by the delta update`);
  }

  // "module:"-prefixed keys are accepted too (mock-layer convention).
  const r2 = await call(app, "POST", "/api/settings/business-profile", {
    moduleFlags: { "module:loyalty": true },
  });
  assert.equal(r2.status, 200);
  caps = await call(app, "GET", "/api/settings/capabilities");
  const restored = caps.json.modules.find((m: { key: string }) => m.key === "loyalty");
  assert.equal(restored.enabled, true, "prefixed key re-enabled loyalty");
});

test("empty business-profile POST is rejected with 400", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/settings/business-profile", {});
  assert.equal(r.status, 400);
});

test("business-profile changes are audit-logged with actor and timestamp", async () => {
  const app = await freshApp();

  // Type switch + a module toggle.
  let r = await call(app, "POST", "/api/settings/business-profile", { businessType: "wholesale" });
  assert.equal(r.status, 200);
  r = await call(app, "POST", "/api/settings/business-profile", { moduleFlags: { quotes: false } });
  assert.equal(r.status, 200);

  const log = await call(app, "GET", "/api/audit-log?resource_type=business_profile&limit=10");
  assert.equal(log.status, 200);
  const actions = log.json.items.map((e: { action: string }) => e.action);
  assert.ok(actions.includes("business_profile.type_changed"), "type change audited");
  assert.ok(actions.includes("business_profile.modules_changed"), "module toggle audited");

  const typeChange = log.json.items.find((e: { action: string }) => e.action === "business_profile.type_changed");
  assert.ok(typeChange.actor.id, "actor recorded");
  assert.ok(typeChange.created_at > 0, "timestamp recorded");
  assert.equal(typeChange.changes.businessType.to, "wholesale", "diff shows the new type");
});
