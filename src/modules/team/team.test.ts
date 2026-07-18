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

// ─── Time clock ───────────────────────────────────────────────────────────────

async function inviteMember(app: App): Promise<string> {
  const r = await makeRequest(app, "POST", "/api/team/", "owner", {
    name: "Clock Test", email: `clock_${Date.now().toString(36)}@test.dev`,
  });
  assert.equal(r.status, 201);
  return (r.json as { id: string }).id;
}

test("clock-in → duplicate 409 → clock-out with duration → clock-out again 409", async () => {
  const app = await freshApp();
  const id = await inviteMember(app);

  const cin = await makeRequest(app, "POST", `/api/team/${id}/clock-in`, "manager");
  assert.equal(cin.status, 201);
  const entry = cin.json as { id: string; clock_in: number; clock_out: number | null };
  assert.ok(entry.clock_in > 0);
  assert.equal(entry.clock_out, null);

  // The atomic guard rejects a second open entry.
  const dup = await makeRequest(app, "POST", `/api/team/${id}/clock-in`, "manager");
  assert.equal(dup.status, 409);
  assert.equal((dup.json as { error: { code: string } }).error.code, "already_clocked_in");

  const cout = await makeRequest(app, "POST", `/api/team/${id}/clock-out`, "manager");
  assert.equal(cout.status, 200);
  const closed = cout.json as { clock_out: number | null; duration_mins: number | null };
  assert.ok(closed.clock_out !== null);
  assert.ok(Number(closed.duration_mins) >= 0);

  // Nothing open any more.
  const again = await makeRequest(app, "POST", `/api/team/${id}/clock-out`, "manager");
  assert.equal(again.status, 409);
  assert.equal((again.json as { error: { code: string } }).error.code, "not_clocked_in");

  // The closed entry shows up in the listing.
  const list = await makeRequest(app, "GET", `/api/team/${id}/time-entries`, "manager");
  assert.equal(list.status, 200);
  const items = (list.json as { items: { id: string }[] }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, entry.id);
});

test("cashier cannot clock in a DIFFERENT member (self-or-management guard)", async () => {
  const app = await freshApp();
  const id = await inviteMember(app);
  // Token sub is usr_test_cashier, not the invited member's id.
  const r = await makeRequest(app, "POST", `/api/team/${id}/clock-in`, "cashier");
  assert.equal(r.status, 403);
});

test("clock-in for an unknown member 404s (verify-then-mutate)", async () => {
  const app = await freshApp();
  const r = await makeRequest(app, "POST", "/api/team/usr_missing/clock-in", "owner");
  assert.equal(r.status, 404);
});

test("per-member permission requests + overrides return empty lists on a fresh schema", async () => {
  const app = await freshApp();
  const id = await inviteMember(app);
  const reqs = await makeRequest(app, "GET", `/api/team/${id}/permission-requests`, "manager");
  assert.equal(reqs.status, 200);
  assert.deepEqual((reqs.json as { items: unknown[] }).items, []);
  const ovr = await makeRequest(app, "GET", `/api/team/${id}/permission-overrides`, "manager");
  assert.equal(ovr.status, 200);
  assert.deepEqual((ovr.json as { items: unknown[] }).items, []);
});
