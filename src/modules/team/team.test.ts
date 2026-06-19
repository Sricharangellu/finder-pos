import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import http from "node:http";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }

/** Make a request with an explicit role so we can test role-gating. */
function makeRequest(app: App, method: string, path: string, role: string, body?: unknown) {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign(
    { sub: `usr_test_${role}`, tenantId: "tnt_demo", role },
    secret,
    { expiresIn: "1h" },
  );
  const resolvedPath = path.startsWith("/api/") && !path.startsWith("/api/v1/")
    ? path.replace("/api/", "/api/v1/")
    : path;

  return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(payload));
      }
      const req = http.request(
        { host: "127.0.0.1", port: addr.port, method, path: resolvedPath, headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let json: unknown;
            try { json = data ? JSON.parse(data) : undefined; } catch { json = data; }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("owner can list the team directory", async () => {
  const app = await freshApp();
  const r = await makeRequest(app, "GET", "/api/team/", "owner");
  assert.equal(r.status, 200);
  // items is an array (may be empty in a fresh schema)
  assert.ok(Array.isArray((r.json as { items: unknown[] }).items));
});

test("manager can list the team directory", async () => {
  const app = await freshApp();
  const r = await makeRequest(app, "GET", "/api/team/", "manager");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((r.json as { items: unknown[] }).items));
});

test("cashier is forbidden from the team directory", async () => {
  const app = await freshApp();
  const r = await makeRequest(app, "GET", "/api/team/", "cashier");
  assert.equal(r.status, 403);
});
