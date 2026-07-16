import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import http from "node:http";
import { buildApp, type App } from "../../app.js";
import { writeAudit } from "../../shared/audit.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return buildApp({ schema: __schema() }); }

/** Tiny self-contained test client, mirroring the pattern used by expenses.test.ts. */
function makeRequest(app: App, method: string, path: string, role = "owner") {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: `usr_test_${role}`, tenantId: "tnt_demo", role }, secret, { expiresIn: "1h" });
  const resolvedPath = path.startsWith("/api/") && !path.startsWith("/api/v1/")
    ? path.replace("/api/", "/api/v1/") : path;
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const req = http.request(
        { host: "127.0.0.1", port: addr.port, method, path: resolvedPath, headers: { authorization: `Bearer ${token}` } },
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
      req.end();
    });
  });
}

test("audit-log: a huge ?limit is capped server-side instead of being passed through raw", async () => {
  const app = await freshApp();

  for (let i = 0; i < 3; i++) {
    await writeAudit(app.db, {
      tenantId: "tnt_demo",
      actorId: "usr_test_owner",
      action: "test.seed",
      entityType: "test_entity",
      entityId: `ent_${i}`,
    });
  }

  const huge = await makeRequest(app, "GET", "/api/audit-log/?limit=99999", "owner");
  assert.equal(huge.status, 200, `unexpectedly failed: ${JSON.stringify(huge.json)}`);
  assert.equal(huge.json.total, 3);
  assert.equal(huge.json.items.length, 3, "capped limit still returns every matching row for a small dataset");
  assert.equal(huge.json.limit, 200, "the effective limit reported back is capped at the service ceiling, not 99999");
});
