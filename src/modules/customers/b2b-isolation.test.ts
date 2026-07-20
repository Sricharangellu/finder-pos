import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

/**
 * WP-08 / M1 close-out — B2B surface isolation (real Postgres).
 *
 * Business-account contacts and customer-specific pricing are wholesale
 * concepts. A tenant WITHOUT the `wholesale` capability must get 403 from
 * those routes (never learning they exist), while retail-legitimate surfaces
 * (addresses, notes, loyalty) stay open. Granting the capability restores the
 * full B2B behavior — including WP-08's multi-contact requirement.
 */

let __seq = 0;
const __schema = () => `b2b_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

const TENANT = "tnt_demo"; // module test-request signs its token for tnt_demo

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

/** The business module seeds tnt_demo with wholesale; remove it for a retail posture. */
async function makeRetailOnly(app: App): Promise<void> {
  await app.db.query(
    "DELETE FROM tenant_capabilities WHERE tenant_id = @t AND capability = 'wholesale'",
    { t: TENANT },
  );
}

test("b2b isolation: retail tenant gets 403 on contacts + customer pricing; addresses stay open", async () => {
  const app = await freshApp();
  await makeRetailOnly(app);

  const customer = (await call(app, "POST", "/api/customers/", { name: "Walk-in Wanda" })).json;
  assert.ok(customer.id, "customer created");

  // Wholesale-only surfaces are closed — and closed quietly (403, no detail).
  for (const [method, path, body] of [
    ["GET", `/api/customers/${customer.id}/contacts`, undefined],
    ["POST", `/api/customers/${customer.id}/contacts`, { contactName: "Bob Buyer" }],
    ["GET", `/api/customers/${customer.id}/product-prices`, undefined],
    ["GET", `/api/customers/product-prices/lookup?customerId=${customer.id}&productId=prod_x`, undefined],
  ] as const) {
    const r = await call(app, method, path, body);
    assert.equal(r.status, 403, `${method} ${path} must be 403 for a retail tenant (got ${r.status})`);
  }

  // Retail-legitimate surfaces remain open (delivery/ecommerce need addresses).
  const addr = await call(app, "POST", `/api/customers/${customer.id}/addresses`, {
    line1: "1 Retail Way", city: "Springfield", state: "IL", postalCode: "62701",
  });
  assert.ok(addr.status === 201 || addr.status === 200, `addresses stay open for retail (got ${addr.status})`);

  await app.db.close();
});

test("b2b isolation: wholesale capability restores contacts CRUD incl. WP-08 multi-contact", async () => {
  const app = await freshApp(); // tnt_demo keeps its seeded wholesale capability

  const customer = (await call(app, "POST", "/api/customers/", {
    name: "Acme Distribution", customerType: "business", company: "Acme Dist LLC",
  })).json;

  const c1 = await call(app, "POST", `/api/customers/${customer.id}/contacts`, { contactName: "Alice Owner", title: "Owner" });
  assert.equal(c1.status, 201);
  const c2 = await call(app, "POST", `/api/customers/${customer.id}/contacts`, { contactName: "Bob Buyer", title: "Purchasing" });
  assert.equal(c2.status, 201);

  const list = await call(app, "GET", `/api/customers/${customer.id}/contacts`);
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 2, "a wholesale account carries multiple contacts (WP-08)");

  await app.db.close();
});
