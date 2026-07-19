/**
 * settings.test.ts — real-backend tests for the notifications settings
 * surface (preferences / alert rules / digest config), built to close the
 * mock-only gap tracked in tools/api-gap-allowlist.json
 * (`/api/v1/notifications/{digest,preferences,rules[/:id]}`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import http from "node:http";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `notif_settings_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return await buildApp({ schema: __schema() });
}

function callAs(app: App, role: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: "usr_role_test", tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
  const p = path.replace("/api/", "/api/v1/");
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(payload)); }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method, path: p, headers }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); let json: any; try { json = data ? JSON.parse(data) : undefined; } catch { json = data; } resolve({ status: res.statusCode ?? 0, json }); });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload); req.end();
    });
  });
}

function call(app: App, method: string, path: string, body?: unknown) {
  return callAs(app, "owner", method, path, body);
}

// ── Preferences ─────────────────────────────────────────────────────────────

test("preferences: missing rows read back sensible defaults (no 404), 10 known types", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/notifications/preferences");
  assert.equal(status, 200);
  assert.equal(json.items.length, 10);
  const lowStock = json.items.find((p: any) => p.type === "low_stock");
  assert.ok(lowStock);
  assert.equal(lowStock.label, "Low Stock Alerts");
  assert.equal(lowStock.in_app, true);
  assert.equal(lowStock.email, true);
  assert.equal(lowStock.sms, false);
  assert.equal(lowStock.min_severity, "warning");
});

test("preferences: PATCH persists channel toggles and read-back reflects them", async () => {
  const app = await freshApp();
  const updates = [
    { type: "low_stock", channel: "in_app", enabled: true },
    { type: "low_stock", channel: "email", enabled: false },
    { type: "low_stock", channel: "sms", enabled: true },
    { type: "low_stock", channel: "push", enabled: false },
  ];
  const patch = await call(app, "PATCH", "/api/notifications/preferences", updates);
  assert.equal(patch.status, 200, JSON.stringify(patch.json));

  const { json } = await call(app, "GET", "/api/notifications/preferences");
  const lowStock = json.items.find((p: any) => p.type === "low_stock");
  assert.equal(lowStock.in_app, true);
  assert.equal(lowStock.email, false);
  assert.equal(lowStock.sms, true);
  assert.equal(lowStock.push, false);

  // Untouched types keep their defaults.
  const paymentFailed = json.items.find((p: any) => p.type === "payment_failed");
  assert.equal(paymentFailed.email, true);
  assert.equal(paymentFailed.sms, true);
});

test("preferences: a partial update to one type doesn't clobber the other channels of that type on a later save", async () => {
  const app = await freshApp();
  await call(app, "PATCH", "/api/notifications/preferences", [
    { type: "system", channel: "sms", enabled: true },
  ]);
  // Second save touches a different channel only.
  await call(app, "PATCH", "/api/notifications/preferences", [
    { type: "system", channel: "push", enabled: false },
  ]);
  const { json } = await call(app, "GET", "/api/notifications/preferences");
  const system = json.items.find((p: any) => p.type === "system");
  assert.equal(system.sms, true, "first save's sms=true must survive the second save");
  assert.equal(system.push, false);
  assert.equal(system.in_app, true, "untouched default in_app must survive");
});

test("preferences: PATCH is manager+ (cashier 403, manager 200)", async () => {
  const app = await freshApp();
  const body = [{ type: "low_stock", channel: "in_app", enabled: false }];
  assert.equal((await callAs(app, "cashier", "PATCH", "/api/notifications/preferences", body)).status, 403);
  assert.equal((await callAs(app, "manager", "PATCH", "/api/notifications/preferences", body)).status, 200);
  // Reads stay open to any authenticated role.
  assert.equal((await callAs(app, "cashier", "GET", "/api/notifications/preferences")).status, 200);
});

// ── Alert rules ─────────────────────────────────────────────────────────────

test("rules: list empty, create, read back, update enabled, delete", async () => {
  const app = await freshApp();
  const empty = await call(app, "GET", "/api/notifications/rules");
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.items, []);

  const created = await call(app, "POST", "/api/notifications/rules", {
    name: "Low Stock — Reorder Point",
    trigger: "inventory",
    condition: "qty_lte_reorder_point",
    channels: ["in_app", "email"],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.ok(created.json.id.startsWith("rule_"));
  assert.equal(created.json.enabled, true);
  assert.equal(created.json.fires_count, 0);
  assert.equal(created.json.last_fired_at, null);
  assert.deepEqual(created.json.channels, ["in_app", "email"]);
  assert.equal(created.json.threshold, null);

  const list = await call(app, "GET", "/api/notifications/rules");
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.items[0].id, created.json.id);

  const toggled = await call(app, "PATCH", `/api/notifications/rules/${created.json.id}`, { enabled: false });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.json.enabled, false);
  // Other fields survive an {enabled}-only patch.
  assert.equal(toggled.json.name, "Low Stock — Reorder Point");
  assert.deepEqual(toggled.json.channels, ["in_app", "email"]);

  const del = await call(app, "DELETE", `/api/notifications/rules/${created.json.id}`);
  assert.equal(del.status, 204);

  const afterDelete = await call(app, "GET", "/api/notifications/rules");
  assert.deepEqual(afterDelete.json.items, []);
});

test("rules: PATCH/DELETE unknown id -> 404", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/notifications/rules/rule_nope", { enabled: true })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/notifications/rules/rule_nope")).status, 404);
});

test("rules: mutations are manager+ (cashier 403 on create/patch/delete)", async () => {
  const app = await freshApp();
  const body = { name: "X", trigger: "inventory", condition: "qty_eq" };
  assert.equal((await callAs(app, "cashier", "POST", "/api/notifications/rules", body)).status, 403);
  const created = await call(app, "POST", "/api/notifications/rules", body);
  assert.equal((await callAs(app, "cashier", "PATCH", `/api/notifications/rules/${created.json.id}`, { enabled: false })).status, 403);
  assert.equal((await callAs(app, "cashier", "DELETE", `/api/notifications/rules/${created.json.id}`)).status, 403);
  assert.equal((await callAs(app, "cashier", "GET", "/api/notifications/rules")).status, 200);
});

test("rules: tenant isolation — a rule created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const otherToken = jwt.sign({ sub: "usr_other", tenantId: "tnt_other", role: "owner" }, secret, { expiresIn: "1h" });

  const created = await call(app, "POST", "/api/notifications/rules", {
    name: "Tenant A rule", trigger: "inventory", condition: "qty_eq",
  });
  assert.equal(created.status, 201);

  const otherList = await new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") { server.close(); reject(new Error("bind fail")); return; }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method: "GET", path: "/api/v1/notifications/rules", headers: { authorization: `Bearer ${otherToken}` } }, (res) => {
        let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
        res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }); });
      });
      req.on("error", reject);
      req.end();
    });
  });
  assert.equal(otherList.status, 200);
  assert.deepEqual(otherList.json.items, []);
});

// ── Digest config ────────────────────────────────────────────────────────────

test("digest: missing config reads back honest defaults (disabled, no recipients)", async () => {
  const app = await freshApp();
  const { status, json } = await call(app, "GET", "/api/notifications/digest");
  assert.equal(status, 200);
  assert.equal(json.enabled, false);
  assert.equal(json.frequency, "daily");
  assert.equal(json.day_of_week, 1);
  assert.equal(json.hour, 8);
  assert.deepEqual(json.include, []);
  assert.deepEqual(json.recipient_emails, []);
});

test("digest: PATCH persists a full config update and read-back reflects it", async () => {
  const app = await freshApp();
  const patch = await call(app, "PATCH", "/api/notifications/digest", {
    enabled: true,
    frequency: "weekly",
    day_of_week: 3,
    hour: 14,
    include: ["low_stock", "payment_failed"],
    recipient_emails: ["owner@example.com", "manager@example.com"],
  });
  assert.equal(patch.status, 200, JSON.stringify(patch.json));
  assert.equal(patch.json.enabled, true);
  assert.equal(patch.json.frequency, "weekly");

  const { json } = await call(app, "GET", "/api/notifications/digest");
  assert.equal(json.enabled, true);
  assert.equal(json.frequency, "weekly");
  assert.equal(json.day_of_week, 3);
  assert.equal(json.hour, 14);
  assert.deepEqual(json.include, ["low_stock", "payment_failed"]);
  assert.deepEqual(json.recipient_emails, ["owner@example.com", "manager@example.com"]);
});

test("digest: a partial follow-up PATCH only changes the fields it sends", async () => {
  const app = await freshApp();
  await call(app, "PATCH", "/api/notifications/digest", { enabled: true, recipient_emails: ["a@example.com"] });
  await call(app, "PATCH", "/api/notifications/digest", { hour: 20 });
  const { json } = await call(app, "GET", "/api/notifications/digest");
  assert.equal(json.hour, 20);
  assert.equal(json.enabled, true, "earlier enabled=true must survive an unrelated later patch");
  assert.deepEqual(json.recipient_emails, ["a@example.com"]);
});

test("digest: PATCH is manager+ (cashier 403, manager 200)", async () => {
  const app = await freshApp();
  assert.equal((await callAs(app, "cashier", "PATCH", "/api/notifications/digest", { enabled: true })).status, 403);
  assert.equal((await callAs(app, "manager", "PATCH", "/api/notifications/digest", { enabled: true })).status, 200);
  assert.equal((await callAs(app, "cashier", "GET", "/api/notifications/digest")).status, 200);
});
