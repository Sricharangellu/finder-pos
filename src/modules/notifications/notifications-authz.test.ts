/**
 * notifications-authz.test.ts — first tests for the notifications module
 * (session D, loop iter 8; completes the authz sweep).
 *
 * POST /notifications was an unguarded mutation: any cashier could post a
 * spoofed notification ("System: ...") to the tenant. It is now manager+.
 * Internal event-driven creation (inventory.adjusted / invoice.overdue) calls
 * the service directly and must be unaffected by the route guard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `notif_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

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

const newNotif = { type: "system", severity: "info", title: "T", message: "M" };

test("POST /notifications is manager+ (cashier 403, manager 201); reads stay open", async () => {
  const app = await buildApp({ schema: __schema() });
  assert.equal((await callAs(app, "cashier", "POST", "/api/notifications", newNotif)).status, 403);
  assert.equal((await callAs(app, "manager", "POST", "/api/notifications", newNotif)).status, 201);
  // Any authenticated user can read their tenant's feed and mark read.
  assert.equal((await callAs(app, "cashier", "GET", "/api/notifications")).status, 200);
  assert.equal((await callAs(app, "cashier", "POST", "/api/notifications/mark-all-read")).status, 200);
});

test("internal event-driven creation bypasses the route guard", async () => {
  const app = await buildApp({ schema: __schema() });
  // Out-of-stock adjustment → the module's inventory.adjusted handler creates a
  // low_stock notification via the service (not the guarded HTTP route).
  await app.events.publish("inventory.adjusted", { tenantId: "tnt_demo", sku: "WIDGET", name: "Widget", available: 0 }, "prod_x");
  await new Promise((r) => setTimeout(r, 50)); // let the async handler settle
  const feed = await callAs(app, "cashier", "GET", "/api/notifications");
  assert.equal(feed.status, 200);
  assert.ok(feed.json.items.some((n: { type: string }) => n.type === "low_stock"), "internal low_stock notification was created");
});
