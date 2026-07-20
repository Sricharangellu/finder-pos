import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

/**
 * Strict business-package separation — retail isolation regression (real Postgres).
 *
 * A tenant WITHOUT the `wholesale` capability must never see or set the
 * wholesale-only product fields (`wholesale_price_cents`,
 * `enterprise_price_cents`, `customer_specific`) through any catalog route:
 * responses are scrubbed and inputs are silently dropped. Granting the
 * capability restores the fields — proving the columns and data are untouched
 * and only the API surface is scoped.
 */

let __seq = 0;
const __schema = () => `riso_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const TENANT = "tnt_demo"; // test-request.ts signs its token for tnt_demo

async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
}

async function call(
  app: App,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

const WHOLESALE_FIELDS = ["wholesale_price_cents", "enterprise_price_cents", "customer_specific"] as const;

function assertScrubbed(obj: Record<string, unknown>, where: string): void {
  for (const field of WHOLESALE_FIELDS) {
    assert.ok(!(field in obj), `${where}: '${field}' must not be present for a retail tenant`);
  }
}

async function grantWholesale(app: App): Promise<void> {
  await app.db.query(
    `INSERT INTO tenant_capabilities (id, tenant_id, capability, enabled, created_at, updated_at)
     VALUES (@id, @t, 'wholesale', true, @now, @now)
     ON CONFLICT (tenant_id, capability) DO UPDATE SET enabled = true`,
    { id: `cap_${TENANT}_wholesale`, t: TENANT, now: Date.now() },
  );
}

/**
 * The business module's register() auto-seeds tnt_demo with BOTH retail and
 * wholesale capabilities (demo tenant previews everything). To test the
 * retail-only posture a real retail signup would have, remove the seeded
 * wholesale grant first.
 */
async function makeRetailOnly(app: App): Promise<void> {
  await app.db.query(
    "DELETE FROM tenant_capabilities WHERE tenant_id = @t AND capability = 'wholesale'",
    { t: TENANT },
  );
}

test("retail isolation: wholesale-only fields are invisible and unwritable without the capability", async () => {
  const app = await freshApp();
  await makeRetailOnly(app);

  // Create WITH wholesale fields in the payload — they must be silently dropped.
  const created = await call(app, "POST", "/api/catalog/", {
    sku: "ISO-RET-1", name: "Retail Widget", price_cents: 1999, category: "general",
    wholesale_price_cents: 1500, enterprise_price_cents: 1200, customer_specific: true,
  });
  assert.equal(created.status, 201);
  assertScrubbed(created.json, "create response");
  const id: string = created.json.id;

  // Read paths: detail and list are scrubbed.
  const got = await call(app, "GET", `/api/catalog/${id}`);
  assert.equal(got.status, 200);
  assertScrubbed(got.json, "get response");

  const list = await call(app, "GET", "/api/catalog/?limit=50");
  assert.equal(list.status, 200);
  for (const item of list.json.items ?? []) assertScrubbed(item, "list item");

  // Update attempting to set a wholesale field succeeds but ignores it —
  // a 400 naming the field would reveal that it exists.
  const patched = await call(app, "PATCH", `/api/catalog/${id}`, {
    name: "Retail Widget v2", wholesale_price_cents: 5000,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.name, "Retail Widget v2");
  assertScrubbed(patched.json, "patch response");

  // Bulk-update with a nested wholesale field is also stripped (deep scrub).
  const bulk = await call(app, "POST", "/api/catalog/bulk-update", {
    ids: [id], update: { wholesale_price_cents: 4200, status: "active" },
  });
  assert.equal(bulk.status, 200);

  // Prove nothing leaked into storage: grant the capability and read the raw value.
  await grantWholesale(app);
  const after = await call(app, "GET", `/api/catalog/${id}`);
  assert.equal(after.status, 200);
  assert.ok("wholesale_price_cents" in after.json, "field visible once capability granted");
  assert.equal(after.json.wholesale_price_cents, null, "retail writes must never have persisted");
  assert.equal(after.json.customer_specific, 0, "customer_specific must not have been set by retail input");

  await app.db.close();
});

test("retail isolation: capability restores full read/write and preserves data", async () => {
  const app = await freshApp();
  await grantWholesale(app);

  // Wholesale-capable tenant sets and reads the fields normally.
  const created = await call(app, "POST", "/api/catalog/", {
    sku: "ISO-WHL-1", name: "Wholesale Widget", price_cents: 2999, category: "general",
    wholesale_price_cents: 2100, customer_specific: true,
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.wholesale_price_cents, 2100);
  assert.equal(created.json.customer_specific, 1);

  const patched = await call(app, "PATCH", `/api/catalog/${created.json.id}`, {
    enterprise_price_cents: 1800,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.enterprise_price_cents, 1800);

  // Revoking the capability hides the data without destroying it.
  await app.db.query(
    "UPDATE tenant_capabilities SET enabled = false WHERE tenant_id = @t AND capability = 'wholesale'",
    { t: TENANT },
  );
  const hidden = await call(app, "GET", `/api/catalog/${created.json.id}`);
  assert.equal(hidden.status, 200);
  assert.ok(!("wholesale_price_cents" in hidden.json), "revoked capability hides the field");

  // Re-enable: the stored value survives untouched.
  await grantWholesale(app);
  const restored = await call(app, "GET", `/api/catalog/${created.json.id}`);
  assert.equal(restored.json.wholesale_price_cents, 2100, "data preserved through hide/restore");

  await app.db.close();
});
