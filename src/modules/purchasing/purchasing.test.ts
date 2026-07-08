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

async function makeProduct(app: App, sku: string, priceCents = 1000) {
  const { status, json } = await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" }, "manager");
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

async function makeSupplier(app: App, name = "ACME Supplies") {
  const { status, json } = await call(app, "POST", "/api/purchasing/suppliers", { name, email: "orders@acme.com" });
  assert.equal(status, 201, `supplier create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("create supplier and list it", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Globex Corp");

  const { status, json } = await call(app, "GET", "/api/purchasing/suppliers");
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.items));
  assert.ok(json.items.some((s: any) => s.id === supplierId));
  assert.ok(json.items[0].id.startsWith("sup_"));
});

test("create PO and list it as 'ordered'", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "WIDGET-A", 500);

  const { status, json } = await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 10, unitCostCents: 300, lotCode: "LOT-001" }],
  });
  assert.equal(status, 201, `PO create failed: ${JSON.stringify(json)}`);
  assert.ok(json.id.startsWith("po_"));
  assert.equal(json.status, "ordered");
  assert.equal(json.total_cost_cents, 3000); // 10 × 300
  assert.equal(json.lines.length, 1);
  assert.equal(json.lines[0].quantity, 10);
  assert.equal(json.lines[0].received_qty, 0);

  const list = await call(app, "GET", "/api/purchasing/orders");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((o: any) => o.id === json.id));
});

test("partial receive transitions PO to partially_received", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-B", 800);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 5, unitCostCents: 200 }],
  })).json;

  const lineId = po.lines[0].id;

  // Receive 3 of 5
  const { status: rStatus, json: rJson } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 3 }],
  });
  assert.equal(rStatus, 200, `partial receive failed: ${JSON.stringify(rJson)}`);
  assert.equal(rJson.status, "partially_received");
  assert.equal(rJson.lines[0].received_qty, 3);
});

test("receive captures desk-entered expiry and lot onto the line (FEFO source)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "PERISH-A", 400);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 6, unitCostCents: 250 }],
  })).json;
  const lineId = po.lines[0].id;
  // Expiry is unknown at PO time — only captured when the goods physically arrive.
  assert.equal(po.lines[0].expiry_date ?? null, null);

  const expiry = Date.UTC(2027, 5, 30);
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 6, expiryDate: expiry, lotCode: "LOT-RCV-9" }],
  });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  assert.equal(r.json.status, "received");
  assert.equal(r.json.lines[0].expiry_date, expiry, "receive-time expiry persisted onto the line");
  assert.equal(r.json.lines[0].lot_code, "LOT-RCV-9", "receive-time lot persisted onto the line");
});

test("full receive transitions PO to received", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productA = await makeProduct(app, "ITEM-C1", 600);
  const productB = await makeProduct(app, "ITEM-C2", 400);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [
      { productId: productA, quantity: 4, unitCostCents: 150 },
      { productId: productB, quantity: 2, unitCostCents: 250 },
    ],
  })).json;

  const lines = po.lines.map((l: any) => ({ lineId: l.id, qty: l.quantity }));

  const { status, json } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, { lines });
  assert.equal(status, 200, `full receive failed: ${JSON.stringify(json)}`);
  assert.equal(json.status, "received");
  assert.ok(json.received_at !== null);
  for (const l of json.lines) {
    assert.equal(l.received_qty, l.quantity, `line ${l.id} not fully received`);
  }
});

test("two-step partial receive completes the PO", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-D", 1000);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 6, unitCostCents: 500 }],
  })).json;
  const lineId = po.lines[0].id;

  // Step 1: receive 4
  const step1 = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 4 }],
  });
  assert.equal(step1.json.status, "partially_received");

  // Step 2: receive remaining 2
  const step2 = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId, qty: 2 }],
  });
  assert.equal(step2.json.status, "received");
  assert.equal(step2.json.lines[0].received_qty, 6);
});

test("receive rejects qty exceeding remaining", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-E", 300);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 3, unitCostCents: 100 }],
  })).json;

  const { status } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 10 }], // exceeds remaining 3
  });
  assert.equal(status, 400);
});

test("receive already-received PO returns 409", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-F", 200);

  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 2, unitCostCents: 100 }],
  })).json;

  await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 2 }],
  });

  // Try to receive again
  const { status } = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, {
    lines: [{ lineId: po.lines[0].id, qty: 1 }],
  });
  assert.equal(status, 409);
});

test("cashier cannot create PO (requires manager)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app, "Test Supplier");

  const { status } = await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId: "any", quantity: 1, unitCostCents: 100 }],
  }, "cashier");
  assert.equal(status, 403);
});

test("GET /purchasing/orders/:id returns PO with lines", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ITEM-G", 750);

  const created = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId,
    lines: [{ productId, quantity: 8, unitCostCents: 400 }],
  })).json;

  const { status, json } = await call(app, "GET", `/api/purchasing/orders/${created.id}`);
  assert.equal(status, 200);
  assert.equal(json.id, created.id);
  assert.equal(json.supplier_id, supplierId);
  assert.ok(Array.isArray(json.lines));
  assert.equal(json.lines[0].product_id, productId);
});

// ── Price intelligence (#41) ──────────────────────────────────────────────────

const TEST_TENANT = "tnt_demo";

/** Create a PO for one product, fully receive it, and optionally backdate the
 *  received_at so date-range filters can be exercised. Returns the PO id. */
async function makeReceivedPO(
  app: App, supplierId: string, productId: string,
  qty: number, unitCostCents: number, receivedAtMs?: number,
): Promise<string> {
  const po = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: qty, unitCostCents }],
  })).json;
  const lines = po.lines.map((l: any) => ({ lineId: l.id, qty: l.quantity }));
  const r = await call(app, "POST", `/api/purchasing/orders/${po.id}/receive`, { lines });
  assert.equal(r.status, 200, `receive failed: ${JSON.stringify(r.json)}`);
  if (receivedAtMs != null) {
    await app.db.withTenant(TEST_TENANT).query(
      "UPDATE purchase_orders SET received_at = @r WHERE id = @id AND tenant_id = @t",
      { r: receivedAtMs, id: po.id, t: TEST_TENANT },
    );
  }
  return po.id as string;
}

async function makeOrderedPO(app: App, supplierId: string, productId: string, qty: number, unitCostCents: number) {
  return (await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: qty, unitCostCents }],
  })).json;
}

test("price intelligence surfaces invoiced, last-from-supplier and best-across-suppliers", async () => {
  const app = await freshApp();
  const supA = await makeSupplier(app, "Supplier A");
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-1", 1000);

  await makeReceivedPO(app, supB, p, 10, 75); // cheapest, different supplier
  await makeReceivedPO(app, supA, p, 10, 90); // last paid to supplier A

  const cur = await makeOrderedPO(app, supA, p, 5, 100); // current PO, from A

  const { status, json } = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  assert.equal(status, 200);
  const item = json.items.find((i: any) => i.product_id === p);
  assert.ok(item, "expected a price-intelligence item for the product");
  assert.equal(item.invoiced_cents, 100);
  assert.equal(item.ordered_qty, 5);
  assert.equal(item.last_from_supplier.unit_cost_cents, 90);
  assert.equal(item.best_across_suppliers.unit_cost_cents, 75);
  assert.equal(item.best_across_suppliers.supplier_name, "Supplier B");
});

test("qty-break filter excludes small-lot history from best price", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-2", 1000);

  await makeReceivedPO(app, supB, p, 10, 75); // full case
  await makeReceivedPO(app, supB, p, 2, 60);  // odd-lot, cheaper per-unit

  const cur = await makeOrderedPO(app, supB, p, 5, 100);

  const noFilter = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  assert.equal(noFilter.json.items.find((i: any) => i.product_id === p).best_across_suppliers.unit_cost_cents, 60);

  const filtered = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history?qtyBreak=5`);
  assert.equal(filtered.json.items.find((i: any) => i.product_id === p).best_across_suppliers.unit_cost_cents, 75);
});

