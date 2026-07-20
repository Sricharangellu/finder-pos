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

// ── Tests ────────────────────────────────────────────────────────────────────

test("create and list a discount rule", async () => {
  const app = await freshApp();

  const { status, json } = await call(app, "POST", "/api/discounts/", {
    name: "10% Off Everything",
    ruleType: "simple",
    discountType: "percent",
    value: 10,
    applyTo: "cart",
    autoApplicable: true,
  });
  assert.equal(status, 201, `create failed: ${JSON.stringify(json)}`);
  assert.ok(json.id.startsWith("dsc_"));
  assert.equal(json.status, "active");
  assert.equal(json.value, 10);

  const list = await call(app, "GET", "/api/discounts/");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((d: any) => d.id === json.id));
});

test("simple percent discount reduces cart total", async () => {
  const app = await freshApp();

  await call(app, "POST", "/api/discounts/", {
    name: "20% Off Cart",
    ruleType: "simple",
    discountType: "percent",
    value: 20,
    applyTo: "cart",
    autoApplicable: true,
  });

  const { status, json } = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [
      { productId: "p_1", category: "general", quantity: 2, unitCents: 1000 },
    ],
  }, "cashier");
  assert.equal(status, 200, `evaluate failed: ${JSON.stringify(json)}`);
  assert.equal(json.subtotalCents, 2000);
  assert.equal(json.totalDiscountCents, 400); // 20% of 2000
  assert.equal(json.netCents, 1600);
  assert.equal(json.discounts.length, 1);
  assert.equal(json.discounts[0].amountCents, 400);
});

test("fixed discount applied to cart", async () => {
  const app = await freshApp();

  await call(app, "POST", "/api/discounts/", {
    name: "$5 Off",
    ruleType: "simple",
    discountType: "fixed",
    value: 500,
    applyTo: "cart",
    autoApplicable: true,
  });

  const { json } = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [{ productId: "p_1", quantity: 3, unitCents: 1000 }],
  });
  assert.equal(json.subtotalCents, 3000);
  assert.equal(json.totalDiscountCents, 500);
  assert.equal(json.netCents, 2500);
});

test("coupon code discount only applies when code provided", async () => {
  const app = await freshApp();

  await call(app, "POST", "/api/discounts/", {
    name: "SUMMER25 coupon",
    couponCode: "SUMMER25",
    ruleType: "simple",
    discountType: "percent",
    value: 25,
    applyTo: "cart",
    autoApplicable: false,
  });

  const cart = { lines: [{ productId: "p_1", quantity: 1, unitCents: 2000 }] };

  // Without coupon — no discount
  const noCoupon = await call(app, "POST", "/api/discounts/evaluate", cart);
  assert.equal(noCoupon.json.totalDiscountCents, 0);
  assert.equal(noCoupon.json.discounts.length, 0);

  // With correct coupon
  const withCoupon = await call(app, "POST", "/api/discounts/evaluate", {
    ...cart,
    couponCode: "SUMMER25",
  });
  assert.equal(withCoupon.json.totalDiscountCents, 500); // 25% of 2000
  assert.equal(withCoupon.json.netCents, 1500);
});

test("min order threshold prevents discount below limit", async () => {
  const app = await freshApp();

  await call(app, "POST", "/api/discounts/", {
    name: "$10 Off Orders Over $50",
    ruleType: "simple",
    discountType: "fixed",
    value: 1000,
    applyTo: "cart",
    autoApplicable: true,
    minOrderCents: 5000,
  });

  // Cart at $30 — below threshold
  const small = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [{ productId: "p_1", quantity: 1, unitCents: 3000 }],
  });
  assert.equal(small.json.totalDiscountCents, 0);

  // Cart at $60 — above threshold
  const large = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [{ productId: "p_1", quantity: 2, unitCents: 3000 }],
  });
  assert.equal(large.json.totalDiscountCents, 1000);
  assert.equal(large.json.netCents, 5000);
});

test("inactive rule is not applied", async () => {
  const app = await freshApp();

  const { json: rule } = await call(app, "POST", "/api/discounts/", {
    name: "Inactive Rule",
    ruleType: "simple",
    discountType: "percent",
    value: 50,
    applyTo: "cart",
    autoApplicable: true,
  });

  // Deactivate it
  await call(app, "PATCH", `/api/discounts/${rule.id}/status`, { status: "inactive" });

  const { json } = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [{ productId: "p_1", quantity: 1, unitCents: 1000 }],
  });
  assert.equal(json.totalDiscountCents, 0);
});

test("discount cannot exceed cart subtotal", async () => {
  const app = await freshApp();

  await call(app, "POST", "/api/discounts/", {
    name: "$1000 Off Everything",
    ruleType: "simple",
    discountType: "fixed",
    value: 100_000,
    applyTo: "cart",
    autoApplicable: true,
  });

  const { json } = await call(app, "POST", "/api/discounts/evaluate", {
    lines: [{ productId: "p_1", quantity: 1, unitCents: 500 }],
  });
  assert.equal(json.subtotalCents, 500);
  assert.equal(json.totalDiscountCents, 500); // capped at subtotal
  assert.equal(json.netCents, 0);
});

test("list pagination: a huge ?limit is capped server-side instead of being passed through raw", async () => {
  const app = await freshApp();

  for (let i = 0; i < 3; i++) {
    await call(app, "POST", "/api/discounts/", {
      name: `Rule ${i}`,
      ruleType: "simple",
      discountType: "percent",
      value: 5,
      applyTo: "cart",
      autoApplicable: true,
    });
  }

  const huge = await call(app, "GET", "/api/discounts/?limit=99999");
  assert.equal(huge.status, 200, `unexpectedly failed: ${JSON.stringify(huge.json)}`);
  assert.equal(huge.json.total, 3);
  assert.equal(huge.json.items.length, 3, "capped limit still returns every matching row for a small dataset");
});

test("cashier cannot create discount (requires manager)", async () => {
  const app = await freshApp();
  const { status } = await call(app, "POST", "/api/discounts/", {
    name: "Unauthorized",
    ruleType: "simple",
    discountType: "percent",
    value: 5,
    applyTo: "cart",
    autoApplicable: true,
  }, "cashier");
  assert.equal(status, 403);
});
