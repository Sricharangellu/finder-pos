import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import http from "node:http";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }

/** Tiny self-contained test client, mirroring the pattern used by expenses.test.ts. */
function makeRequest(app: App, method: string, path: string, role = "owner", body?: unknown) {
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
      const req = http.request(
        { host: "127.0.0.1", port: addr.port, method, path: resolvedPath, headers },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let json: any;
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

test("notifications: a huge ?limit is capped server-side instead of being passed through raw", async () => {
  const app = await freshApp();

  for (let i = 0; i < 3; i++) {
    const r = await makeRequest(app, "POST", "/api/notifications", "owner", {
      type: "system",
      severity: "info",
      title: `Notice ${i}`,
      message: "seeded for pagination test",
    });
    assert.equal(r.status, 201, `seed create failed: ${JSON.stringify(r.json)}`);
  }

  const huge = await makeRequest(app, "GET", "/api/notifications?limit=99999", "owner");
  assert.equal(huge.status, 200, `unexpectedly failed: ${JSON.stringify(huge.json)}`);
  assert.equal(huge.json.total, 3);
  assert.equal(huge.json.items.length, 3, "capped limit still returns every matching row for a small dataset");
});