test("date-range filter narrows price history by received date", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-3", 1000);
  const D = 86_400_000, now = Date.now();

  await makeReceivedPO(app, supB, p, 10, 50, now - 200 * D); // old & cheap
  await makeReceivedPO(app, supB, p, 10, 90, now - 5 * D);   // recent

  const cur = await makeOrderedPO(app, supB, p, 5, 100);

  const r = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history?from=${now - 30 * D}`);
  const item = r.json.items.find((i: any) => i.product_id === p);
  assert.equal(item.history.length, 1, "only the recent receipt should remain");
  assert.equal(item.best_across_suppliers.unit_cost_cents, 90);
});

test("suggested qty reflects reorder point when stock and velocity are zero", async () => {
  const app = await freshApp();
  const supB = await makeSupplier(app, "Supplier B");
  const p = await makeProduct(app, "PI-4", 1000);

  await app.db.withTenant(TEST_TENANT).query(
    "UPDATE products SET reorder_point = @rp WHERE id = @id AND tenant_id = @t",
    { rp: 40, id: p, t: TEST_TENANT },
  );

  const cur = await makeOrderedPO(app, supB, p, 5, 100);
  const r = await call(app, "GET", `/api/purchasing/orders/${cur.id}/price-history`);
  const item = r.json.items.find((i: any) => i.product_id === p);
  assert.equal(item.suggested_qty, 40); // reorder_point 40, stock 0, no velocity
});
