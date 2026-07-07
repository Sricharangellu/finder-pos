import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import http from "node:http";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }

function makeRequest(app: App, method: string, path: string, role: string, body?: unknown) {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: `usr_test_${role}`, tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
  const resolvedPath = path.startsWith("/api/") && !path.startsWith("/api/v1/")
    ? path.replace("/api/", "/api/v1/") : path;
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(payload)); }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method, path: resolvedPath, headers }, (res) => {
        let data = ""; res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); let json: any; try { json = data ? JSON.parse(data) : undefined; } catch { json = data; } resolve({ status: res.statusCode ?? 0, json }); });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test("expenses: create → list → summary reflect real spend (manager)", async () => {
  const app = await freshApp();

  let r = await makeRequest(app, "GET", "/api/expenses/summary", "owner");
  assert.equal(r.status, 200);
  assert.equal(r.json.totalCents, 0);
  assert.equal(r.json.count, 0);

  // Categorized expense.
  r = await makeRequest(app, "POST", "/api/expenses", "manager", {
    amountCents: 4500, category: "Rent", vendor: "Landlord Co", note: "July rent",
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.amount_cents, 4500);
  assert.equal(r.json.category, "Rent");
  assert.ok(r.json.created_by, "actor recorded");

  // Uncategorized expense (a recommendation signal downstream).
  r = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: 1200 });
  assert.equal(r.status, 201);
  assert.equal(r.json.category, null);

  r = await makeRequest(app, "GET", "/api/expenses", "owner");
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 2);
  assert.equal(r.json.items.length, 2);

  r = await makeRequest(app, "GET", "/api/expenses/summary", "owner");
  assert.equal(r.json.totalCents, 5700, "sum of both");
  assert.equal(r.json.count, 2);
  assert.equal(r.json.uncategorizedCount, 1, "one uncategorized");
  assert.equal(r.json.byCategory.length, 1);
  assert.equal(r.json.byCategory[0].category, "Rent");
  assert.equal(r.json.byCategory[0].totalCents, 4500);
});

test("expenses: create/delete require manager+, list is readable, and delete works", async () => {
  const app = await freshApp();

  // Cashier cannot create.
  let r = await makeRequest(app, "POST", "/api/expenses", "cashier", { amountCents: 999 });
  assert.equal(r.status, 403, "cashier is forbidden from recording expenses");

  // Manager creates.
  r = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: 999, category: "Supplies" });
  assert.equal(r.status, 201);
  const id = r.json.id;

  // Cashier cannot delete.
  r = await makeRequest(app, "DELETE", `/api/expenses/${id}`, "cashier");
  assert.equal(r.status, 403);

  // Owner deletes.
  r = await makeRequest(app, "DELETE", `/api/expenses/${id}`, "owner");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);

  r = await makeRequest(app, "GET", `/api/expenses/${id}`, "owner");
  assert.equal(r.status, 404, "deleted expense is gone");
});

test("expenses: PATCH categorizes an uncategorized expense (manager+), audited", async () => {
  const app = await freshApp();

  // Uncategorized expense.
  let r = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: 2500 });
  assert.equal(r.status, 201);
  assert.equal(r.json.category, null);
  const id = r.json.id;

  // Cashier cannot categorize.
  r = await makeRequest(app, "PATCH", `/api/expenses/${id}`, "cashier", { category: "Utilities" });
  assert.equal(r.status, 403, "cashier is forbidden from updating expenses");

  // Manager categorizes it.
  r = await makeRequest(app, "PATCH", `/api/expenses/${id}`, "manager", { category: "Utilities" });
  assert.equal(r.status, 200);
  assert.equal(r.json.category, "Utilities");
  assert.equal(r.json.amount_cents, 2500, "untouched fields preserved");

  // Reflected in the summary — the uncategorized count clears.
  r = await makeRequest(app, "GET", "/api/expenses/summary", "owner");
  assert.equal(r.json.uncategorizedCount, 0, "no longer uncategorized");
  assert.equal(r.json.byCategory[0].category, "Utilities");

  // Un-categorize by setting null.
  r = await makeRequest(app, "PATCH", `/api/expenses/${id}`, "manager", { category: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.category, null);
});

test("expenses: PATCH rejects empty body and unknown id", async () => {
  const app = await freshApp();
  const created = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: 100, category: "Rent" });

  // Empty patch → 400 (at least one field required).
  let r = await makeRequest(app, "PATCH", `/api/expenses/${created.json.id}`, "manager", {});
  assert.equal(r.status, 400, "empty patch rejected");

  // Unknown id → 404.
  r = await makeRequest(app, "PATCH", "/api/expenses/exp_does_not_exist", "manager", { category: "X" });
  assert.equal(r.status, 404, "unknown expense not found");
});

test("expenses: rejects non-positive amounts and is tenant-scoped", async () => {
  const app = await freshApp();

  let r = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: 0 });
  assert.equal(r.status, 400, "zero amount rejected");
  r = await makeRequest(app, "POST", "/api/expenses", "manager", { amountCents: -5 });
  assert.equal(r.status, 400, "negative amount rejected");

  // Fresh schema → the tenant starts with no expenses (isolation baseline).
  r = await makeRequest(app, "GET", "/api/expenses", "owner");
  assert.equal(r.json.total, 0);
});
