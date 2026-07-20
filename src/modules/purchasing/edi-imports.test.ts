/**
 * edi-imports.test.ts — real-backend tests for the EDI-imports + vendor-history
 * surface built to close the mock-only gap tracked in
 * tools/api-gap-allowlist.json (`/api/v1/purchasing/edi-imports*`,
 * `/api/v1/purchasing/vendor-history`).
 *
 * Scope reminder (see edi-imports.ts's class-level doc comment): the
 * frontend upload form never sends real file bytes, so validate()/process()
 * are tested here as honest state-machine transitions over stored metadata,
 * not as EDI parsers — there is no file content to parse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `edi_imports_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return buildApp({ schema: __schema() });
}

async function call(app: App, method: string, path: string, body?: unknown, role = "manager") {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body, role);
}

async function makeSupplier(app: App, name = "Acme Coffee Co") {
  const { status, json } = await call(app, "POST", "/api/purchasing/suppliers", { name, email: "orders@acme.com" });
  assert.equal(status, 201, `supplier create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

async function makeProduct(app: App, sku: string, priceCents = 1000) {
  const { status, json } = await call(app, "POST", "/api/catalog/", { sku, name: `Product ${sku}`, price_cents: priceCents, category: "general" }, "manager");
  assert.equal(status, 201, `product create failed: ${JSON.stringify(json)}`);
  return json.id as string;
}

async function uploadImport(app: App, supplierId: string, supplierName: string, overrides: Partial<{ filename: string; format: string; file_size_bytes: number }> = {}) {
  const { status, json } = await call(app, "POST", "/api/purchasing/edi-imports", {
    filename: overrides.filename ?? "PO_20260628_ACME.edi",
    format: overrides.format ?? "x12_850",
    supplier_id: supplierId,
    supplier_name: supplierName,
    file_size_bytes: overrides.file_size_bytes ?? 14_820,
  });
  assert.equal(status, 201, `upload failed: ${JSON.stringify(json)}`);
  return json;
}

// ── Formats ──────────────────────────────────────────────────────────────────

test("GET /edi-imports/formats returns the static format list matching the frontend's fallback", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/purchasing/edi-imports/formats", undefined, "cashier");
  assert.equal(status, 200);
  const keys = json.formats.map((f: any) => f.key);
  assert.deepEqual(keys, ["x12_850", "x12_855", "x12_856", "x12_810", "edifact_orders", "csv_po", "json_po", "xml_po"]);
  assert.equal(json.formats[0].label, "X12 850 (Purchase Order)");
});

// ── Create + list ────────────────────────────────────────────────────────────

test("POST /edi-imports creates a queued record; GET lists it and filters by status", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);

  const created = await uploadImport(app, supplierId, "Acme Coffee Co");
  assert.ok(created.id.startsWith("edi_"));
  assert.equal(created.status, "queued");
  assert.equal(created.record_count, 0, "no real records — file content never arrived");
  assert.equal(created.po_count, 0);
  assert.equal(created.filename, "PO_20260628_ACME.edi");
  assert.equal(created.supplier_name, "Acme Coffee Co");

  const all = await call(app, "GET", "/api/purchasing/edi-imports", undefined, "cashier");
  assert.equal(all.status, 200);
  assert.equal(all.json.items.length, 1);
  assert.equal(all.json.items[0].id, created.id);

  const filtered = await call(app, "GET", "/api/purchasing/edi-imports?status=queued", undefined, "cashier");
  assert.equal(filtered.json.items.length, 1);

  const noneValid = await call(app, "GET", "/api/purchasing/edi-imports?status=valid", undefined, "cashier");
  assert.equal(noneValid.json.items.length, 0);
});

test("POST /edi-imports is manager+ (cashier 403); GET stays open to any role", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const denied = await call(app, "POST", "/api/purchasing/edi-imports", {
    filename: "x.csv", format: "csv_po", supplier_id: supplierId, supplier_name: "Acme", file_size_bytes: 100,
  }, "cashier");
  assert.equal(denied.status, 403);
  assert.equal((await call(app, "GET", "/api/purchasing/edi-imports", undefined, "cashier")).status, 200);
});

// ── Detail / preview ─────────────────────────────────────────────────────────

test("GET /edi-imports/:id returns format_label and an honestly empty preview_lines", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co", { format: "x12_856" });

  const { status, json } = await call(app, "GET", `/api/purchasing/edi-imports/${created.id}`, undefined, "cashier");
  assert.equal(status, 200);
  assert.equal(json.format_label, "X12 856 (Ship Notice/ASN)");
  // No real file content ever reached the backend — preview_lines is never
  // fabricated (see edi-imports.ts's class-level doc comment).
  assert.deepEqual(json.preview_lines, []);
});

test("GET /edi-imports/:id unknown id -> 404", async () => {
  const app = await freshApp();
  const { status } = await call(app, "GET", "/api/purchasing/edi-imports/edi_nope", undefined, "cashier");
  assert.equal(status, 404);
});

// ── Validate ─────────────────────────────────────────────────────────────────

test("POST /edi-imports/:id/validate moves a well-formed queued import to 'valid'", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co");

  const { status, json } = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.status, "valid");
  assert.equal(json.error_count, 0);
  assert.ok(json.warnings.some((w: string) => w.includes("never uploaded to the backend")), "warns honestly about the metadata-only validation");
});

test("POST /edi-imports/:id/validate marks an empty file 'invalid' with a real error", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co", { file_size_bytes: 0 });

  const { status, json } = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});
  assert.equal(status, 200);
  assert.equal(json.status, "invalid");
  assert.equal(json.error_count, 1);
  assert.ok(json.errors[0].includes("0 bytes"));
});

test("POST /edi-imports/:id/validate rejects re-validating a non-queued import (409)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co");
  await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});

  const { status } = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});
  assert.equal(status, 409);
});

test("POST /edi-imports/:id/validate is manager+ (cashier 403)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co");
  const denied = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {}, "cashier");
  assert.equal(denied.status, 403);
});

// ── Process ──────────────────────────────────────────────────────────────────

test("POST /edi-imports/:id/process moves a valid import to 'processed' with an honest empty created_po_ids", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co");
  await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});

  const { status, json } = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/process`, {});
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.import.status, "processed");
  assert.ok(json.import.processed_at > 0);
  // No real per-line data exists for an uploaded file, so no POs are
  // fabricated — this is the honest, documented behavior.
  assert.deepEqual(json.created_po_ids, []);
  assert.deepEqual(json.import.created_po_ids, []);

  // Processed imports drop out of the "queued" filter and show up unfiltered.
  const all = await call(app, "GET", "/api/purchasing/edi-imports", undefined, "cashier");
  assert.equal(all.json.items.find((i: any) => i.id === created.id).status, "processed");
});

test("POST /edi-imports/:id/process rejects a non-valid import (409)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co"); // still 'queued'

  const { status, json } = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/process`, {});
  assert.equal(status, 409, JSON.stringify(json));
});

test("POST /edi-imports/:id/process is manager+ (cashier 403)", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const created = await uploadImport(app, supplierId, "Acme Coffee Co");
  await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/validate`, {});
  const denied = await call(app, "POST", `/api/purchasing/edi-imports/${created.id}/process`, {}, "cashier");
  assert.equal(denied.status, 403);
});

// ── Tenant isolation ─────────────────────────────────────────────────────────

test("tenant isolation: an import created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  await uploadImport(app, supplierId, "Acme Coffee Co");

  const { default: request } = await import("./test-request.js");
  // A different tenant's manager token (test-request signs tenantId "tnt_demo"
  // by default; sign a distinct tenant manually via a raw jwt below).
  const jwt = (await import("jsonwebtoken")).default;
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const otherToken = jwt.sign({ sub: "usr_other", tenantId: "tnt_other", role: "owner" }, secret, { expiresIn: "1h" });
  const http = await import("node:http");
  const result = await new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method: "GET", path: "/api/v1/purchasing/edi-imports", headers: { authorization: `Bearer ${otherToken}` } }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }); });
      });
      req.on("error", reject);
      req.end();
    });
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.items, []);
  void request;
});

// ── Vendor history ───────────────────────────────────────────────────────────

test("GET /vendor-history groups real purchase orders by supplier id", async () => {
  const app = await freshApp();
  const supplierA = await makeSupplier(app, "Acme Coffee Co");
  const supplierB = await makeSupplier(app, "Tea Traders");
  const productId = await makeProduct(app, "BEV-001", 800);

  const poA = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId: supplierA, lines: [{ productId, quantity: 10, unitCostCents: 300 }],
  })).json;
  const poB = (await call(app, "POST", "/api/purchasing/orders", {
    supplierId: supplierB, lines: [{ productId, quantity: 5, unitCostCents: 200 }],
  })).json;

  const { status, json } = await call(app, "GET", "/api/purchasing/vendor-history", undefined, "cashier");
  assert.equal(status, 200);
  const history = json.history as Record<string, any[]>;
  assert.equal(history[supplierA].length, 1);
  assert.equal(history[supplierA][0].po_id, poA.id);
  assert.equal(history[supplierA][0].total_cost_cents, 3000);
  assert.equal(history[supplierA][0].item_count, 1);
  assert.equal(history[supplierA][0].status, "ordered");
  assert.equal(typeof history[supplierA][0].po_number, "number");

  assert.equal(history[supplierB].length, 1);
  assert.equal(history[supplierB][0].po_id, poB.id);
  assert.equal(history[supplierB][0].total_cost_cents, 1000);
});

test("GET /vendor-history: a supplier with no purchase orders is simply absent, not an error", async () => {
  const app = await freshApp();
  await makeSupplier(app, "No Orders Yet");
  const { status, json } = await call(app, "GET", "/api/purchasing/vendor-history", undefined, "cashier");
  assert.equal(status, 200);
  assert.deepEqual(json.history, {});
});

test("GET /vendor-history: tenant isolation — POs from another tenant never appear", async () => {
  const app = await freshApp();
  const supplierId = await makeSupplier(app);
  const productId = await makeProduct(app, "ISO-1", 500);
  await call(app, "POST", "/api/purchasing/orders", {
    supplierId, lines: [{ productId, quantity: 1, unitCostCents: 100 }],
  });

  const jwt = (await import("jsonwebtoken")).default;
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const otherToken = jwt.sign({ sub: "usr_other", tenantId: "tnt_other", role: "owner" }, secret, { expiresIn: "1h" });
  const http = await import("node:http");
  const result = await new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method: "GET", path: "/api/v1/purchasing/vendor-history", headers: { authorization: `Bearer ${otherToken}` } }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }); });
      });
      req.on("error", reject);
      req.end();
    });
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.history, {});
});
